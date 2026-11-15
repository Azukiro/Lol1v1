using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Api.Data;
using Api.Domain.Battle;
using Api.Domain.Capsules;
using Api.Dtos;
using Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests;

/// <summary>Pass de saison, événements du week-end et boss de la semaine.</summary>
public class ArenaFeaturesTests
{
    [Fact]
    public void Weekend_events_rotate_and_run_from_saturday_to_monday()
    {
        // Semaine 47 (16-22 novembre 2026) : 47 % 3 = 2, méta folle.
        Assert.Null(ArenaEvents.Current(new DateTime(2026, 11, 20, 23, 59, 0)));
        var ev = ArenaEvents.Current(new DateTime(2026, 11, 21, 0, 0, 0))!;
        Assert.Equal(("2026-W47", ArenaEventKind.CHAOS_META), (ev.Id, ev.Kind));
        Assert.Equal(new DateTime(2026, 11, 23), ev.EndsLocal);
        Assert.Equal(2, ev.Changes.Count);
        Assert.Contains(ev.Changes, c => c.Percent == ArenaEvents.ChaosBuff);
        Assert.Null(ArenaEvents.Current(new DateTime(2026, 11, 23, 0, 0, 0)));

        Assert.Equal(ArenaEventKind.DOUBLE_ESSENCE, ArenaEvents.ForWeek(new DateTime(2026, 11, 25)).Kind);
        Assert.Equal(ArenaEventKind.DOUBLE_XP, ArenaEvents.ForWeek(new DateTime(2026, 12, 2)).Kind);
        Assert.Equal(2, ArenaEvents.ForWeek(new DateTime(2026, 11, 28)).EssenceMultiplier);
        Assert.Equal(new DateTime(2026, 11, 28), ArenaEvents.CurrentOrNext(new DateTime(2026, 11, 24)).StartsLocal);
    }

    [Fact]
    public void Several_changes_on_the_same_class_stack()
    {
        List<MetaChange> changes =
        [
            new(MetaTarget.CLASS, null, ChampionClass.MAGE, "Mages", 4, ""), new(MetaTarget.CLASS, null, ChampionClass.MAGE, "Mages", 15, ""),
        ];
        Assert.Equal(1.04 * 1.15 - 1, Meta.Bonus(1, ChampionClass.MAGE, changes), 6);
    }

    [Fact]
    public void Pass_levels_pay_once_and_the_last_one_makes_a_legend()
    {
        var p = new BattleProfile();
        var w = new CapsuleWallet();
        var first = BattleService.GrantPassXp(p, w, SeasonPass.XpPerLevel * 2 + 10);
        Assert.Equal([1, 2], first.Select(r => r.Level));
        Assert.Equal((50, 1, 2), (w.Essence, w.Stored, p.PassLevel));
        Assert.Empty(BattleService.GrantPassXp(p, w, 5));

        var rest = BattleService.GrantPassXp(p, w, SeasonPass.XpPerLevel * 100);
        Assert.Equal(SeasonPass.MaxLevel, p.PassLevel);
        Assert.Equal(SeasonPass.MaxLevel - 2, rest.Count);
        Assert.True(p.Legend);
        Assert.Equal(SeasonPass.Rewards.Sum(r => r.Premium), w.PremiumStored);

        // Sans portefeuille : l'XP compte, les récompenses attendent.
        var q = new BattleProfile();
        Assert.Empty(BattleService.GrantPassXp(q, null, 500));
        Assert.Equal((500, 0), (q.PassXp, q.PassLevel));
    }

    [Fact]
    public void Boss_score_counts_kills_towers_and_the_win()
    {
        BattleEvent End(int kills, int towers) => new(30, BattleEventKind.END, BattleSide.A, "", kills, 0, towers, 0, 0, 0);
        var empty = new TeamReport([], [], 0);
        Assert.Equal(5 * Boss.KillPoints + 2 * Boss.TowerPoints, Boss.Score(new BattleOutcome(BattleSide.B, 30, empty, empty, [End(5, 2)])));
        Assert.Equal(Boss.WinPoints + 3 * Boss.KillPoints, Boss.Score(new BattleOutcome(BattleSide.A, 30, empty, empty, [End(3, 0)])));
        Assert.Equal((0, 3), Boss.Reward(1));
        Assert.Equal((1, 0), Boss.Reward(7));
    }

    private static async Task<(HttpClient Http, Guid Id)> Player(ApiFactory factory, string name)
    {
        var http = factory.CreateClient();
        var auth = await (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = $"{name}@test.fr", password = "password123", displayName = name }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = await db.Users.Where(u => u.DisplayName == name).Select(u => u.Id).SingleAsync();
        db.CapsuleWallets.Add(new CapsuleWallet { UserId = id, AccrualAnchor = factory.Clock.GetUtcNow() });
        foreach (var c in new[] { 1, 2, 3, 4, 5 })
            db.CollectionItems.Add(new CollectionItem { UserId = id, Kind = CapsuleItemKind.CHAMPION, ItemId = c, Count = 1, FirstObtainedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        (await http.PutAsJsonAsync("/api/v1/capsules/roster",
            new { slots = new[] { 1, 2, 3, 4, 5 }.Select(c => new { kind = "CHAMPION", itemId = c }) })).EnsureSuccessStatusCode();
        return (http, id);
    }

    private static void SeedCatalog(ApiFactory factory)
    {
        CatalogSpell[] Kit(string r) => [new("P", null), new("Q", null), new("W", null), new("E", null), new(r, $"https://cdn/{r}.png")];
        factory.Services.GetRequiredService<CapsuleCatalogService>().Set(new CapsuleCatalog
        {
            Champions =
            [
                new(1, "Darius", "Darius", ["fighter", "tank"], Kit("Guillotine noxienne")), new(2, "Lee Sin", "LeeSin", ["fighter", "assassin"], Kit("Rage du dragon")),
                new(3, "Twisted Fate", "TwistedFate", ["mage"], Kit("Destinée")), new(4, "Jinx", "Jinx", ["marksman"], Kit("Super roquette")),
                new(5, "Thresh", "Thresh", ["support", "tank"], Kit("La cage")),
            ],
            Skins = [],
            Lines = [],
            LoadedAt = DateTimeOffset.UtcNow,
        });
    }

    [Fact]
    public async Task Fights_fill_the_pass_and_season_end_resets_it()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, _) = await Player(factory, "passA");
        var (b, bId) = await Player(factory, "passB");
        var fight = (await (await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = bId })).EnsureSuccessStatusCode()
            .Content.ReadFromJsonAsync<BattleDto>(ApiJson.Options))!;
        Assert.Equal(fight.AttackerWon ? SeasonPass.AttackWinXp : SeasonPass.AttackLossXp, fight.PassXp);
        var arena = (await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.Equal(fight.PassXp, arena.Pass!.Xp);
        Assert.Equal(SeasonPass.MaxLevel, arena.Pass.MaxLevel);
        var defender = (await b.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.Equal(fight.AttackerWon ? 0 : SeasonPass.DefenseWinXp, defender.Pass!.Xp);
        Assert.NotNull(arena.Event);

        factory.Clock.Advance(new DateTimeOffset(2026, 11, 2, 12, 0, 0, TimeSpan.Zero) - factory.Clock.GetUtcNow());
        arena = (await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.Equal(0, arena.Pass!.Xp);
        Assert.False(arena.Legend);
    }

    [Fact]
    public async Task Boss_allows_three_attempts_a_day_and_pays_the_week_ranking()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, aId) = await Player(factory, "bossA");
        var (b, bId) = await Player(factory, "bossB");

        var boss = (await a.GetFromJsonAsync<BossDto>("/api/v1/capsules/boss", ApiJson.Options))!;
        Assert.Equal(Boss.AttemptsPerDay, boss.AttemptsLeft);
        Assert.Equal(5, boss.Team.Units.Count);
        Assert.All(boss.Team.Units, u => Assert.Equal(Rarity.EXALTED, u.Rarity));
        Assert.NotNull(boss.Mine);

        var best = 0;
        for (var i = 0; i < Boss.AttemptsPerDay; i++)
        {
            var fight = (await (await a.PostAsync("/api/v1/capsules/boss/attack", null)).EnsureSuccessStatusCode()
                .Content.ReadFromJsonAsync<BattleDto>(ApiJson.Options))!;
            Assert.True(fight.Boss);
            Assert.Equal(SeasonPass.BossXp, fight.PassXp);
            best = Math.Max(best, fight.BossScore!.Value);
            Assert.Equal(best, fight.BossBest);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsync("/api/v1/capsules/boss/attack", null)).StatusCode);
        (await b.PostAsync("/api/v1/capsules/boss/attack", null)).EnsureSuccessStatusCode();
        boss = (await a.GetFromJsonAsync<BossDto>("/api/v1/capsules/boss", ApiJson.Options))!;
        Assert.Equal((0, best), (boss.AttemptsLeft, boss.MyBest));
        Assert.Equal(2, boss.Top.Count);

        // Lendemain : nouvelles tentatives.
        factory.Clock.Advance(TimeSpan.FromDays(1));
        Assert.Equal(Boss.AttemptsPerDay, (await a.GetFromJsonAsync<BossDto>("/api/v1/capsules/boss", ApiJson.Options))!.AttemptsLeft);

        // Semaine suivante : classement figé et reliques versées.
        int premiumBefore;
        using (var scope = factory.Services.CreateScope())
            premiumBefore = await scope.ServiceProvider.GetRequiredService<AppDbContext>().CapsuleWallets
                .Where(w => w.UserId == boss.Top[0].UserId).Select(w => w.PremiumStored).SingleAsync();
        factory.Clock.Advance(TimeSpan.FromDays(7));
        var arena = (await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.NotNull(arena.LastBoss);
        Assert.Equal(2, arena.LastBoss!.Players);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.BossScores.Where(s => s.WeekId == boss.WeekId).ToListAsync();
            Assert.All(rows, r => Assert.True(r.Paid));
            var winner = await db.CapsuleWallets.SingleAsync(w => w.UserId == boss.Top[0].UserId);
            Assert.Equal(premiumBefore + Boss.Reward(1).Premium, winner.PremiumStored);
        }
        (await a.PostAsync($"/api/v1/capsules/boss/{boss.WeekId}/seen", null)).EnsureSuccessStatusCode();
        Assert.Null((await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!.LastBoss);
        _ = (aId, bId);
    }
}
