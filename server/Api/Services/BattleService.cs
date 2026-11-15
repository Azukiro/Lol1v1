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
    /// <summary>
    /// Diviseur de l'Elo : l'écart de cote qui donne 10 contre 1. Le classique 400 suppose des résultats très prévisibles ;
    /// les combats de reliques restent proches du pile ou face, 1200 aligne le score attendu sur les victoires réelles
    /// (200 points d'avance ≈ 60 %), pour qu'attaquer un joueur moins bien classé ne coûte pas de cote en moyenne.
    /// </summary>
    public double EloScale { get; set; } = 1200;
    /// <summary>
    /// Part du gain de l'attaquant que perd un défenseur battu (il n'était pas là pour jouer) ; une défense réussie rapporte la mise entière.
    /// Les cotes gonflent un peu avec le volume de combats : 0,75 limite l'effet, le retour à mi-chemin de 1000 en fin de saison fait le reste.
    /// </summary>
    public double DefenderLossShare { get; set; } = 0.75;
    /// <summary>Victoires récompensées en essence par jour (heure de Paris).</summary>
    public int RewardedWinsPerDay { get; set; } = 4;
    /// <summary>Essence d'une victoire ; 0 = la moitié du prix d'une relique (2 victoires = 1 relique).</summary>
    public int WinEssence { get; set; }
    /// <summary>Après une attaque, la même cible n'est réattaquable qu'après sa riposte ou ce délai.</summary>
    public int RematchHours { get; set; } = 24;
    public string TimeZone { get; set; } = "Europe/Paris";
    /// <summary>Compte de test : le battre ne vaut rien, perdre contre lui affiche une étiquette moqueuse (vide = désactivé).</summary>
    public string ShameAccount { get; set; } = "AmiTest";
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
        await EnsureSeasonAsync();
        await EnsureBossPayoutAsync();
        var catalog = await catalogs.GetAsync();
        var now = clock.GetUtcNow();
        var ev = ArenaEvents.Current(Local(now));
        var profile = await db.BattleProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        var rating = profile?.Rating ?? _o.StartRating;
        var meta = await CurrentMetaAsync(catalog);
        var team = Units(catalog, await social.GetRosterAsync(userId), meta.Changes);

        // Adversaires : amis, puis joueurs à roster complet les plus proches en cote.
        var friends = await db.RelicFriends.Where(f => f.UserId == userId).Select(f => f.FriendId).ToListAsync();
        var rosters = await db.CapsuleWallets.Where(w => w.Roster != null && w.UserId != userId)
            .OrderByDescending(w => w.TotalOpened).Take(500).Select(w => new { w.UserId, w.Roster }).ToListAsync();
        var ready = rosters.Where(r => Units(catalog, RelicSocialService.ParseRoster(r.Roster), []) is not null).Select(r => r.UserId).ToList();
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
        var ranked = profile is { } p && p.Wins + p.Losses > 0;
        var last = await db.SeasonResults.Where(r => r.UserId == userId && !r.Seen).OrderByDescending(r => r.SeasonId).FirstOrDefaultAsync();
        var seasonId = SeasonId(now);
        var boss = await db.BossScores.Where(b => b.UserId == userId && b.Paid && !b.Seen).OrderByDescending(b => b.WeekId).FirstOrDefaultAsync();
        BossResultDto? lastBoss = boss is null ? null : new(boss.WeekId, Boss.NameOf(boss.WeekId), boss.Rank,
            await db.BossScores.CountAsync(b => b.WeekId == boss.WeekId), boss.Best, boss.RewardStandard, boss.RewardPremium);
        return new ArenaDto(rating, profile?.Wins ?? 0, profile?.Losses ?? 0, ranked ? await RankAsync(profile!) : null,
            rewarded, _o.RewardedWinsPerDay, WinEssence * (ev?.EssenceMultiplier ?? 1), dayEnd, _o.RematchHours,
            team is not null, team is null ? null : BattleRules.Analyze(team, LineNames(catalog)), opponents,
            new SeasonDto(seasonId, Seasons.Number(seasonId), SeasonEnd(now), Seasons.TierOf(rating), Seasons.Floor(rating), Seasons.NextThreshold(rating),
                profile?.PeakRating ?? rating),
            last is null ? null : ToDto(last) with { Players = await db.SeasonResults.CountAsync(r => r.SeasonId == last.SeasonId) },
            profile?.SeasonTier, PassOf(profile), EventDto(ArenaEvents.CurrentOrNext(Local(now))),
            profile?.Legend ?? false, lastBoss);
    }

    private static PassDto PassOf(BattleProfile? p) => new(p?.PassXp ?? 0, p?.PassLevel ?? 0, SeasonPass.XpPerLevel, SeasonPass.MaxLevel,
        SeasonPass.Rewards, SeasonPass.AttackWinXp, SeasonPass.AttackLossXp, SeasonPass.DefenseWinXp, SeasonPass.BossXp);

    private ArenaEventDto EventDto(ArenaEvent e)
    {
        var tz = Zone;
        DateTimeOffset At(DateTime d) => new DateTimeOffset(d, tz.GetUtcOffset(d)).ToUniversalTime();
        var local = Local(clock.GetUtcNow());
        return new(e.Id, e.Kind, e.Title, e.Text, At(e.StartsLocal), At(e.EndsLocal), local >= e.StartsLocal && local < e.EndsLocal);
    }

    /// <summary>
    /// Verse l'XP du pass et les récompenses des niveaux franchis (dans le portefeuille). Sans portefeuille, rien n'est versé
    /// et le niveau n'avance pas : les récompenses arriveront au prochain gain.
    /// </summary>
    public static List<PassReward> GrantPassXp(BattleProfile p, CapsuleWallet? wallet, int xp)
    {
        p.PassXp += xp;
        if (wallet is null) return [];
        var level = SeasonPass.LevelOf(p.PassXp);
        var reached = SeasonPass.Rewards.Where(r => r.Level > p.PassLevel && r.Level <= level).ToList();
        foreach (var r in reached)
        {
            wallet.Essence += r.Essence;
            wallet.Stored += r.Standard;
            wallet.PremiumStored += r.Premium;
            if (r.Legend) p.Legend = true;
        }
        p.PassLevel = Math.Max(p.PassLevel, level);
        return reached;
    }

    public async Task<BattlePreviewDto> PreviewAsync(Guid userId, Guid opponentId)
    {
        var catalog = await catalogs.GetAsync();
        var (mine, theirs) = await TeamsAsync(catalog, userId, opponentId, (await CurrentMetaAsync(catalog)).Changes);
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
        await EnsureSeasonAsync();
        var catalog = await catalogs.GetAsync();
        // Verrous des deux joueurs, toujours dans le même ordre : pas d'interblocage entre deux attaques croisées.
        var (first, second) = userId.CompareTo(opponentId) < 0 ? (userId, opponentId) : (opponentId, userId);
        using var l1 = await locks.AcquireAsync(first);
        using var l2 = await locks.AcquireAsync(second);

        var (mine, theirs) = await TeamsAsync(catalog, userId, opponentId, (await CurrentMetaAsync(catalog)).Changes);
        var now = clock.GetUtcNow();
        var (availableAt, _) = Availability(userId, (await RecentPairsAsync(userId, [opponentId], now)).GetValueOrDefault(opponentId));
        if (availableAt is { } at)
            throw new AppException($"Tu as déjà attaqué ce joueur : attends sa riposte, ou {Wait(at - now)}.", 409);

        var attacker = await GetOrCreateProfileAsync(userId, now);
        var defender = await GetOrCreateProfileAsync(opponentId, now);
        var ev = ArenaEvents.Current(Local(now));
        var wallets = await db.CapsuleWallets.Where(w => w.UserId == userId || w.UserId == opponentId).ToDictionaryAsync(w => w.UserId);
        var seed = CryptoRandom.Instance.Next();
        var outcome = BattleRules.Simulate(mine, theirs, seed, LineNames(catalog));
        var won = outcome.Winner == BattleSide.A;

        var delta = RatingDelta(attacker.Rating, defender.Rating, won, _o.KFactor, _o.EloScale);
        var battle = new RelicBattle
        {
            AttackerId = userId, DefenderId = opponentId, Seed = seed, AttackerWon = won, CreatedAt = now,
            AttackerRatingBefore = attacker.Rating, DefenderRatingBefore = defender.Rating,
            Result = JsonSerializer.Serialize(outcome, Json),
        };
        attacker.Rating = Math.Max(0, attacker.Rating + delta);
        defender.Rating = Math.Max(0, defender.Rating + DefenderDelta(delta, _o.DefenderLossShare));
        if (won) { attacker.Wins++; defender.Losses++; } else { attacker.Losses++; defender.Wins++; }
        attacker.UpdatedAt = defender.UpdatedAt = now;
        attacker.PeakRating = Math.Max(attacker.PeakRating, attacker.Rating);
        defender.PeakRating = Math.Max(defender.PeakRating, defender.Rating);
        battle.AttackerRatingAfter = attacker.Rating;
        battle.DefenderRatingAfter = defender.Rating;

        var wallet = wallets.GetValueOrDefault(userId);
        if (won)
        {
            var (dayStart, _) = Today(now);
            var rewarded = await db.RelicBattles.CountAsync(b => b.AttackerId == userId && b.Essence > 0 && b.CreatedAt >= dayStart);
            if (rewarded < _o.RewardedWinsPerDay && wallet is not null)
            {
                battle.Essence = WinEssence * (ev?.EssenceMultiplier ?? 1);
                wallet.Essence += battle.Essence;
            }
        }
        var xp = (won ? SeasonPass.AttackWinXp : SeasonPass.AttackLossXp) * (ev?.XpMultiplier ?? 1);
        var passRewards = GrantPassXp(attacker, wallet, xp);
        if (!won) GrantPassXp(defender, wallets.GetValueOrDefault(opponentId), SeasonPass.DefenseWinXp * (ev?.XpMultiplier ?? 1));
        // Joueurs classés que l'attaquant vient de dépasser (prévenus pour qu'ils reviennent reprendre leur place).
        var overtaken = attacker.Rating > battle.AttackerRatingBefore
            ? await db.BattleProfiles.Where(p => p.Wins + p.Losses > 0 && p.UserId != userId && p.UserId != opponentId
                    && p.Rating >= battle.AttackerRatingBefore && p.Rating < attacker.Rating)
                .OrderByDescending(p => p.Rating).Take(5).Select(p => new { p.UserId, p.Rating }).ToListAsync()
            : [];
        db.RelicBattles.Add(battle);
        await db.SaveChangesAsync();

        var names = await db.Users.Where(u => u.Id == userId || u.Id == opponentId).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        var me = names.GetValueOrDefault(userId, "Un joueur");
        await NotifyDefenderAsync(opponentId, me, !won, battle.DefenderRatingAfter - battle.DefenderRatingBefore);
        foreach (var o in overtaken)
            await NotifyAsync(o.UserId, $"{me} vient de te passer devant", $"Il a {attacker.Rating} pts, toi {o.Rating}. Va lui reprendre ta place !", "overtake");
        return (await ToDtoAsync(battle, outcome)) with { PassXp = xp, PassRewards = passRewards };
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
        await EnsureSeasonAsync();
        var ranked = db.BattleProfiles.Where(p => p.Wins + p.Losses > 0);
        var top = await ranked.OrderByDescending(p => p.Rating).ThenByDescending(p => p.Wins).ThenBy(p => p.UpdatedAt).Take(100).ToListAsync();
        var ids = top.Select(p => p.UserId).Append(userId).ToList();
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        var titles = (await db.SeasonResults.Where(r => r.Rank == 1 && ids.Contains(r.UserId)).Select(r => new { r.UserId, r.SeasonId }).ToListAsync())
            .GroupBy(r => r.UserId).ToDictionary(g => g.Key, g => g.Select(r => Seasons.Number(r.SeasonId)).OrderBy(n => n).ToList());
        var shamed = await ShamedThisSeasonAsync(ids);
        var legends = (await db.BattleProfiles.Where(p => p.Legend && ids.Contains(p.UserId)).Select(p => p.UserId).ToListAsync()).ToHashSet();
        LadderEntryDto Entry(BattleProfile p, int rank) =>
            new(rank, p.UserId, users.GetValueOrDefault(p.UserId)?.DisplayName ?? "?", users.GetValueOrDefault(p.UserId)?.RiotAccount?.ProfileIconId,
                p.Rating, p.Wins, p.Losses, users.GetValueOrDefault(p.UserId)?.AvatarChampionId, p.SeasonTier, titles.GetValueOrDefault(p.UserId),
                shamed.Contains(p.UserId), legends.Contains(p.UserId));

        var entries = new List<LadderEntryDto>();
        for (var i = 0; i < top.Count; i++)
            entries.Add(Entry(top[i], i > 0 && top[i].Rating == top[i - 1].Rating ? entries[i - 1].Rank : i + 1));
        var mine = await ranked.FirstOrDefaultAsync(p => p.UserId == userId);
        var me = entries.FirstOrDefault(e => e.UserId == userId) ?? (mine is null ? null : Entry(mine, await RankAsync(mine)));
        return new LadderDto(entries, me);
    }

    /// <summary>Profil public d'arène d'un joueur, lisible par tout joueur connecté.</summary>
    public async Task<PlayerStatsDto> PlayerStatsAsync(Guid viewerId, Guid playerId)
    {
        await EnsureSeasonAsync();
        var isFriend = await db.RelicFriends.AnyAsync(f => f.UserId == viewerId && f.FriendId == playerId);
        var cards = await social.CardsAsync([playerId], isFriend ? [playerId] : []);
        if (!cards.TryGetValue(playerId, out var card)) throw new AppException("Joueur introuvable.", 404);

        var profile = await db.BattleProfiles.FirstOrDefaultAsync(p => p.UserId == playerId);
        var rating = profile?.Rating ?? _o.StartRating;
        var ranked = profile is { } rp && rp.Wins + rp.Losses > 0;
        var rankedCount = await db.BattleProfiles.CountAsync(p => p.Wins + p.Losses > 0);
        var seasons = await db.SeasonResults.Where(r => r.UserId == playerId).ToListAsync();
        var battles = await db.RelicBattles.Where(b => b.AttackerId == playerId || b.DefenderId == playerId)
            .OrderBy(b => b.CreatedAt).ToListAsync();

        int wins = 0, attackWins = 0, attackLosses = 0, defenseWins = 0, defenseLosses = 0, streak = 0, bestStreak = 0;
        int kills = 0, deaths = 0, aces = 0, firstBloods = 0, flawless = 0, bestGain = 0, essence = 0;
        int? fastest = null;
        var best = Math.Max(rating, seasons.Select(s => s.PeakRating).DefaultIfEmpty(0).Max());
        (Guid Id, int Gap)? upset = null;
        var beaten = new Dictionary<Guid, int>();
        var lostTo = new Dictionary<Guid, int>();
        var champs = new Dictionary<string, (Dictionary<(CapsuleItemKind, int), int> Items, int Games, int Wins, int Kills)>();
        foreach (var b in battles)
        {
            var attacked = b.AttackerId == playerId;
            var won = attacked == b.AttackerWon;
            var (before, after) = attacked ? (b.AttackerRatingBefore, b.AttackerRatingAfter) : (b.DefenderRatingBefore, b.DefenderRatingAfter);
            var other = attacked ? b.DefenderId : b.AttackerId;
            var otherBefore = attacked ? b.DefenderRatingBefore : b.AttackerRatingBefore;
            best = Math.Max(best, after);
            if (won)
            {
                wins++;
                streak = streak > 0 ? streak + 1 : 1;
                bestStreak = Math.Max(bestStreak, streak);
                beaten[other] = beaten.GetValueOrDefault(other) + 1;
                if (otherBefore > before && (upset is null || otherBefore - before > upset.Value.Gap)) upset = (other, otherBefore - before);
                bestGain = Math.Max(bestGain, after - before);
                if (attacked) { attackWins++; essence += b.Essence; } else defenseWins++;
            }
            else
            {
                streak = streak < 0 ? streak - 1 : -1;
                lostTo[other] = lostTo.GetValueOrDefault(other) + 1;
                if (attacked) attackLosses++; else defenseLosses++;
            }

            BattleOutcome? o;
            try { o = JsonSerializer.Deserialize<BattleOutcome>(b.Result, Json); }
            catch (JsonException) { o = null; }
            if (o?.A is null || o.B is null) continue;
            var side = attacked ? BattleSide.A : BattleSide.B;
            var team = attacked ? o.A : o.B;
            var teamDeaths = team.Units.Sum(u => u.Deaths);
            kills += team.Units.Sum(u => u.Kills);
            deaths += teamDeaths;
            aces += o.Events.Count(e => e.Kind == BattleEventKind.ACE && e.Side == side);
            if (o.Events.Any(e => e.Kind == BattleEventKind.FIRST_BLOOD && e.Side == side)) firstBloods++;
            if (won && teamDeaths == 0) flawless++;
            if (won && (fastest is null || o.Minutes < fastest)) fastest = o.Minutes;
            foreach (var u in team.Units)
            {
                var c = champs.GetValueOrDefault(u.Champion, ([], 0, 0, 0));
                c.Items[(u.Kind, u.ItemId)] = c.Items.GetValueOrDefault((u.Kind, u.ItemId)) + 1;
                champs[u.Champion] = (c.Items, c.Games + 1, c.Wins + (won ? 1 : 0), c.Kills + u.Kills);
            }
        }

        var rivals = beaten.Keys.Concat(lostTo.Keys).Append(upset?.Id ?? Guid.Empty).Distinct().ToList();
        var names = await db.Users.Where(u => rivals.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        RivalDto? Rival(Dictionary<Guid, int> counts) => counts.Count == 0 ? null
            : counts.OrderByDescending(kv => kv.Value).Select(kv => new RivalDto(kv.Key, names.GetValueOrDefault(kv.Key, "Joueur supprimé"), kv.Value)).First();
        ChampionStatDto? Champ(Func<(Dictionary<(CapsuleItemKind, int), int> Items, int Games, int Wins, int Kills), int> key) =>
            champs.Count == 0 ? null : champs.OrderByDescending(kv => key(kv.Value)).ThenByDescending(kv => kv.Value.Wins).Select(kv =>
            {
                var (kind, itemId) = kv.Value.Items.MaxBy(i => i.Value).Key;
                return new ChampionStatDto(kind, itemId, kv.Key, kv.Value.Games, kv.Value.Wins, kv.Value.Kills);
            }).First();

        var form = battles.AsEnumerable().Reverse().Take(10).Select(b => (b.AttackerId == playerId) == b.AttackerWon).ToList();
        var shameId = await ShameIdAsync();
        var shameLosses = shameId is { } sid && sid != playerId
            ? battles.Count(b => (b.AttackerId == sid && b.AttackerWon) || (b.DefenderId == sid && !b.AttackerWon))
            : 0;
        return new PlayerStatsDto(card, rating, Seasons.TierOf(rating), ranked ? await RankAsync(profile!) : null, rankedCount,
            profile?.Wins ?? 0, profile?.Losses ?? 0, profile?.PeakRating ?? rating, best,
            wins, battles.Count - wins, attackWins, attackLosses, defenseWins, defenseLosses,
            bestStreak, streak, form,
            kills, deaths, aces, firstBloods, flawless, fastest, bestGain, essence,
            upset is { } up ? new RivalDto(up.Id, names.GetValueOrDefault(up.Id, "Joueur supprimé"), 1, up.Gap) : null,
            Rival(beaten), Rival(lostTo), Champ(c => c.Games), Champ(c => c.Kills),
            seasons.Count == 0 ? null : seasons.Max(s => s.Tier), seasons.Count, seasons.Count(s => s.Rank <= 3), seasons.Count(s => s.Rank == 1),
            battles.Count == 0 ? null : battles[0].CreatedAt,
            seasons.Where(s => s.Rank == 1).Select(s => Seasons.Number(s.SeasonId)).OrderBy(n => n).ToList(),
            shameLosses, shameLosses > 0 ? names.GetValueOrDefault(shameId!.Value, _o.ShameAccount) : null,
            seasons.Where(s => s.PassLevel >= SeasonPass.MaxLevel).Select(s => Seasons.Number(s.SeasonId)).OrderBy(n => n).ToList(),
            profile?.PassLevel ?? 0);
    }

    private async Task<Guid?> ShameIdAsync() =>
        string.IsNullOrWhiteSpace(_o.ShameAccount) ? null
            // Insensible à la casse et aux espaces : « Amitest » ou « AmiTest » désignent le même compte de test.
            : await db.Users.Where(u => u.DisplayName.Trim().ToLower() == _o.ShameAccount.Trim().ToLower())
                .Select(u => (Guid?)u.Id).FirstOrDefaultAsync();

    /// <summary>Joueurs (parmi <paramref name="ids"/>) battus par le compte de test depuis le début de la saison.</summary>
    private async Task<HashSet<Guid>> ShamedThisSeasonAsync(List<Guid> ids)
    {
        if (await ShameIdAsync() is not { } sid) return [];
        var tz = Zone;
        var start = Seasons.StartOf(Local(clock.GetUtcNow()));
        var since = new DateTimeOffset(start, tz.GetUtcOffset(start)).ToUniversalTime();
        var losers = await db.RelicBattles
            .Where(b => b.CreatedAt >= since && ((b.AttackerId == sid && b.AttackerWon && ids.Contains(b.DefenderId))
                || (b.DefenderId == sid && !b.AttackerWon && ids.Contains(b.AttackerId))))
            .Select(b => b.AttackerId == sid ? b.DefenderId : b.AttackerId).Distinct().ToListAsync();
        return losers.ToHashSet();
    }

    private async Task<int> RankAsync(BattleProfile p) =>
        await db.BattleProfiles.CountAsync(o => o.Wins + o.Losses > 0 && o.Rating > p.Rating) + 1;

    private async Task<BattleDto> ToDtoAsync(RelicBattle b, BattleOutcome o)
    {
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => u.Id == b.AttackerId || u.Id == b.DefenderId).ToDictionaryAsync(u => u.Id);
        var frames = await db.BattleProfiles.Where(p => p.UserId == b.AttackerId || p.UserId == b.DefenderId)
            .ToDictionaryAsync(p => p.UserId, p => new { p.SeasonTier, p.Legend });
        BattlePlayerDto Player(Guid id, int before, int after) =>
            new(id, users.GetValueOrDefault(id)?.DisplayName ?? "Joueur supprimé", users.GetValueOrDefault(id)?.RiotAccount?.ProfileIconId, before, after,
                users.GetValueOrDefault(id)?.AvatarChampionId, frames.GetValueOrDefault(id)?.SeasonTier, frames.GetValueOrDefault(id)?.Legend ?? false);
        return new BattleDto(b.Id, b.CreatedAt,
            Player(b.AttackerId, b.AttackerRatingBefore, b.AttackerRatingAfter), Player(b.DefenderId, b.DefenderRatingBefore, b.DefenderRatingAfter),
            b.AttackerWon, b.Essence, o.Minutes, o.A, o.B, o.Events);
    }

    private async Task<(List<BattleUnit> Mine, List<BattleUnit> Theirs)> TeamsAsync(
        CapsuleCatalog catalog, Guid userId, Guid opponentId, IReadOnlyList<MetaChange> meta)
    {
        if (opponentId == userId) throw new AppException("Tu ne peux pas t'attaquer toi-même.");
        if (!await db.Users.AnyAsync(u => u.Id == opponentId)) throw new AppException("Joueur introuvable.", 404);
        var mine = Units(catalog, await social.GetRosterAsync(userId), meta)
            ?? throw new AppException("Complète ton roster (5 postes) pour combattre.", 409);
        var theirs = Units(catalog, await social.GetRosterAsync(opponentId), meta)
            ?? throw new AppException("Ce joueur n'a pas encore de roster complet.", 409);
        return (mine, theirs);
    }

    /// <summary>Roster → unités de combat, bonus de méta compris ; null si un poste est vide ou un objet absent du catalogue.</summary>
    private static List<BattleUnit>? Units(CapsuleCatalog catalog, List<RosterSlotDto?> roster, IReadOnlyList<MetaChange> meta)
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
            var talent = Talents.For(champ.Alias, classes, champ.Spells?.Select(sp => (sp.Name, sp.Icon)).ToList());
            units.Add(new BattleUnit(slot.Kind, slot.ItemId, champ.Name, champ.Id, rarity, classes, lines, talent, Profiles.For(champ.Alias, classes),
                Meta.Bonus(champ.Id, classes.Length > 0 ? classes[0] : null, meta)));
        }
        return units.Count == BattleRules.TeamSize ? units : null;
    }

    /// <summary>Variation de cote de l'attaquant : Elo de facteur K et de diviseur <paramref name="scale"/>.</summary>
    public static int RatingDelta(int attacker, int defender, bool won, int kFactor, double scale)
    {
        var expected = 1 / (1 + Math.Pow(10, (defender - attacker) / scale));
        return (int)Math.Round(kFactor * ((won ? 1 : 0) - expected));
    }

    /// <summary>Variation du défenseur : l'opposé de l'attaquant, réduit à <paramref name="lossShare"/> quand il perd.</summary>
    public static int DefenderDelta(int attackerDelta, double lossShare) =>
        attackerDelta > 0 ? -(int)Math.Round(attackerDelta * lossShare, MidpointRounding.AwayFromZero) : -attackerDelta;

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
        profile = new BattleProfile { UserId = userId, Rating = _o.StartRating, PeakRating = _o.StartRating, SeasonId = SeasonId(now), UpdatedAt = now };
        db.BattleProfiles.Add(profile);
        return profile;
    }

    private TimeZoneInfo Zone
    {
        get
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(_o.TimeZone); }
            catch (Exception) { return TimeZoneInfo.Utc; }
        }
    }

    /// <summary>Journée en cours (minuit à minuit, fuseau configuré, UTC si inconnu).</summary>
    private (DateTimeOffset Start, DateTimeOffset End) Today(DateTimeOffset now)
    {
        var tz = Zone;
        var midnight = TimeZoneInfo.ConvertTime(now, tz).Date;
        // En UTC : Npgsql refuse un DateTimeOffset avec décalage dans une requête (timestamp with time zone).
        DateTimeOffset At(DateTime d) => new DateTimeOffset(d, tz.GetUtcOffset(d)).ToUniversalTime();
        return (At(midnight), At(midnight.AddDays(1)));
    }

    private DateTime Local(DateTimeOffset now) => TimeZoneInfo.ConvertTime(now, Zone).DateTime;

    private string SeasonId(DateTimeOffset now) => Seasons.IdOf(Local(now));

    /// <summary>Fin de la saison en cours, à minuit (heure locale).</summary>
    private DateTimeOffset SeasonEnd(DateTimeOffset now)
    {
        var tz = Zone;
        var end = Seasons.EndOf(Local(now));
        return new DateTimeOffset(end, tz.GetUtcOffset(end)).ToUniversalTime();
    }

    private static readonly SemaphoreSlim SeasonGate = new(1, 1);

    /// <summary>
    /// Bascule de saison, au premier passage après la fin de saison : chaque profil d'une saison passée est archivé
    /// (rang, palier, reliques versées dans le portefeuille), son palier final devient le cadre de son icône pour la saison
    /// qui commence (aucun cadre s'il n'a pas joué la saison précédente), puis sa cote est remise à niveau.
    /// </summary>
    public async Task EnsureSeasonAsync()
    {
        var local = Local(clock.GetUtcNow());
        var current = Seasons.IdOf(local);
        var previous = Seasons.IdOf(Seasons.StartOf(local).AddDays(-1));
        if (!await db.BattleProfiles.AnyAsync(p => p.SeasonId != current)) return;
        await SeasonGate.WaitAsync();
        try
        {
            var stale = await db.BattleProfiles.Where(p => p.SeasonId != current).ToListAsync();
            var now = clock.GetUtcNow();
            foreach (var season in stale.GroupBy(p => p.SeasonId))
            {
                var done = (await db.SeasonResults.Where(r => r.SeasonId == season.Key).Select(r => r.UserId).ToListAsync()).ToHashSet();
                var ranked = season.Where(p => p.Wins + p.Losses > 0)
                    .OrderByDescending(p => p.Rating).ThenByDescending(p => p.Wins).ThenBy(p => p.UpdatedAt).ToList();
                var ids = ranked.Select(p => p.UserId).ToList();
                var wallets = await db.CapsuleWallets.Where(w => ids.Contains(w.UserId)).ToDictionaryAsync(w => w.UserId);
                for (var i = 0; i < ranked.Count; i++)
                {
                    var p = ranked[i];
                    if (done.Contains(p.UserId)) continue;
                    var tier = Seasons.TierOf(p.Rating);
                    var (standard, premium) = p.Wins + p.Losses >= Seasons.MinGamesForReward ? Seasons.Reward(tier) : (0, 0);
                    db.SeasonResults.Add(new SeasonResult
                    {
                        UserId = p.UserId, SeasonId = season.Key, Rating = p.Rating, PeakRating = Math.Max(p.PeakRating, p.Rating),
                        Wins = p.Wins, Losses = p.Losses, Rank = i + 1, Tier = tier, RewardStandard = standard, RewardPremium = premium, CreatedAt = now,
                        PassLevel = p.PassLevel,
                    });
                    if (wallets.TryGetValue(p.UserId, out var w)) { w.Stored += standard; w.PremiumStored += premium; }
                }
                foreach (var p in season)
                {
                    p.SeasonTier = season.Key == previous && p.Wins + p.Losses > 0 ? Seasons.TierOf(p.Rating) : null;
                    p.Legend = season.Key == previous && p.PassLevel >= SeasonPass.MaxLevel;
                    p.PassXp = p.PassLevel = 0;
                    p.Rating = Seasons.SoftReset(p.Rating, _o.StartRating);
                    p.PeakRating = p.Rating;
                    p.Wins = p.Losses = 0;
                    p.SeasonId = current;
                }
            }
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException e)
        {
            // Un portefeuille a bougé pendant la bascule : nouvelle tentative au prochain passage.
            logger.LogWarning(e, "Bascule de saison reportée");
            db.ChangeTracker.Clear();
        }
        finally { SeasonGate.Release(); }
    }

    private static readonly SemaphoreSlim MetaGate = new(1, 1);

    /// <summary>Patch de méta de la semaine (notes de patch).</summary>
    public async Task<MetaDto> GetMetaAsync() =>
        ToDto(await CurrentMetaAsync(await catalogs.GetAsync())) with { Event = EventDto(ArenaEvents.CurrentOrNext(Local(clock.GetUtcNow()))) };

    /// <summary>
    /// Patch de la semaine en cours, créé au premier passage de la semaine à partir des rosters complets du moment
    /// (<see cref="Meta.Generate"/>), puis figé.
    /// </summary>
    private async Task<(MetaPatch Patch, List<MetaChange> Changes)> CurrentMetaAsync(CapsuleCatalog catalog)
    {
        var tz = Zone;
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), tz).DateTime;
        var id = Meta.IdOf(local);
        var patch = await db.MetaPatches.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id);
        if (patch is null && !catalog.IsEmpty)
        {
            await MetaGate.WaitAsync();
            try
            {
                patch = await db.MetaPatches.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id) ?? await CreateMetaAsync(catalog, id, local, tz);
            }
            catch (DbUpdateException)
            {
                // Créé en parallèle par une autre instance.
                db.ChangeTracker.Clear();
                patch = await db.MetaPatches.AsNoTracking().FirstAsync(p => p.Id == id);
            }
            finally { MetaGate.Release(); }
        }
        // Méta folle du week-end : ses changements s'ajoutent au patch (sans être enregistrés avec lui).
        var extra = ArenaEvents.Current(local)?.Changes ?? [];
        return patch is null ? (new MetaPatch { Id = id }, [.. extra])
            : (patch, [.. JsonSerializer.Deserialize<List<MetaChange>>(patch.Changes, Json) ?? [], .. extra]);
    }

    private async Task<MetaPatch> CreateMetaAsync(CapsuleCatalog catalog, string id, DateTime local, TimeZoneInfo tz)
    {
        var rosters = await db.CapsuleWallets.Where(w => w.Roster != null).Select(w => w.Roster).ToListAsync();
        var usage = rosters.Select(r => Units(catalog, RelicSocialService.ParseRoster(r), []))
            .OfType<List<BattleUnit>>()
            .SelectMany(team => team.Select(u => u.ChampionId).Distinct())
            .GroupBy(c => c).ToDictionary(g => g.Key, g => g.Count());
        var candidates = catalog.Champions
            .Select(c => new MetaCandidate(c.Id, c.Name, (c.Roles ?? []).Select(BattleRules.ParseClass).OfType<ChampionClass>().Cast<ChampionClass?>().FirstOrDefault(),
                usage.GetValueOrDefault(c.Id)))
            .OrderBy(c => c.ChampionId).ToList();
        var start = Meta.WeekStart(local);
        DateTimeOffset At(DateTime d) => new DateTimeOffset(d, tz.GetUtcOffset(d)).ToUniversalTime();
        var patch = new MetaPatch
        {
            Id = id, Number = await db.MetaPatches.CountAsync() + 1, StartsAt = At(start), EndsAt = At(start.AddDays(7)),
            Changes = JsonSerializer.Serialize(Meta.Generate(candidates, StableSeed(id)), Json), CreatedAt = clock.GetUtcNow(),
        };
        db.MetaPatches.Add(patch);
        await db.SaveChangesAsync();
        db.Entry(patch).State = EntityState.Detached;
        return patch;
    }

    private static int StableSeed(string s) => Meta.StableSeed(s);

    private static MetaDto ToDto((MetaPatch Patch, List<MetaChange> Changes) m) =>
        new(m.Patch.Id, m.Patch.Number, m.Patch.StartsAt, m.Patch.EndsAt, m.Changes);

    /// <summary>Marque le bilan de fin de saison comme vu.</summary>
    public async Task MarkSeasonSeenAsync(Guid userId, string seasonId)
    {
        var result = await db.SeasonResults.FirstOrDefaultAsync(r => r.UserId == userId && r.SeasonId == seasonId);
        if (result is null) return;
        result.Seen = true;
        await db.SaveChangesAsync();
    }

    private static SeasonResultDto ToDto(SeasonResult r) =>
        new(r.SeasonId, Seasons.Number(r.SeasonId), r.Rating, r.PeakRating, r.Wins, r.Losses, r.Rank, r.Tier, r.RewardStandard, r.RewardPremium, r.PassLevel);

    private const string ShareAlphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Lien de rejeu public : code créé au premier partage, réservé aux participants.</summary>
    public async Task<ShareDto> ShareAsync(Guid userId, Guid battleId)
    {
        var battle = await db.RelicBattles.FirstOrDefaultAsync(b => b.Id == battleId && (b.AttackerId == userId || b.DefenderId == userId))
            ?? throw new AppException("Combat introuvable.", 404);
        if (battle.ShareCode is null)
        {
            battle.ShareCode = System.Security.Cryptography.RandomNumberGenerator.GetString(ShareAlphabet, 10);
            await db.SaveChangesAsync();
        }
        return new ShareDto(battle.ShareCode);
    }

    /// <summary>Rejeu public d'un combat partagé.</summary>
    public async Task<BattleDto> GetSharedAsync(string code)
    {
        var battle = code.Length is > 0 and <= 16 ? await db.RelicBattles.FirstOrDefaultAsync(b => b.ShareCode == code) : null;
        if (battle is null) throw new AppException("Ce replay n'existe pas ou plus.", 404);
        return await ToDtoAsync(battle, JsonSerializer.Deserialize<BattleOutcome>(battle.Result, Json)!);
    }

    // ---------- Boss de la semaine ----------

    private string WeekId(DateTimeOffset now) => Meta.IdOf(Local(now));

    private DateTimeOffset WeekEnd(DateTimeOffset now)
    {
        var tz = Zone;
        var end = Meta.WeekStart(Local(now)).AddDays(7);
        return new DateTimeOffset(end, tz.GetUtcOffset(end)).ToUniversalTime();
    }

    /// <summary>
    /// Équipe du boss : un champion par poste (poste principal, tiré au sort avec le seed de la semaine), rareté maximale,
    /// bonus de puissance <see cref="Boss.PowerBonus"/> en plus de la méta.
    /// </summary>
    private static List<BattleUnit>? BossUnits(CapsuleCatalog catalog, string weekId, IReadOnlyList<MetaChange> meta)
    {
        var rng = new Random(StableSeed(weekId + ":boss-team"));
        var pool = catalog.Champions.OrderBy(c => c.Id).Select(c =>
        {
            var classes = (c.Roles ?? []).Select(BattleRules.ParseClass).OfType<ChampionClass>().ToArray();
            return (Champ: c, Classes: classes, Profile: Profiles.For(c.Alias, classes));
        }).OrderBy(_ => rng.Next()).ToList();
        var units = new List<BattleUnit>();
        for (var role = 0; role < BattleRules.TeamSize; role++)
        {
            var pick = pool.FirstOrDefault(c => c.Profile?.Main == role && units.All(u => u.ChampionId != c.Champ.Id));
            if (pick.Champ is null) pick = pool.FirstOrDefault(c => units.All(u => u.ChampionId != c.Champ.Id));
            if (pick.Champ is null) return null;
            var talent = Talents.For(pick.Champ.Alias, pick.Classes, pick.Champ.Spells?.Select(sp => (sp.Name, sp.Icon)).ToList());
            var bonus = (1 + Meta.Bonus(pick.Champ.Id, pick.Classes.Length > 0 ? pick.Classes[0] : null, meta)) * (1 + Boss.PowerBonus) - 1;
            units.Add(new BattleUnit(CapsuleItemKind.CHAMPION, pick.Champ.Id, pick.Champ.Name, pick.Champ.Id, Rarity.EXALTED, pick.Classes, [], talent,
                pick.Profile, bonus));
        }
        return units;
    }

    public async Task<BossDto> GetBossAsync(Guid userId)
    {
        await EnsureBossPayoutAsync();
        var catalog = await catalogs.GetAsync();
        var now = clock.GetUtcNow();
        var weekId = WeekId(now);
        var meta = (await CurrentMetaAsync(catalog)).Changes;
        var boss = BossUnits(catalog, weekId, meta) ?? throw new AppException("Le boss se prépare, reviens dans un instant.", 503);
        var mine = Units(catalog, await social.GetRosterAsync(userId), meta);
        var names = LineNames(catalog);
        var (mineReport, bossReport) = mine is null ? (null, BattleRules.Analyze(boss, names)) : BattleRules.Analyze(mine, boss, names);

        var scores = await db.BossScores.Where(b => b.WeekId == weekId).OrderByDescending(b => b.Best).ThenBy(b => b.UpdatedAt).ToListAsync();
        var ids = scores.Take(20).Select(b => b.UserId).ToList();
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        var top = scores.Take(20).Select((b, i) => new BossEntryDto(i + 1, b.UserId, users.GetValueOrDefault(b.UserId)?.DisplayName ?? "?",
            users.GetValueOrDefault(b.UserId)?.RiotAccount?.ProfileIconId, users.GetValueOrDefault(b.UserId)?.AvatarChampionId, b.Best, b.Attempts)).ToList();
        var mineScore = scores.FirstOrDefault(b => b.UserId == userId);
        var today = Local(now).ToString("yyyy-MM-dd");
        var used = mineScore is { } m && m.Day == today ? m.DayAttempts : 0;
        return new BossDto(weekId, Boss.NameOf(weekId), WeekEnd(now), bossReport, mineReport, Math.Max(0, Boss.AttemptsPerDay - used), Boss.AttemptsPerDay,
            Today(now).End, mineScore?.Best, mineScore is null ? null : scores.IndexOf(mineScore) + 1, top, Boss.KillPoints, Boss.TowerPoints, Boss.WinPoints);
    }

    /// <summary>Tentative contre le boss : ne compte pas pour la cote ; le meilleur score de la semaine est gardé, XP de pass à la clé.</summary>
    public async Task<BattleDto> AttackBossAsync(Guid userId)
    {
        await EnsureBossPayoutAsync();
        var catalog = await catalogs.GetAsync();
        using var l = await locks.AcquireAsync(userId);
        var now = clock.GetUtcNow();
        var weekId = WeekId(now);
        var meta = (await CurrentMetaAsync(catalog)).Changes;
        var boss = BossUnits(catalog, weekId, meta) ?? throw new AppException("Le boss se prépare, reviens dans un instant.", 503);
        var mine = Units(catalog, await social.GetRosterAsync(userId), meta)
            ?? throw new AppException("Complète ton roster (5 postes) pour affronter le boss.", 409);

        var today = Local(now).ToString("yyyy-MM-dd");
        var score = await db.BossScores.FirstOrDefaultAsync(b => b.WeekId == weekId && b.UserId == userId);
        if (score is null) db.BossScores.Add(score = new BossScore { WeekId = weekId, UserId = userId, Day = today });
        if (score.Day != today) (score.Day, score.DayAttempts) = (today, 0);
        if (score.DayAttempts >= Boss.AttemptsPerDay)
            throw new AppException($"Plus de tentative aujourd'hui ({Boss.AttemptsPerDay} par jour) : reviens demain.", 409);

        var seed = CryptoRandom.Instance.Next();
        var outcome = BattleRules.Simulate(mine, boss, seed, LineNames(catalog));
        var points = Boss.Score(outcome);
        score.DayAttempts++;
        score.Attempts++;
        if (points > score.Best) (score.Best, score.UpdatedAt) = (points, now);
        else if (score.UpdatedAt == default) score.UpdatedAt = now;

        var profile = await GetOrCreateProfileAsync(userId, now);
        var ev = ArenaEvents.Current(Local(now));
        var xp = SeasonPass.BossXp * (ev?.XpMultiplier ?? 1);
        var rewards = GrantPassXp(profile, await db.CapsuleWallets.FirstOrDefaultAsync(w => w.UserId == userId), xp);
        await db.SaveChangesAsync();

        var user = await db.Users.Include(u => u.RiotAccount).FirstAsync(u => u.Id == userId);
        var me = new BattlePlayerDto(userId, user.DisplayName, user.RiotAccount?.ProfileIconId, profile.Rating, profile.Rating, user.AvatarChampionId,
            profile.SeasonTier, profile.Legend);
        var them = new BattlePlayerDto(Guid.Empty, Boss.NameOf(weekId), null, 0, 0, boss[BattleRules.Mid].ChampionId);
        return new BattleDto(Guid.NewGuid(), now, me, them, outcome.Winner == BattleSide.A, 0, outcome.Minutes, outcome.A, outcome.B, outcome.Events,
            xp, rewards, true, points, score.Best);
    }

    public async Task MarkBossSeenAsync(Guid userId, string weekId)
    {
        var row = await db.BossScores.FirstOrDefaultAsync(b => b.UserId == userId && b.WeekId == weekId);
        if (row is null) return;
        row.Seen = true;
        await db.SaveChangesAsync();
    }

    private static readonly SemaphoreSlim BossGate = new(1, 1);

    /// <summary>Fin de semaine du boss : classement des scores des semaines passées, reliques versées une seule fois.</summary>
    public async Task EnsureBossPayoutAsync()
    {
        var current = WeekId(clock.GetUtcNow());
        if (!await db.BossScores.AnyAsync(b => !b.Paid && b.WeekId != current)) return;
        await BossGate.WaitAsync();
        try
        {
            var due = await db.BossScores.Where(b => !b.Paid && b.WeekId != current).ToListAsync();
            foreach (var week in due.GroupBy(b => b.WeekId))
            {
                var all = await db.BossScores.Where(b => b.WeekId == week.Key).OrderByDescending(b => b.Best).ThenBy(b => b.UpdatedAt).ToListAsync();
                var ids = all.Select(b => b.UserId).ToList();
                var wallets = await db.CapsuleWallets.Where(w => ids.Contains(w.UserId)).ToDictionaryAsync(w => w.UserId);
                for (var i = 0; i < all.Count; i++)
                {
                    var row = all[i];
                    if (row.Paid) continue;
                    var (standard, premium) = Boss.Reward(i + 1);
                    (row.Rank, row.RewardStandard, row.RewardPremium, row.Paid) = (i + 1, standard, premium, true);
                    if (wallets.TryGetValue(row.UserId, out var w)) { w.Stored += standard; w.PremiumStored += premium; }
                }
            }
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException e)
        {
            logger.LogWarning(e, "Récompenses du boss reportées");
            db.ChangeTracker.Clear();
        }
        finally { BossGate.Release(); }
    }

    // ---------- Notifications planifiées (appelées par CapsuleNotifier) ----------

    /// <summary>Marque une notification comme envoyée ; false si elle l'était déjà.</summary>
    private async Task<bool> ClaimPushAsync(string key, DateTimeOffset now)
    {
        if (await db.PushLogs.AnyAsync(p => p.Key == key)) return false;
        db.PushLogs.Add(new PushLog { Key = key, CreatedAt = now });
        try { await db.SaveChangesAsync(); return true; }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); return false; }
    }

    /// <summary>
    /// Début d'événement et nouveau boss (une fois, à partir de 10 h), revanches qui expirent dans moins de 2 h.
    /// </summary>
    public async Task NotifyTickAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var local = Local(now);
        var subscribed = await db.PushSubscriptions.Select(s => s.UserId).Distinct().ToListAsync(ct);

        if (local.Hour >= 10 && ArenaEvents.Current(local) is { } ev && await ClaimPushAsync($"event:{ev.Id}", now))
            foreach (var id in subscribed) await NotifyAsync(id, $"{ev.Title} !", ev.Text, "event");

        var week = Meta.IdOf(local);
        if (local.Hour >= 10 && await ClaimPushAsync($"boss:{week}", now))
            foreach (var id in subscribed)
                await NotifyAsync(id, $"Nouveau boss : {Boss.NameOf(week)}", $"{Boss.AttemptsPerDay} tentatives par jour, les meilleurs dégâts de la semaine gagnent des reliques prestige.", "boss",
                    "/reliques/?view=arena&tab=boss");

        // Revanches : défenseur battu, sans riposte, fenêtre qui se ferme dans moins de 2 h.
        var (from, to) = (now - Rematch, now - Rematch + TimeSpan.FromHours(2));
        var pending = await db.RelicBattles.Where(b => b.AttackerWon && b.CreatedAt > from && b.CreatedAt <= to && subscribed.Contains(b.DefenderId)
                && !db.RelicBattles.Any(r => r.AttackerId == b.DefenderId && r.DefenderId == b.AttackerId && r.CreatedAt > b.CreatedAt))
            .Select(b => new { b.Id, b.AttackerId, b.DefenderId }).ToListAsync(ct);
        var names = await db.Users.Where(u => pending.Select(p => p.AttackerId).Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        foreach (var b in pending)
            if (await ClaimPushAsync($"revenge:{b.Id}", now))
                await NotifyAsync(b.DefenderId, $"Ta revanche contre {names.GetValueOrDefault(b.AttackerId, "ton agresseur")} expire bientôt",
                    "Moins de 2 h pour lui rendre la monnaie de sa pièce.", "revenge");
    }

    private static string Wait(TimeSpan left) =>
        left.TotalHours >= 1 ? $"reviens dans {Math.Ceiling(left.TotalHours)} h" : $"reviens dans {Math.Max(1, Math.Ceiling(left.TotalMinutes))} min";

    private async Task NotifyAsync(Guid userId, string title, string body, string tag, string url = "/reliques/?view=arena")
    {
        try { await push.SendAsync(db, userId, new { title, body, tag, url }); }
        catch (Exception e) { logger.LogWarning(e, "Notification {Tag} non envoyée", tag); }
    }

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
