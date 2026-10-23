using System.Text.Json;
using Api.Data;
using Api.Domain.Battle;
using Api.Domain.Capsules;
using Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

public sealed class BattleOptions
{
    public int StartRating { get; set; } = 1000;
    public int KFactor { get; set; } = 32;
    /// <summary>Victoires récompensées en essence par jour (heure de Paris).</summary>
    public int RewardedWinsPerDay { get; set; } = 4;
    /// <summary>Essence d'une victoire ; 0 = la moitié du prix d'une relique (2 victoires = 1 relique).</summary>
    public int WinEssence { get; set; }
    /// <summary>Après une attaque, la même cible n'est réattaquable qu'après sa riposte ou ce délai.</summary>
    public int RematchHours { get; set; } = 24;
    public string TimeZone { get; set; } = "Europe/Paris";
}

/// <summary>
/// Combats de reliques : roster contre roster, en asynchrone (le défenseur n'a pas besoin d'être là).
/// Anti-farm : une seule attaque sur un même joueur tant qu'il n'a pas riposté (ou que le délai n'est pas écoulé),
/// essence plafonnée à quelques victoires par jour ; la cote (Elo) compte toujours.
/// </summary>
public sealed class BattleService(
    AppDbContext db, CapsuleCatalogService catalogs, CapsuleLocks locks, PushService push, RelicSocialService social, TimeProvider clock,
    Microsoft.Extensions.Options.IOptions<BattleOptions> options, Microsoft.Extensions.Options.IOptions<CapsuleOptions> capsuleOptions,
    ILogger<BattleService> logger)
{
    private const int SuggestionCount = 8;
    private readonly BattleOptions _o = options.Value;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };

    private int WinEssence => _o.WinEssence > 0 ? _o.WinEssence : capsuleOptions.Value.EssencePerCapsule / 2;
    private TimeSpan Rematch => TimeSpan.FromHours(_o.RematchHours);

    public async Task<ArenaDto> GetArenaAsync(Guid userId)
    {
        var catalog = await catalogs.GetAsync();
        var now = clock.GetUtcNow();
        var profile = await db.BattleProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        var rating = profile?.Rating ?? _o.StartRating;
        var team = Units(catalog, await social.GetRosterAsync(userId));

        // Adversaires : amis, puis joueurs à roster complet les plus proches en cote.
        var friends = await db.RelicFriends.Where(f => f.UserId == userId).Select(f => f.FriendId).ToListAsync();
        var rosters = await db.CapsuleWallets.Where(w => w.Roster != null && w.UserId != userId)
            .OrderByDescending(w => w.TotalOpened).Take(500).Select(w => new { w.UserId, w.Roster }).ToListAsync();
        var ready = rosters.Where(r => Units(catalog, RelicSocialService.ParseRoster(r.Roster)) is not null).Select(r => r.UserId).ToList();
        var ratings = await db.BattleProfiles.Where(p => ready.Contains(p.UserId)).ToDictionaryAsync(p => p.UserId, p => p.Rating);
        int RatingOf(Guid id) => ratings.GetValueOrDefault(id, _o.StartRating);
        var friendSet = friends.ToHashSet();
        var ids = ready.Where(friendSet.Contains)
            .Concat(ready.Where(id => !friendSet.Contains(id)).OrderBy(id => Math.Abs(RatingOf(id) - rating)).Take(SuggestionCount))
            .ToList();

        var cards = await social.CardsAsync(ids, friendSet);
        var recent = await RecentPairsAsync(userId, ids, now);
        var opponents = ids.Where(cards.ContainsKey).Select(id =>
        {
            var (availableAt, revenge) = Availability(userId, recent.GetValueOrDefault(id));
            return new ArenaOpponentDto(cards[id], RatingOf(id), friendSet.Contains(id), revenge, availableAt);
        })
            .OrderByDescending(o => o.Revenge).ThenBy(o => o.AvailableAt is not null).ThenByDescending(o => o.Friend).ThenByDescending(o => o.Rating)
            .ToList();

        var (dayStart, dayEnd) = Today(now);
        var rewarded = await db.RelicBattles.CountAsync(b => b.AttackerId == userId && b.Essence > 0 && b.CreatedAt >= dayStart);
        return new ArenaDto(rating, profile?.Wins ?? 0, profile?.Losses ?? 0, profile is null ? null : await RankAsync(profile),
            rewarded, _o.RewardedWinsPerDay, WinEssence, dayEnd, _o.RematchHours,
            team is not null, team is null ? null : BattleRules.Analyze(team, LineNames(catalog)), opponents);
    }

    public async Task<BattlePreviewDto> PreviewAsync(Guid userId, Guid opponentId)
    {
        var catalog = await catalogs.GetAsync();
        var (mine, theirs) = await TeamsAsync(catalog, userId, opponentId);
        var (a, b) = BattleRules.Analyze(mine, theirs, LineNames(catalog));
        var friend = await db.RelicFriends.AnyAsync(f => f.UserId == userId && f.FriendId == opponentId);
        var card = (await social.CardsAsync([opponentId], friend ? [opponentId] : [])).GetValueOrDefault(opponentId)
            ?? throw new AppException("Joueur introuvable.", 404);
        var rating = await db.BattleProfiles.Where(p => p.UserId == opponentId).Select(p => (int?)p.Rating).FirstOrDefaultAsync() ?? _o.StartRating;
        var recent = await RecentPairsAsync(userId, [opponentId], clock.GetUtcNow());
        return new BattlePreviewDto(card, rating, a, b, Availability(userId, recent.GetValueOrDefault(opponentId)).AvailableAt);
    }

    public async Task<BattleDto> AttackAsync(Guid userId, Guid opponentId)
    {
        if (opponentId == userId) throw new AppException("Tu ne peux pas t'attaquer toi-même.");
        var catalog = await catalogs.GetAsync();
        // Verrous des deux joueurs, toujours dans le même ordre : pas d'interblocage entre deux attaques croisées.
        var (first, second) = userId.CompareTo(opponentId) < 0 ? (userId, opponentId) : (opponentId, userId);
        using var l1 = await locks.AcquireAsync(first);
        using var l2 = await locks.AcquireAsync(second);

        var (mine, theirs) = await TeamsAsync(catalog, userId, opponentId);
        var now = clock.GetUtcNow();
        var (availableAt, _) = Availability(userId, (await RecentPairsAsync(userId, [opponentId], now)).GetValueOrDefault(opponentId));
        if (availableAt is { } at)
            throw new AppException($"Tu as déjà attaqué ce joueur : attends sa riposte, ou {Wait(at - now)}.", 409);

        var attacker = await GetOrCreateProfileAsync(userId, now);
        var defender = await GetOrCreateProfileAsync(opponentId, now);
        var seed = CryptoRandom.Instance.Next();
        var outcome = BattleRules.Simulate(mine, theirs, seed, LineNames(catalog));
        var won = outcome.Winner == BattleSide.A;

        var expected = 1 / (1 + Math.Pow(10, (defender.Rating - attacker.Rating) / 400.0));
        var delta = (int)Math.Round(_o.KFactor * ((won ? 1 : 0) - expected));
        var battle = new RelicBattle
        {
            AttackerId = userId, DefenderId = opponentId, Seed = seed, AttackerWon = won, CreatedAt = now,
            AttackerRatingBefore = attacker.Rating, DefenderRatingBefore = defender.Rating,
            Result = JsonSerializer.Serialize(outcome, Json),
        };
        attacker.Rating = Math.Max(0, attacker.Rating + delta);
        defender.Rating = Math.Max(0, defender.Rating - delta);
        if (won) { attacker.Wins++; defender.Losses++; } else { attacker.Losses++; defender.Wins++; }
        attacker.UpdatedAt = defender.UpdatedAt = now;
        battle.AttackerRatingAfter = attacker.Rating;
        battle.DefenderRatingAfter = defender.Rating;

        if (won)
        {
            var (dayStart, _) = Today(now);
            var rewarded = await db.RelicBattles.CountAsync(b => b.AttackerId == userId && b.Essence > 0 && b.CreatedAt >= dayStart);
            var wallet = await db.CapsuleWallets.FirstOrDefaultAsync(w => w.UserId == userId);
            if (rewarded < _o.RewardedWinsPerDay && wallet is not null)
            {
                battle.Essence = WinEssence;
                wallet.Essence += WinEssence;
            }
        }
        db.RelicBattles.Add(battle);
        await db.SaveChangesAsync();

        var names = await db.Users.Where(u => u.Id == userId || u.Id == opponentId).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        await NotifyDefenderAsync(opponentId, names.GetValueOrDefault(userId, "Un joueur"), !won, battle.DefenderRatingAfter - battle.DefenderRatingBefore);
        return await ToDtoAsync(battle, outcome);
    }

    public async Task<List<BattleSummaryDto>> HistoryAsync(Guid userId)
    {
        var battles = await db.RelicBattles.Where(b => b.AttackerId == userId || b.DefenderId == userId)
            .OrderByDescending(b => b.CreatedAt).Take(30).ToListAsync();
        var others = battles.Select(b => b.AttackerId == userId ? b.DefenderId : b.AttackerId).Distinct().ToList();
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => others.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        return battles.Select(b =>
        {
            var attacked = b.AttackerId == userId;
            var other = attacked ? b.DefenderId : b.AttackerId;
            users.TryGetValue(other, out var u);
            return new BattleSummaryDto(b.Id, b.CreatedAt, attacked, other, u?.DisplayName ?? "Joueur supprimé", u?.RiotAccount?.ProfileIconId,
                attacked == b.AttackerWon,
                attacked ? b.AttackerRatingAfter - b.AttackerRatingBefore : b.DefenderRatingAfter - b.DefenderRatingBefore,
                attacked ? b.Essence : 0);
        }).ToList();
    }

    /// <summary>Rejeu d'un combat, réservé à ses deux participants.</summary>
    public async Task<BattleDto> GetAsync(Guid userId, Guid battleId)
    {
        var battle = await db.RelicBattles.FirstOrDefaultAsync(b => b.Id == battleId && (b.AttackerId == userId || b.DefenderId == userId))
            ?? throw new AppException("Combat introuvable.", 404);
        return await ToDtoAsync(battle, JsonSerializer.Deserialize<BattleOutcome>(battle.Result, Json)!);
    }

    /// <summary>Classement global : joueurs ayant au moins un combat, par cote.</summary>
    public async Task<LadderDto> LadderAsync(Guid userId)
    {
        var ranked = db.BattleProfiles.Where(p => p.Wins + p.Losses > 0);
        var top = await ranked.OrderByDescending(p => p.Rating).ThenByDescending(p => p.Wins).ThenBy(p => p.UpdatedAt).Take(100).ToListAsync();
        var ids = top.Select(p => p.UserId).Append(userId).ToList();
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        LadderEntryDto Entry(BattleProfile p, int rank) =>
            new(rank, p.UserId, users.GetValueOrDefault(p.UserId)?.DisplayName ?? "?", users.GetValueOrDefault(p.UserId)?.RiotAccount?.ProfileIconId,
                p.Rating, p.Wins, p.Losses);

        var entries = new List<LadderEntryDto>();
        for (var i = 0; i < top.Count; i++)
            entries.Add(Entry(top[i], i > 0 && top[i].Rating == top[i - 1].Rating ? entries[i - 1].Rank : i + 1));
        var mine = await ranked.FirstOrDefaultAsync(p => p.UserId == userId);
        var me = entries.FirstOrDefault(e => e.UserId == userId) ?? (mine is null ? null : Entry(mine, await RankAsync(mine)));
        return new LadderDto(entries, me);
    }

    private async Task<int> RankAsync(BattleProfile p) =>
        await db.BattleProfiles.CountAsync(o => o.Wins + o.Losses > 0 && o.Rating > p.Rating) + 1;

    private async Task<BattleDto> ToDtoAsync(RelicBattle b, BattleOutcome o)
    {
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => u.Id == b.AttackerId || u.Id == b.DefenderId).ToDictionaryAsync(u => u.Id);
        BattlePlayerDto Player(Guid id, int before, int after) =>
            new(id, users.GetValueOrDefault(id)?.DisplayName ?? "Joueur supprimé", users.GetValueOrDefault(id)?.RiotAccount?.ProfileIconId, before, after);
        return new BattleDto(b.Id, b.CreatedAt,
            Player(b.AttackerId, b.AttackerRatingBefore, b.AttackerRatingAfter), Player(b.DefenderId, b.DefenderRatingBefore, b.DefenderRatingAfter),
            b.AttackerWon, b.Essence, o.Minutes, o.A, o.B, o.Events);
    }

    private async Task<(List<BattleUnit> Mine, List<BattleUnit> Theirs)> TeamsAsync(CapsuleCatalog catalog, Guid userId, Guid opponentId)
    {
        if (opponentId == userId) throw new AppException("Tu ne peux pas t'attaquer toi-même.");
        if (!await db.Users.AnyAsync(u => u.Id == opponentId)) throw new AppException("Joueur introuvable.", 404);
        var mine = Units(catalog, await social.GetRosterAsync(userId))
            ?? throw new AppException("Complète ton roster (5 postes) pour combattre.", 409);
        var theirs = Units(catalog, await social.GetRosterAsync(opponentId))
            ?? throw new AppException("Ce joueur n'a pas encore de roster complet.", 409);
        return (mine, theirs);
    }

    /// <summary>Roster → unités de combat ; null si un poste est vide ou un objet absent du catalogue.</summary>
    private static List<BattleUnit>? Units(CapsuleCatalog catalog, List<RosterSlotDto?> roster)
    {
        var units = new List<BattleUnit>();
        foreach (var slot in roster)
        {
            if (slot is null) return null;
            int championId;
            Rarity rarity;
            int[] lines = [];
            if (slot.Kind == CapsuleItemKind.CHAMPION) { championId = slot.ItemId; rarity = CapsuleRules.ChampionRarity; }
            else
            {
                if (!catalog.SkinById.TryGetValue(slot.ItemId, out var skin)) return null;
                (championId, rarity, lines) = (skin.ChampionId, skin.Rarity, skin.Lines);
            }
            if (!catalog.ChampionById.TryGetValue(championId, out var champ)) return null;
            var classes = (champ.Roles ?? []).Select(BattleRules.ParseClass).OfType<ChampionClass>().ToArray();
            units.Add(new BattleUnit(slot.Kind, slot.ItemId, champ.Name, champ.Id, rarity, classes, lines));
        }
        return units.Count == BattleRules.TeamSize ? units : null;
    }

    private static Dictionary<int, string> LineNames(CapsuleCatalog catalog) => catalog.Lines.ToDictionary(l => l.Id, l => l.Name);

    /// <summary>Dernier combat de chaque paire (joueur, adversaire) dans la fenêtre de revanche.</summary>
    private async Task<Dictionary<Guid, RelicBattle>> RecentPairsAsync(Guid userId, List<Guid> others, DateTimeOffset now)
    {
        var since = now - Rematch;
        var battles = await db.RelicBattles
            .Where(b => b.CreatedAt > since
                && ((b.AttackerId == userId && others.Contains(b.DefenderId)) || (b.DefenderId == userId && others.Contains(b.AttackerId))))
            .ToListAsync();
        return battles.GroupBy(b => b.AttackerId == userId ? b.DefenderId : b.AttackerId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(b => b.CreatedAt).First());
    }

    /// <summary>
    /// Règle anti-farm : si le dernier combat de la paire (dans la fenêtre) est mon attaque, la cible est bloquée jusqu'à sa riposte
    /// ou la fin de la fenêtre ; si c'est son attaque, la revanche est ouverte.
    /// </summary>
    private (DateTimeOffset? AvailableAt, bool Revenge) Availability(Guid userId, RelicBattle? last) =>
        last is null ? (null, false)
        : last.AttackerId == userId ? (last.CreatedAt + Rematch, false)
        : (null, true);

    private async Task<BattleProfile> GetOrCreateProfileAsync(Guid userId, DateTimeOffset now)
    {
        var profile = await db.BattleProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile is not null) return profile;
        profile = new BattleProfile { UserId = userId, Rating = _o.StartRating, UpdatedAt = now };
        db.BattleProfiles.Add(profile);
        return profile;
    }

    /// <summary>Journée en cours (minuit à minuit, fuseau configuré, UTC si inconnu).</summary>
    private (DateTimeOffset Start, DateTimeOffset End) Today(DateTimeOffset now)
    {
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(_o.TimeZone); }
        catch (Exception) { tz = TimeZoneInfo.Utc; }
        var local = TimeZoneInfo.ConvertTime(now, tz);
        var midnight = local.Date;
        DateTimeOffset At(DateTime d) => new(d, tz.GetUtcOffset(d));
        return (At(midnight), At(midnight.AddDays(1)));
    }

    private static string Wait(TimeSpan left) =>
        left.TotalHours >= 1 ? $"reviens dans {Math.Ceiling(left.TotalHours)} h" : $"reviens dans {Math.Max(1, Math.Ceiling(left.TotalMinutes))} min";

    private async Task NotifyDefenderAsync(Guid defenderId, string attackerName, bool defended, int delta)
    {
        try
        {
            await push.SendAsync(db, defenderId, new
            {
                title = defended ? "Défense réussie !" : "Ton roster est tombé",
                body = $"{attackerName} t'a attaqué ({(delta >= 0 ? "+" : "")}{delta} pts). {(defended ? "Ton roster tient bon." : "La revanche est ouverte.")}",
                tag = "battle",
                url = "/reliques/?view=arena",
            });
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Notification de combat non envoyée");
        }
    }
}
