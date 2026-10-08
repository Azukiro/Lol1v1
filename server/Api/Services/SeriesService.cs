using System.Text.Json;
using Api.Data;
using Api.Domain;
using Api.Domain.Lab;
using Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

public sealed record PoolSnapshot(int[] Owned, int[] Free)
{
    public IReadOnlySet<int> All => Owned.Concat(Free).ToHashSet();
}

/// <summary>
/// Cœur métier : machine à états de la série et des manches, tirages, contrôle du pick,
/// réception des observations et arbitrage. Seule source de vérité.
/// </summary>
public sealed class SeriesService(
    AppDbContext db,
    SeriesLocks locks,
    ISeriesNotifier notifier,
    ReferenceDataService reference,
    TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // =====================================================================
    // Lecture
    // =====================================================================

    public async Task<Series> LoadAsync(Guid seriesId)
    {
        return await db.Series
            .Include(s => s.Players).ThenInclude(p => p.User)
            .Include(s => s.Players).ThenInclude(p => p.RiotAccount)
            .Include(s => s.Players).ThenInclude(p => p.Deck)
            .Include(s => s.Players).ThenInclude(p => p.SpellTokens)
            .Include(s => s.Rounds).ThenInclude(r => r.Assignments)
            .Include(s => s.Rounds).ThenInclude(r => r.Observations)
            .Include(s => s.Bans)
            .AsSplitQuery()
            .FirstOrDefaultAsync(s => s.Id == seriesId)
            ?? throw new AppException("Série introuvable.", 404);
    }

    public async Task<SeriesStateDto> GetStateAsync(Guid seriesId, Guid userId)
    {
        var series = await LoadAsync(seriesId);
        return BuildState(series, PlayerOf(series, userId));
    }

    public async Task<List<SeriesSummaryDto>> ListAsync(Guid userId, SeriesStatus? status)
    {
        var query = db.Series
            .Include(s => s.Players).ThenInclude(p => p.User)
            .Include(s => s.Players).ThenInclude(p => p.RiotAccount)
            .Where(s => s.Players.Any(p => p.UserId == userId));
        if (status is not null) query = query.Where(s => s.Status == status);
        var list = await query.OrderByDescending(s => s.CreatedAt).Take(100).ToListAsync();
        return list.Select(s => Summary(s, userId)).ToList();
    }

    /// <summary>Séries du joueur avec champions, sorts, bans et statistiques de chaque manche jouée (tentatives annulées exclues).</summary>
    public async Task<List<HistoryEntryDto>> HistoryAsync(Guid userId, bool finishedOnly, int take, Guid? seriesId = null)
    {
        var query = db.Series
            .Include(s => s.Players).ThenInclude(p => p.User)
            .Include(s => s.Players).ThenInclude(p => p.RiotAccount)
            .Include(s => s.Rounds).ThenInclude(r => r.Assignments)
            .Include(s => s.Rounds).ThenInclude(r => r.Observations)
            .Include(s => s.Bans)
            .Where(s => s.Players.Any(p => p.UserId == userId));
        if (finishedOnly) query = query.Where(s => s.Status == SeriesStatus.FINISHED || s.Status == SeriesStatus.ABORTED);
        if (seriesId is not null) query = query.Where(s => s.Id == seriesId);
        var list = await query.OrderByDescending(s => s.CreatedAt).Take(take).AsSplitQuery().ToListAsync();
        return list.Select(s =>
        {
            var me = s.Players.First(p => p.UserId == userId);
            var opp = s.Players.First(p => p.Id != me.Id);
            var rounds = s.Rounds.Where(r => r.Status == RoundStatus.VALIDATED).OrderBy(r => r.Number).Select(r =>
            {
                var facts = Evaluate(s, r).Facts;
                var condition = r.WinningCondition is null ? null : JsonSerializer.Deserialize<WinningConditionDto>(r.WinningCondition, Json);
                HistoryPlayerRoundDto Player(SeriesPlayer p)
                {
                    var a = r.Assignments.FirstOrDefault(x => x.PlayerId == p.Id);
                    var f = facts[p.Slot];
                    return new HistoryPlayerRoundDto(a?.ChampionId, a?.Spell1Id, a?.Spell2Id, f.Kills, f.Cs, f.FirstBloodTime is not null, f.FirstTowerTime is not null);
                }
                return new HistoryRoundDto(r.Number, r.WinnerPlayerId is null ? null : SlotName(s, r.WinnerPlayerId.Value),
                    condition?.Label, condition?.Condition, condition?.EventTime, r.StartedAt, r.EndedAt, Player(me), Player(opp));
            }).ToList();
            // Bans à l'aveugle : visibles seulement une fois les deux joueurs passés.
            var revealed = s.Bans.Select(b => b.ByPlayerId).Distinct().Count() == 2;
            List<int> Bans(Guid by) => revealed ? s.Bans.Where(b => b.ByPlayerId == by).Select(b => b.ChampionId).ToList() : [];
            return new HistoryEntryDto(Summary(s, userId), rounds, Bans(me.Id), Bans(opp.Id));
        }).ToList();
    }

    private static SeriesSummaryDto Summary(Series s, Guid userId)
    {
        var me = s.Players.First(p => p.UserId == userId);
        var opp = s.Players.First(p => p.Id != me.Id);
        return new SeriesSummaryDto(s.Id, s.Status.ToString(), s.BestOf, s.ChampionMode.ToString(), s.SpellMode.ToString(),
            ExpressionLabel(s), me.Slot.ToString(), opp.User.DisplayName,
            opp.RiotAccount.RiotId, opp.RiotAccount.ProfileIconId, me.RoundsWon, opp.RoundsWon,
            s.WinnerPlayerId is null ? null : s.Players.First(p => p.Id == s.WinnerPlayerId).Slot.ToString(),
            s.CreatedAt, s.FinishedAt);
    }

    // =====================================================================
    // Création (à l'acceptation d'une invitation)
    // =====================================================================

    public Series Create(SeriesConfig config, User creator, RiotAccount creatorRiot, User guest, RiotAccount guestRiot)
    {
        config.Validate();
        var series = new Series
        {
            BestOf = config.BestOf,
            ChampionMode = config.ChampionMode,
            SpellMode = config.SpellMode,
            WinExpression = config.Lab is null ? WinExpression.Serialize(config.WinExpression!) : "{}",
            LabConfig = config.Lab is null ? null : JsonSerializer.Serialize(config.Lab, Json),
            DrawSeed = DrawService.NewSeed(),
            CreatedAt = clock.GetUtcNow(),
        };
        series.Players.Add(new SeriesPlayer { SeriesId = series.Id, UserId = creator.Id, RiotAccountId = creatorRiot.Id, Slot = Slot.A });
        series.Players.Add(new SeriesPlayer { SeriesId = series.Id, UserId = guest.Id, RiotAccountId = guestRiot.Id, Slot = Slot.B });

        if (config.SpellMode == SpellMode.DECK_RANDOM)
        {
            foreach (var p in series.Players)
            {
                var budget = DrawService.DrawSpellBudget(series.DrawSeed, $"spells:{p.Slot}", series.BestOf, reference.AllowedSpellIds);
                p.SpellTokens = budget.Select(kv => new SpellToken { SeriesPlayerId = p.Id, SpellId = kv.Key, QuantityInitial = kv.Value, QuantityLeft = kv.Value }).ToList();
                p.SpellBudgetLockedAt = clock.GetUtcNow();
            }
        }
        db.Series.Add(series);
        return series;
    }

    // =====================================================================
    // Préparation : pool, deck, budget de sorts, bans
    // =====================================================================

    public Task UpdatePoolAsync(Guid seriesId, Guid userId, int[] owned, int[]? free) => MutateAsync(seriesId, userId, (series, me) =>
    {
        if (series.Status is SeriesStatus.FINISHED or SeriesStatus.ABORTED) throw new AppException("Série terminée.");
        // La LCU renvoie aussi des champions de modes événement (ex. « Jade_Annie », id 60001) : on ne garde que ceux de Data Dragon.
        var known = reference.Current.Champions.Select(c => c.Id).ToHashSet();
        bool Playable(int id) => id > 0 && (known.Count == 0 ? id < 10000 : known.Contains(id));
        var cleanOwned = owned.Where(Playable).Distinct().Order().ToArray();
        var cleanFree = (free ?? []).Where(id => Playable(id) && !cleanOwned.Contains(id)).Distinct().Order().ToArray();
        if (cleanOwned.Length + cleanFree.Length == 0) throw new AppException("Pool vide.");
        me.PoolSnapshot = JsonSerializer.Serialize(new PoolSnapshot(cleanOwned, cleanFree), Json);
        me.PoolUpdatedAt = clock.GetUtcNow();
        TryStart(series);
        return Task.CompletedTask;
    });

    public Task SetDeckAsync(Guid seriesId, Guid userId, int[] championIds) => MutateAsync(seriesId, userId, (series, me) =>
    {
        if (series.ChampionMode != ChampionMode.DECK) throw new AppException("Cette série n'est pas en mode deck.");
        if (series.Status != SeriesStatus.SETUP) throw new AppException("La phase de composition est terminée.");
        if (me.DeckLockedAt is not null) throw new AppException("Ton deck est déjà validé.");
        var pool = Pool(me) ?? throw new AppException("Ton pool n'a pas encore été remonté.");
        try { SeriesRules.ValidateDeck(series.BestOf, championIds, pool.All); }
        catch (DomainException e) { throw new AppException(e.Message); }
        me.Deck = championIds.Select(c => new DeckChampion { SeriesPlayerId = me.Id, ChampionId = c }).ToList();
        db.DeckChampions.AddRange(me.Deck);
        me.DeckLockedAt = clock.GetUtcNow();
        TryStart(series);
        return Task.CompletedTask;
    });

    public Task SetSpellBudgetAsync(Guid seriesId, Guid userId, Dictionary<int, int> tokens) => MutateAsync(seriesId, userId, (series, me) =>
    {
        if (series.SpellMode != SpellMode.DECK_COMPOSED) throw new AppException("Cette série n'est pas en deck de sorts composé.");
        if (series.Status != SeriesStatus.SETUP) throw new AppException("La phase de préparation est terminée.");
        if (me.SpellBudgetLockedAt is not null) throw new AppException("Ton budget de sorts est déjà validé.");
        var clean = tokens.Where(kv => kv.Value > 0).ToDictionary();
        try { SeriesRules.ValidateSpellBudget(series.BestOf, clean, reference.AllowedSpellIds); }
        catch (DomainException e) { throw new AppException(e.Message); }
        me.SpellTokens = clean.Select(kv => new SpellToken { SeriesPlayerId = me.Id, SpellId = kv.Key, QuantityInitial = kv.Value, QuantityLeft = kv.Value }).ToList();
        db.SpellTokens.AddRange(me.SpellTokens);
        me.SpellBudgetLockedAt = clock.GetUtcNow();
        TryStart(series);
        return Task.CompletedTask;
    });

    public Task SubmitBansAsync(Guid seriesId, Guid userId, int[] championIds) => MutateAsync(seriesId, userId, (series, me) =>
    {
        if (series.Status != SeriesStatus.BANS) throw new AppException("Ce n'est pas la phase de bans.");
        if (series.Bans.Any(b => b.ByPlayerId == me.Id)) throw new AppException("Tes bans sont déjà envoyés.");
        var opp = Opponent(series, me);
        var ids = championIds.Distinct().ToArray();
        if (ids.Length != SeriesRules.BansPerPlayer) throw new AppException($"Choisis exactement {SeriesRules.BansPerPlayer} champions différents.");
        if (ids.Any(id => opp.Deck.All(d => d.ChampionId != id))) throw new AppException("Tu ne peux bannir que des champions du deck adverse.");
        foreach (var id in ids)
        {
            var ban = new Ban { SeriesId = series.Id, ByPlayerId = me.Id, TargetPlayerId = opp.Id, ChampionId = id, SubmittedAt = clock.GetUtcNow() };
            series.Bans.Add(ban);
            db.Bans.Add(ban);
        }

        if (series.Bans.Select(b => b.ByPlayerId).Distinct().Count() == 2)
        {
            foreach (var ban in series.Bans)
                series.Players.First(p => p.Id == ban.TargetPlayerId).Deck.First(d => d.ChampionId == ban.ChampionId).Banned = true;
            series.Status = SeriesStatus.IN_PROGRESS;
            notifier.Enqueue(series, NotifierEvent.All("BansRevealed", series.Bans.Select(b => new { bySlot = SlotOf(series, b.ByPlayerId), championId = b.ChampionId }).ToList()));
            CreateRound(series, 1, 1, null);
        }
        return Task.CompletedTask;
    });

    // =====================================================================
    // Manche : attribution, lobby, contrôle du pick
    // =====================================================================

    public Task SubmitPickAsync(Guid seriesId, Guid userId, int? championId, int[]? spells) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series) ?? throw new AppException("Aucune manche en cours.");
        if (round.Status != RoundStatus.ASSIGNMENT) throw new AppException("Les choix de cette manche sont déjà révélés.");
        var assignment = round.Assignments.First(a => a.PlayerId == me.Id);
        if (assignment.SubmittedAt is not null) throw new AppException("Ton choix est déjà verrouillé.");

        if (series.ChampionMode == ChampionMode.DECK)
        {
            if (championId is null) throw new AppException("Choisis un champion.");
            var entry = me.Deck.FirstOrDefault(d => d.ChampionId == championId) ?? throw new AppException("Ce champion n'est pas dans ton deck.");
            if (entry.Banned) throw new AppException("Ce champion a été banni.");
            if (entry.ConsumedInRoundId is not null) throw new AppException("Ce champion a déjà été joué.");
            assignment.ChampionId = championId;
        }
        else if (championId is not null && championId != assignment.ChampionId)
            throw new AppException("Le champion est imposé par le tirage.");

        if (series.SpellMode != SpellMode.FREE)
        {
            if (spells is null || spells.Length != 2 || spells[0] == spells[1]) throw new AppException("Choisis 2 sorts distincts.");
            var left = me.SpellTokens.ToDictionary(t => t.SpellId, t => t.QuantityLeft);
            foreach (var s in spells)
            {
                if (!left.TryGetValue(s, out var q) || q <= 0) throw new AppException("Plus de jeton pour ce sort.");
                left[s] = q - 1;
            }
            if (!SeriesRules.SpellTokensPlayable(left))
                throw new AppException("Ce choix laisserait trop de jetons d'un même sort pour les manches suivantes.");
            assignment.Spell1Id = spells[0];
            assignment.Spell2Id = spells[1];
        }
        assignment.SubmittedAt = clock.GetUtcNow();
        RevealIfComplete(series, round);
        return Task.CompletedTask;
    });

    /// <summary>Le créateur redemande l'ordre de création du lobby (ex. après un échec LCU).</summary>
    public Task RequestLaunchAsync(Guid seriesId, Guid userId) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series) ?? throw new AppException("Aucune manche en cours.");
        if (round.Status is not (RoundStatus.LOBBY or RoundStatus.CHAMP_SELECT)) throw new AppException("La manche n'est pas prête à être lancée.");
        if (me.Slot != Slot.A) throw new AppException("Seul le créateur de la série lance le lobby.");
        notifier.Enqueue(series, NotifierEvent.To(me.UserId, "LaunchLobby", LaunchPayload(series, round)));
        return Task.CompletedTask;
    });

    public Task ReportChampSelectAsync(Guid seriesId, Guid userId, int championId, bool locked, int[]? spells) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series);
        if (round is null || round.Status is not (RoundStatus.LOBBY or RoundStatus.CHAMP_SELECT)) return Task.CompletedTask;
        round.Status = RoundStatus.CHAMP_SELECT;
        var a = round.Assignments.First(x => x.PlayerId == me.Id);
        a.ReportedChampionId = championId > 0 ? championId : null;
        a.ReportedLocked = locked;
        if (spells is { Length: 2 }) { a.ReportedSpell1Id = spells[0]; a.ReportedSpell2Id = spells[1]; }

        var championOk = a.ReportedChampionId is null || a.ReportedChampionId == a.ChampionId;
        var spellsOk = SpellsConform(series, a);
        if (locked && a.ReportedChampionId is not null && !championOk)
        {
            VoidRound(series, round, $"Mauvais champion verrouillé par {me.User.DisplayName}");
            return Task.CompletedTask;
        }
        if (!championOk || !spellsOk)
        {
            notifier.Enqueue(series, NotifierEvent.All("PickWarning", new
            {
                slot = me.Slot.ToString(),
                championOk,
                spellsOk,
                expectedChampionId = a.ChampionId,
                expectedSpells = new[] { a.Spell1Id, a.Spell2Id },
            }));
        }
        return Task.CompletedTask;
    });

    public Task ReportGameStartedAsync(Guid seriesId, Guid userId, long lolGameId, int? championId, int[]? spells) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series);
        if (round is null || round.Status is not (RoundStatus.LOBBY or RoundStatus.CHAMP_SELECT or RoundStatus.IN_GAME)) return Task.CompletedTask;
        // Partie déjà utilisée par une manche précédente (pas encore quittée) : ce n'est pas la partie de cette manche.
        if (lolGameId > 0 && series.Rounds.Any(r => r.Id != round.Id && r.LolGameId == lolGameId)) return Task.CompletedTask;
        var a = round.Assignments.First(x => x.PlayerId == me.Id);
        if (championId is > 0) a.ReportedChampionId = championId;
        if (spells is { Length: 2 }) { a.ReportedSpell1Id = spells[0]; a.ReportedSpell2Id = spells[1]; }
        a.GameStartedReported = true;
        if (lolGameId > 0) round.LolGameId ??= lolGameId;

        if (a.ReportedChampionId is not null && a.ReportedChampionId != a.ChampionId)
        {
            VoidRound(series, round, $"Mauvais champion joué par {me.User.DisplayName}");
            return Task.CompletedTask;
        }
        if (!SpellsConform(series, a))
        {
            VoidRound(series, round, $"Sorts non conformes pour {me.User.DisplayName}");
            return Task.CompletedTask;
        }
        if (round.Status != RoundStatus.IN_GAME)
        {
            round.Status = RoundStatus.IN_GAME;
            round.StartedAt = clock.GetUtcNow();
            if (Objectives(round) is { } objectives)
            {
                // Labo : chaque joueur découvre son objectif secret au chargement, après le verrouillage des champions.
                foreach (var p in series.Players)
                {
                    var objective = SecretObjectives.Get(objectives.IdOf(p.Slot));
                    notifier.Enqueue(series, NotifierEvent.To(p.UserId, "SecretObjectiveRevealed",
                        new { roundId = round.Id, label = objective.Label, tier = objectives.Tier.ToString(), timeLimit = objectives.TimeLimit }));
                }
            }
        }
        return Task.CompletedTask;
    });

    // =====================================================================
    // En jeu : observations et arbitrage
    // =====================================================================

    public Task ReportObservationAsync(Guid seriesId, Guid userId, ObservationReport report) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series);
        // Tout ce qui arrive hors partie (après la validation, ou avant ReportGameStarted de la manche suivante) est ignoré.
        if (round is null || round.Status != RoundStatus.IN_GAME) return Task.CompletedTask;
        if (!Enum.TryParse<ObservationType>(report.Type, out var type)) throw new AppException("Type d'observation inconnu.");
        if (string.IsNullOrWhiteSpace(report.EventId) || report.EventId.Length > 64) throw new AppException("EventId invalide.");
        if (report.EventTime < 0 || double.IsNaN(report.EventTime)) throw new AppException("EventTime invalide.");

        if (round.Observations.Any(o => o.ReportedByPlayerId == me.Id && o.Type == type && o.EventId == report.EventId))
            return Task.CompletedTask; // idempotence

        Guid? subject = report.Payload?.Subject?.ToUpperInvariant() switch
        {
            "SELF" => me.Id,
            "OPPONENT" => Opponent(series, me).Id,
            _ => null,
        };
        if (type is ObservationType.KILL or ObservationType.FIRST_BLOOD or ObservationType.TURRET or ObservationType.CS && subject is null)
            throw new AppException("Bénéficiaire (subject) requis : SELF ou OPPONENT.");

        var obs = new Observation
        {
            RoundId = round.Id,
            ReportedByPlayerId = me.Id,
            Type = type,
            EventId = report.EventId,
            EventTime = report.EventTime,
            Payload = JsonSerializer.Serialize(report.Payload ?? new ObservationPayload(null, null, null), Json),
            SubjectPlayerId = subject,
            Value = report.Payload?.Value,
            ReceivedAt = clock.GetUtcNow(),
        };
        round.Observations.Add(obs);
        db.Observations.Add(obs);
        Arbitrate(series, round);
        return Task.CompletedTask;
    });

    /// <summary>Réévaluation périodique (validation « source unique » après le délai).</summary>
    public async Task TickAsync(Guid seriesId)
    {
        using var _ = await locks.AcquireAsync(seriesId);
        var series = await LoadAsync(seriesId);
        var round = CurrentRound(series);
        if (round is null || round.Status != RoundStatus.IN_GAME || round.Observations.Count == 0) return;
        var before = round.Status;
        Arbitrate(series, round);
        // Une observation « source unique » vient-elle d'atteindre le délai de confirmation ? → état à pousser.
        var now = clock.GetUtcNow();
        var justConfirmed = round.Observations.Any(o =>
            now - o.ReceivedAt >= Arbitration.ConfirmationDelay && now - o.ReceivedAt < Arbitration.ConfirmationDelay + ArbitrationTicker.Interval + TimeSpan.FromSeconds(1));
        if (round.Status != before || justConfirmed)
        {
            await db.SaveChangesAsync();
            await notifier.FlushAsync(this, series);
        }
        else notifier.Discard(series);
    }

    private void Arbitrate(Series series, Round round)
    {
        if (Objectives(round) is { } objectives)
        {
            ArbitrateSecret(series, round, objectives);
            return;
        }
        var outcome = Evaluate(series, round);
        if (outcome.Disputed)
        {
            round.Status = RoundStatus.DISPUTED;
            notifier.Enqueue(series, NotifierEvent.All("RoundDisputed", new { roundId = round.Id, reasons = outcome.Contradictions }));
            return;
        }
        if (outcome.Winner is { } winner)
        {
            var sat = outcome.WinningSatisfaction!;
            var cond = new WinningConditionDto(WinExpression.Describe(sat.Trigger), sat.Trigger.Condition, sat.Trigger.Threshold, sat.Time, outcome.WinnerSingleSource);
            ValidateRound(series, round, series.Players.First(p => p.Slot == winner), cond);
        }
    }

    /// <summary>
    /// Labo « objectifs secrets » : chacun son expression. Au temps limite sans vainqueur,
    /// la meilleure progression (faits antérieurs à la limite) l'emporte ; égalité → manche rejouée.
    /// </summary>
    private void ArbitrateSecret(Series series, Round round, RoundObjectives objectives)
    {
        var outcome = Evaluate(series, round);
        if (outcome.Disputed)
        {
            round.Status = RoundStatus.DISPUTED;
            notifier.Enqueue(series, NotifierEvent.All("RoundDisputed", new { roundId = round.Id, reasons = outcome.Contradictions }));
            return;
        }
        var limit = objectives.TimeLimit;
        if (outcome.Winner is { } winner && outcome.WinningSatisfaction!.Time <= limit)
        {
            var objective = SecretObjectives.Get(objectives.IdOf(winner));
            ValidateRound(series, round, series.Players.First(p => p.Slot == winner),
                new WinningConditionDto($"Objectif secret · {objective.Label}", null, null, outcome.WinningSatisfaction.Time, outcome.WinnerSingleSource));
            return;
        }
        var gameClock = Math.Max(GameClock(round), outcome.WinningSatisfaction?.Time ?? 0);
        if (gameClock < limit) return;
        // Un événement antérieur à la limite attend encore sa confirmation : on attend aussi.
        if (outcome.EarliestPendingTime is { } pending && pending <= limit) return;

        var progress = new[] { Slot.A, Slot.B }.ToDictionary(s => s, s => SecretObjectives.Progress(objectives.ExpressionOf(s), outcome.Facts[s], limit));
        static string Pct(double p) => $"{Math.Round(p * 100)} %";
        if (Math.Abs(progress[Slot.A] - progress[Slot.B]) < 0.005)
        {
            VoidRound(series, round, $"Égalité au temps limite ({Pct(progress[Slot.A])} chacun)");
            return;
        }
        var best = progress[Slot.A] > progress[Slot.B] ? Slot.A : Slot.B;
        var label = SecretObjectives.Get(objectives.IdOf(best)).Label;
        ValidateRound(series, round, series.Players.First(p => p.Slot == best),
            new WinningConditionDto($"Temps limite · {Pct(progress[best])} contre {Pct(progress[best.Other()])} ({label})", null, null, limit, false));
    }

    /// <summary>Délai avant d'accepter l'horloge d'un seul client (l'autre envoie la sienne toutes les 30 s).</summary>
    public static readonly TimeSpan SingleClockDelay = TimeSpan.FromSeconds(45);

    /// <summary>
    /// Temps de jeu atteint d'après les observations CLOCK : le plus petit des deux clients quand
    /// les deux en envoient (un client ne peut pas avancer seul l'horloge). Si un seul client en envoie
    /// (adversaire déconnecté), ses relevés comptent une fois le délai écoulé.
    /// </summary>
    private double GameClock(Round round)
    {
        var clocks = round.Observations.Where(o => o.Type == ObservationType.CLOCK).GroupBy(o => o.ReportedByPlayerId).ToList();
        if (clocks.Count == 2) return clocks.Min(g => g.Max(o => o.EventTime));
        var now = clock.GetUtcNow();
        return clocks.SelectMany(g => g).Where(o => now - o.ReceivedAt >= SingleClockDelay).Select(o => o.EventTime).DefaultIfEmpty(0).Max();
    }

    private static RoundObjectives? Objectives(Round round) =>
        round.LabState is null ? null : JsonSerializer.Deserialize<RoundObjectives>(round.LabState, Json);

    private static LabConfig? Lab(Series series) =>
        series.LabConfig is null ? null : JsonSerializer.Deserialize<LabConfig>(series.LabConfig, Json);

    private static string ExpressionLabel(Series series) =>
        Lab(series) is { } lab ? lab.Label : WinExpression.Describe(WinExpression.Parse(series.WinExpression));

    private ArbitrationOutcome Evaluate(Series series, Round round)
    {
        var events = round.Observations
            .Where(o => o.SubjectPlayerId is not null && o.Type is ObservationType.KILL or ObservationType.FIRST_BLOOD or ObservationType.TURRET or ObservationType.CS)
            .Select(o => new ObservedEvent(SlotOf(series, o.ReportedByPlayerId), o.Type, o.EventId, o.EventTime,
                SlotOf(series, o.SubjectPlayerId!.Value), o.Value, o.ReceivedAt))
            .ToList();
        if (Objectives(round) is { } objectives)
            return Arbitration.Evaluate(objectives.ExpressionOf, events, clock.GetUtcNow());
        return Arbitration.Evaluate(WinExpression.Parse(series.WinExpression), events, clock.GetUtcNow());
    }

    // =====================================================================
    // Annulation et litiges
    // =====================================================================

    public Task RequestVoidRoundAsync(Guid seriesId, Guid userId, string? reason) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series) ?? throw new AppException("Aucune manche en cours.");
        if (round.Status is RoundStatus.VALIDATED or RoundStatus.VOIDED) throw new AppException("Manche déjà terminée.");
        if (round.VoidRequestedBy is { } other && other != me.Id)
        {
            VoidRound(series, round, string.IsNullOrWhiteSpace(reason) ? "Annulée d'un commun accord" : $"Annulée d'un commun accord : {reason}");
            return Task.CompletedTask;
        }
        round.VoidRequestedBy = me.Id;
        notifier.Enqueue(series, NotifierEvent.All("VoidRequested", new { roundId = round.Id, bySlot = me.Slot.ToString(), reason }));
        return Task.CompletedTask;
    });

    /// <summary>Vote de résolution d'un litige (Q5) : "A", "B" ou "VOID". Désaccord → manche annulée.</summary>
    public Task VoteDisputeAsync(Guid seriesId, Guid userId, string vote) => MutateAsync(seriesId, userId, (series, me) =>
    {
        var round = CurrentRound(series) ?? throw new AppException("Aucune manche en cours.");
        if (round.Status != RoundStatus.DISPUTED) throw new AppException("La manche n'est pas en litige.");
        vote = vote.ToUpperInvariant();
        if (vote is not ("A" or "B" or "VOID")) throw new AppException("Vote attendu : A, B ou VOID.");
        if (me.Slot == Slot.A) round.DisputeVoteA = vote; else round.DisputeVoteB = vote;
        if (round.DisputeVoteA is null || round.DisputeVoteB is null) return Task.CompletedTask;

        if (round.DisputeVoteA == round.DisputeVoteB && round.DisputeVoteA != "VOID")
        {
            var winner = series.Players.First(p => p.Slot.ToString() == round.DisputeVoteA);
            ValidateRound(series, round, winner, new WinningConditionDto("Litige résolu par vote", null, null, null, false));
        }
        else VoidRound(series, round, "Litige non résolu");
        return Task.CompletedTask;
    });

    // =====================================================================
    // Transitions internes
    // =====================================================================

    private void TryStart(Series series)
    {
        if (series.Status != SeriesStatus.SETUP) return;
        var ready = series.Players.All(p =>
            p.PoolSnapshot is not null
            && (series.ChampionMode != ChampionMode.DECK || p.DeckLockedAt is not null)
            && (series.SpellMode == SpellMode.FREE || p.SpellBudgetLockedAt is not null));
        if (!ready) return;

        if (series.ChampionMode == ChampionMode.DECK)
        {
            series.Status = SeriesStatus.BANS;
            return;
        }
        series.Status = SeriesStatus.IN_PROGRESS;
        CreateRound(series, 1, 1, null);
    }

    private void CreateRound(Series series, int number, int attempt, Round? replayOf)
    {
        var round = new Round { SeriesId = series.Id, Number = number, Attempt = attempt, CreatedAt = clock.GetUtcNow() };
        var a = series.Players.First(p => p.Slot == Slot.A);
        var b = series.Players.First(p => p.Slot == Slot.B);
        var assignA = new RoundAssignment { RoundId = round.Id, PlayerId = a.Id };
        var assignB = new RoundAssignment { RoundId = round.Id, PlayerId = b.Id };

        if (replayOf is not null)
        {
            // Manche rejouée avec les mêmes attributions.
            foreach (var (target, source) in new[] { (assignA, replayOf.Assignments.First(x => x.PlayerId == a.Id)), (assignB, replayOf.Assignments.First(x => x.PlayerId == b.Id)) })
            {
                target.ChampionId = source.ChampionId;
                target.Spell1Id = source.Spell1Id;
                target.Spell2Id = source.Spell2Id;
                target.SubmittedAt = source.SubmittedAt;
            }
        }
        else
        {
            var validated = series.Rounds.Where(r => r.Status == RoundStatus.VALIDATED).SelectMany(r => r.Assignments).ToList();
            try
            {
                switch (series.ChampionMode)
                {
                    case ChampionMode.MIRROR:
                        var champ = DrawService.DrawMirror(series.DrawSeed, number, Pool(a)!.All, Pool(b)!.All, validated.Select(x => x.ChampionId ?? 0));
                        assignA.ChampionId = assignB.ChampionId = champ;
                        break;
                    case ChampionMode.RANDOM:
                        var (ca, cb) = DrawService.DrawRandom(series.DrawSeed, number, Pool(a)!.All, Pool(b)!.All,
                            validated.Where(x => x.PlayerId == a.Id).Select(x => x.ChampionId ?? 0),
                            validated.Where(x => x.PlayerId == b.Id).Select(x => x.ChampionId ?? 0));
                        assignA.ChampionId = ca;
                        assignB.ChampionId = cb;
                        break;
                }
            }
            catch (DomainException e)
            {
                series.Status = SeriesStatus.ABORTED;
                series.FinishedAt = clock.GetUtcNow();
                notifier.Enqueue(series, NotifierEvent.All("SeriesAborted", new { reason = e.Message }));
                return;
            }
            if (series.ChampionMode != ChampionMode.DECK && series.SpellMode == SpellMode.FREE)
            {
                assignA.SubmittedAt = assignB.SubmittedAt = clock.GetUtcNow();
            }
        }

        if (Lab(series) is { Mode: LabMode.SECRET_OBJECTIVES } lab)
            round.LabState = JsonSerializer.Serialize(SecretObjectives.Draw(series.DrawSeed, number, attempt, lab.Tier), Json);

        round.Assignments.AddRange([assignA, assignB]);
        series.Rounds.Add(round);
        db.Rounds.Add(round);

        foreach (var (player, assign) in new[] { (a, assignA), (b, assignB) })
        {
            notifier.Enqueue(series, NotifierEvent.To(player.UserId, "AssignmentReady", new
            {
                roundId = round.Id,
                number,
                attempt,
                championId = assign.ChampionId,
                spells = assign.Spell1Id is null ? null : new[] { assign.Spell1Id, assign.Spell2Id },
                mustChooseChampion = assign.ChampionId is null,
                mustChooseSpells = series.SpellMode != SpellMode.FREE && assign.Spell1Id is null,
            }));
        }
        RevealIfComplete(series, round);
    }

    private void RevealIfComplete(Series series, Round round)
    {
        if (round.Status != RoundStatus.ASSIGNMENT) return;
        if (round.Assignments.Any(a => a.SubmittedAt is null || a.ChampionId is null)) return;
        if (series.SpellMode != SpellMode.FREE && round.Assignments.Any(a => a.Spell1Id is null)) return;

        var now = clock.GetUtcNow();
        foreach (var a in round.Assignments) a.RevealedAt = now;
        round.Status = RoundStatus.LOBBY;
        notifier.Enqueue(series, NotifierEvent.All("PicksRevealed", new
        {
            roundId = round.Id,
            picks = round.Assignments.Select(a => new { slot = SlotOf(series, a.PlayerId), championId = a.ChampionId, spells = new[] { a.Spell1Id, a.Spell2Id } }),
        }));
        var creator = series.Players.First(p => p.Slot == Slot.A);
        notifier.Enqueue(series, NotifierEvent.To(creator.UserId, "LaunchLobby", LaunchPayload(series, round)));
    }

    private static object LaunchPayload(Series series, Round round)
    {
        var guest = series.Players.First(p => p.Slot == Slot.B);
        return new { roundId = round.Id, number = round.Number, attempt = round.Attempt, opponentPuuid = guest.RiotAccount.Puuid, opponentRiotId = guest.RiotAccount.RiotId };
    }

    private void VoidRound(Series series, Round round, string reason)
    {
        round.Status = RoundStatus.VOIDED;
        round.VoidReason = reason;
        round.EndedAt = clock.GetUtcNow();
        notifier.Enqueue(series, NotifierEvent.All("RoundVoided", new { roundId = round.Id, reason, nextAttempt = round.Attempt + 1 }));
        CreateRound(series, round.Number, round.Attempt + 1, round);
    }

    private void ValidateRound(Series series, Round round, SeriesPlayer winner, WinningConditionDto condition)
    {
        round.Status = RoundStatus.VALIDATED;
        round.WinnerPlayerId = winner.Id;
        round.WinningCondition = JsonSerializer.Serialize(condition, Json);
        round.EndedAt = clock.GetUtcNow();

        foreach (var a in round.Assignments)
        {
            var player = series.Players.First(p => p.Id == a.PlayerId);
            if (series.ChampionMode == ChampionMode.DECK)
            {
                var entry = player.Deck.FirstOrDefault(d => d.ChampionId == a.ChampionId);
                if (entry is not null) entry.ConsumedInRoundId = round.Id;
            }
            if (series.SpellMode != SpellMode.FREE)
            {
                foreach (var spell in new[] { a.Spell1Id, a.Spell2Id })
                {
                    var token = player.SpellTokens.FirstOrDefault(t => t.SpellId == spell);
                    if (token is { QuantityLeft: > 0 }) token.QuantityLeft--;
                }
            }
        }
        winner.RoundsWon++;
        notifier.Enqueue(series, NotifierEvent.All("RoundResolved", new
        {
            roundId = round.Id,
            number = round.Number,
            winnerSlot = winner.Slot.ToString(),
            winnerName = winner.User.DisplayName,
            condition = condition.Label,
            eventTime = condition.EventTime,
            singleSource = condition.SingleSource,
            score = new { a = series.Players.First(p => p.Slot == Slot.A).RoundsWon, b = series.Players.First(p => p.Slot == Slot.B).RoundsWon },
        }));

        if (winner.RoundsWon >= SeriesRules.WinsNeeded(series.BestOf))
        {
            series.Status = SeriesStatus.FINISHED;
            series.WinnerPlayerId = winner.Id;
            series.FinishedAt = clock.GetUtcNow();
            notifier.Enqueue(series, NotifierEvent.All("SeriesFinished", new
            {
                winnerSlot = winner.Slot.ToString(),
                winnerName = winner.User.DisplayName,
                score = new { a = series.Players.First(p => p.Slot == Slot.A).RoundsWon, b = series.Players.First(p => p.Slot == Slot.B).RoundsWon },
            }));
            return;
        }
        CreateRound(series, round.Number + 1, 1, null);
    }

    // =====================================================================
    // Utilitaires
    // =====================================================================

    /// <summary>Charge la série sous verrou, applique la mutation, sauvegarde puis notifie.</summary>
    private async Task MutateAsync(Guid seriesId, Guid userId, Func<Series, SeriesPlayer, Task> mutation)
    {
        using var _ = await locks.AcquireAsync(seriesId);
        var series = await LoadAsync(seriesId);
        var me = PlayerOf(series, userId);
        try
        {
            await mutation(series, me);
            await db.SaveChangesAsync();
        }
        catch
        {
            notifier.Discard(series);
            throw;
        }
        notifier.Enqueue(series, NotifierEvent.StateChanged);
        await notifier.FlushAsync(this, series);
    }

    private static SeriesPlayer PlayerOf(Series series, Guid userId) =>
        series.Players.FirstOrDefault(p => p.UserId == userId) ?? throw new AppException("Tu ne participes pas à cette série.", 403);

    private static SeriesPlayer Opponent(Series series, SeriesPlayer me) => series.Players.First(p => p.Id != me.Id);

    private static string SlotName(Series series, Guid playerId) => SlotOf(series, playerId).ToString();

    private static Slot SlotOf(Series series, Guid playerId) => series.Players.First(p => p.Id == playerId).Slot;

    public static Round? CurrentRound(Series series) =>
        series.Rounds.Where(r => r.Status is not (RoundStatus.VOIDED or RoundStatus.VALIDATED))
            .OrderByDescending(r => r.Number).ThenByDescending(r => r.Attempt).FirstOrDefault();

    private static PoolSnapshot? Pool(SeriesPlayer p) =>
        p.PoolSnapshot is null ? null : JsonSerializer.Deserialize<PoolSnapshot>(p.PoolSnapshot, Json);

    private static bool SpellsConform(Series series, RoundAssignment a)
    {
        if (series.SpellMode == SpellMode.FREE || a.ReportedSpell1Id is null) return true;
        var expected = new[] { a.Spell1Id, a.Spell2Id }.Order().ToArray();
        var reported = new[] { a.ReportedSpell1Id, a.ReportedSpell2Id }.Order().ToArray();
        return expected.SequenceEqual(reported);
    }

    // =====================================================================
    // Projection (masque les choix adverses non révélés)
    // =====================================================================

    public SeriesStateDto BuildState(Series series, SeriesPlayer me)
    {
        var opp = Opponent(series, me);
        var lab = Lab(series);
        var expr = lab is null ? WinExpression.Parse(series.WinExpression) : null;
        var bothDecks = series.Players.All(p => p.DeckLockedAt is not null);
        var bansRevealed = series.Status != SeriesStatus.SETUP && series.Status != SeriesStatus.BANS;
        var myPool = Pool(me);
        var current = CurrentRound(series);

        List<DeckEntryDto> Deck(SeriesPlayer p, bool showBans) =>
            p.Deck.OrderBy(d => d.ChampionId).Select(d => new DeckEntryDto(d.ChampionId, showBans && d.Banned, d.ConsumedInRoundId is not null)).ToList();
        List<SpellTokenDto> Tokens(SeriesPlayer p) =>
            p.SpellTokens.OrderBy(t => t.SpellId).Select(t => new SpellTokenDto(t.SpellId, t.QuantityInitial, t.QuantityLeft)).ToList();

        var rounds = series.Rounds.OrderBy(r => r.Number).ThenBy(r => r.Attempt).Select(r => new RoundDto(
            r.Id, r.Number, r.Attempt, r.Status.ToString(), r.VoidReason, r.LolGameId,
            r.WinnerPlayerId is null ? null : SlotName(series, r.WinnerPlayerId.Value),
            r.WinningCondition is null ? null : JsonSerializer.Deserialize<WinningConditionDto>(r.WinningCondition, Json),
            r.StartedAt, r.EndedAt,
            r.Assignments.OrderBy(a => SlotOf(series, a.PlayerId)).Select(a =>
            {
                var visible = a.PlayerId == me.Id || a.RevealedAt is not null;
                var conform = (a.ReportedChampionId is null || a.ReportedChampionId == a.ChampionId) && SpellsConform(series, a);
                return new AssignmentDto(SlotName(series, a.PlayerId), visible ? a.ChampionId : null,
                    visible ? a.Spell1Id : null, visible ? a.Spell2Id : null, a.SubmittedAt is not null, a.RevealedAt is not null, conform);
            }).ToList(),
            r.VoidRequestedBy is null ? null : SlotName(series, r.VoidRequestedBy.Value),
            me.Slot == Slot.A ? r.DisputeVoteA : r.DisputeVoteB)).ToList();

        LiveDto? live = null;
        if (current is { Status: RoundStatus.IN_GAME or RoundStatus.DISPUTED })
        {
            var outcome = Evaluate(series, current);
            live = new LiveDto(
                new[] { Slot.A, Slot.B }.ToDictionary(s => s.ToString(), s =>
                {
                    var f = outcome.Facts[s];
                    return new PlayerProgressDto(f.Kills, f.FirstBloodTime is not null, f.FirstTowerTime is not null, f.Cs,
                        outcome.Satisfactions.GetValueOrDefault(s)?.Time);
                }),
                outcome.Confirmed.Where(e => e.Type != ObservationType.CS).OrderByDescending(e => e.EventTime)
                    .Select(e => new ValidatedEventDto(e.Type.ToString(), e.Subject.ToString(), e.EventTime, e.Value, e.SingleSource)).ToList(),
                outcome.EarliestPendingTime is not null,
                outcome.Contradictions);
        }

        var deckNotInPool = myPool is null ? [] : me.Deck.Where(d => !d.Banned && d.ConsumedInRoundId is null && !myPool.All.Contains(d.ChampionId)).Select(d => d.ChampionId).ToArray();

        return new SeriesStateDto
        {
            Id = series.Id,
            Status = series.Status.ToString(),
            BestOf = series.BestOf,
            WinsNeeded = SeriesRules.WinsNeeded(series.BestOf),
            ChampionMode = series.ChampionMode.ToString(),
            SpellMode = series.SpellMode.ToString(),
            WinExpression = expr,
            WinExpressionLabel = ExpressionLabel(series),
            WinnerSlot = series.WinnerPlayerId is null ? null : SlotName(series, series.WinnerPlayerId.Value),
            MySlot = me.Slot.ToString(),
            CreatedAt = series.CreatedAt,
            FinishedAt = series.FinishedAt,
            Rules = new RulesDto(SeriesRules.MinDeckSize(series.BestOf), SeriesRules.BansPerPlayer, SeriesRules.SpellBudget(series.BestOf),
                SeriesRules.SpellCap(series.BestOf), reference.AllowedSpellIds),
            Players = series.Players.OrderBy(p => p.Slot).Select(p =>
            {
                var pool = Pool(p);
                return new PlayerDto(p.Slot.ToString(), p.UserId, p.User.DisplayName, p.RiotAccount.RiotId, p.RiotAccount.Puuid, p.RiotAccount.ProfileIconId, p.RoundsWon,
                    pool?.All.Count ?? 0, pool?.Free.Length ?? 0, p.PoolUpdatedAt, p.DeckLockedAt is not null, p.Deck.Count,
                    p.SpellBudgetLockedAt is not null, series.Bans.Any(b => b.ByPlayerId == p.Id));
            }).ToList(),
            Me = new MyDataDto(myPool?.Owned ?? [], myPool?.Free ?? [], Deck(me, bansRevealed), Tokens(me),
                series.Bans.Where(b => b.ByPlayerId == me.Id).Select(b => b.ChampionId).ToArray(), deckNotInPool),
            Opponent = new OpponentDataDto(
                bothDecks ? Deck(opp, bansRevealed) : null,
                bansRevealed ? series.Bans.Where(b => b.ByPlayerId == opp.Id).Select(b => b.ChampionId).ToArray() : null,
                series.Status == SeriesStatus.SETUP ? null : Tokens(opp)),
            Rounds = rounds,
            CurrentRoundId = current?.Id,
            Live = live,
            Lab = lab is null ? null : BuildLab(series, lab, me, current),
        };
    }

    /// <summary>
    /// Vue labo d'un joueur : son objectif dès le début de la partie, celui de l'adversaire
    /// seulement une fois la manche terminée (jamais pendant).
    /// </summary>
    private LabStateDto BuildLab(Series series, LabConfig lab, SeriesPlayer me, Round? current)
    {
        LabRoundDto? currentDto = null;
        if (current is not null && Objectives(current) is { } objectives)
        {
            var started = current.StartedAt is not null;
            double? myProgress = null;
            if (started && current.Status is RoundStatus.IN_GAME or RoundStatus.DISPUTED)
                myProgress = SecretObjectives.Progress(objectives.ExpressionOf(me.Slot), Evaluate(series, current).Facts[me.Slot]);
            currentDto = new LabRoundDto(current.Id, objectives.Tier.ToString(), objectives.TimeLimit,
                started ? LabMapping.ToDto(SecretObjectives.Get(objectives.IdOf(me.Slot))) : null, myProgress, GameClock(current));
        }

        var history = series.Rounds
            .Where(r => r.StartedAt is not null && r.Status is RoundStatus.VALIDATED or RoundStatus.VOIDED)
            .OrderBy(r => r.Number).ThenBy(r => r.Attempt)
            .Select(r => (Round: r, Objectives: Objectives(r)))
            .Where(x => x.Objectives is not null)
            .Select(x => new LabRevealDto(x.Round.Id, x.Round.Number, x.Round.Attempt,
                LabMapping.ToDto(SecretObjectives.Get(x.Objectives!.IdOf(me.Slot))),
                LabMapping.ToDto(SecretObjectives.Get(x.Objectives.IdOf(me.Slot.Other())))))
            .ToList();

        return new LabStateDto(lab.Mode.ToString(), lab.Tier?.ToString(), currentDto, history);
    }
}
