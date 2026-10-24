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
using Xunit.Abstractions;

namespace Api.Tests;

public class BattleRulesTests(ITestOutputHelper output)
{
    private static readonly Dictionary<int, string> NoLines = [];
    private static int _nextId = 1;

    private static BattleUnit U(string name, Rarity rarity, params ChampionClass[] classes) =>
        new(CapsuleItemKind.CHAMPION, _nextId, name, _nextId++, rarity, classes, [], Profile: Profiles.For(name.Replace(" ", ""), classes));

    private static List<BattleUnit> Team(Rarity rarity = Rarity.EPIC) =>
    [
        U("Darius", rarity, ChampionClass.FIGHTER, ChampionClass.TANK),
        U("Lee Sin", rarity, ChampionClass.FIGHTER, ChampionClass.ASSASSIN),
        U("Ahri", rarity, ChampionClass.MAGE, ChampionClass.ASSASSIN),
        U("Jinx", rarity, ChampionClass.MARKSMAN),
        U("Thresh", rarity, ChampionClass.SUPPORT, ChampionClass.TANK),
    ];

    private static double WinRate(List<BattleUnit> a, List<BattleUnit> b, int games = 4000) =>
        Enumerable.Range(0, games).Count(seed => BattleRules.Simulate(a, b, seed, NoLines).Winner == BattleSide.A) / (double)games;

    [Fact]
    public void Same_seed_replays_the_same_game()
    {
        var (a, b) = (Team(), Team(Rarity.RARE));
        var first = BattleRules.Simulate(a, b, 1234, NoLines);
        var again = BattleRules.Simulate(a, b, 1234, NoLines);
        Assert.Equal(first.Winner, again.Winner);
        Assert.Equal(first.Events.Select(e => e.Text), again.Events.Select(e => e.Text));
        Assert.Equal(BattleEventKind.END, first.Events[^1].Kind);
        Assert.Equal(first.Winner, first.Events[^1].Side);
        // Les éliminations des bilans correspondent au score final.
        Assert.Equal(first.Events[^1].KillsA, first.A.Units.Sum(u => u.Kills));
        Assert.Equal(first.Events[^1].KillsB, first.A.Units.Sum(u => u.Deaths));
    }

    [Fact]
    public void Mirror_match_is_a_coin_flip()
    {
        var rate = WinRate(Team(), Team());
        output.WriteLine($"miroir : {rate:P1}");
        Assert.InRange(rate, 0.45, 0.55);
    }

    [Fact]
    public void Champions_on_their_role_beat_the_same_champions_off_role()
    {
        var good = Team();
        var bad = new List<BattleUnit> { good[3], good[2], good[4], good[0], good[1] };
        var rate = WinRate(good, bad);
        output.WriteLine($"bons postes : {rate:P1}");
        Assert.InRange(rate, 0.80, 0.98);
    }

    [Fact]
    public void Rarity_helps_but_does_not_decide_everything()
    {
        var rate = WinRate(Team(Rarity.LEGENDARY), Team(Rarity.COMMON));
        output.WriteLine($"légendaire contre commun : {rate:P1}");
        Assert.InRange(rate, 0.60, 0.85);
    }

    [Fact]
    public void Every_champion_has_a_hand_written_profile()
    {
        Assert.Empty(Talents.Aliases.Where(a => !Profiles.IsMapped(a)));
        Assert.Equal(new ChampionProfile(BattleRules.Top, BattleRules.Support, PowerCurve.LATE, PlayStyle.TEAMFIGHT), Profiles.For("Malphite", []));
        // Inconnu : déduit des classes.
        Assert.Equal(BattleRules.Bot, Profiles.For("Nouveau", [ChampionClass.MARKSMAN])!.Main);
        Assert.Null(Profiles.For("Nouveau", []));
    }

    [Fact]
    public void Role_comes_from_the_champion_not_its_class()
    {
        var leona = U("Leona", Rarity.EPIC, ChampionClass.TANK, ChampionClass.SUPPORT);
        var malphite = U("Malphite", Rarity.EPIC, ChampionClass.TANK, ChampionClass.FIGHTER);
        var sion = U("Sion", Rarity.EPIC, ChampionClass.TANK, ChampionClass.FIGHTER);
        Assert.Equal(0.12, BattleRules.RoleFitBonus(leona, BattleRules.Support));
        Assert.Equal(0.08, BattleRules.RoleFitBonus(malphite, BattleRules.Support));
        Assert.Equal(-0.10, BattleRules.RoleFitBonus(sion, BattleRules.Support));
        Assert.Equal(0.12, BattleRules.RoleFitBonus(sion, BattleRules.Top));
    }

    [Fact]
    public void A_tank_without_support_role_loses_to_a_real_support()
    {
        var real = Team();
        var tank = Team();
        tank[4] = U("Sion", Rarity.EPIC, ChampionClass.TANK, ChampionClass.FIGHTER);
        var rate = WinRate(tank, real);
        output.WriteLine($"Sion support contre Thresh : {rate:P1}");
        Assert.InRange(rate, 0.25, 0.47);

        // Avec le support en poste secondaire, c'est un vrai choix, pas un abus.
        var flex = Team();
        flex[4] = U("Malphite", Rarity.EPIC, ChampionClass.TANK, ChampionClass.FIGHTER);
        rate = WinRate(flex, real);
        output.WriteLine($"Malphite support contre Thresh : {rate:P1}");
        Assert.InRange(rate, 0.38, 0.56);
    }

    private static List<BattleUnit> Reshape(List<BattleUnit> team, Func<ChampionProfile, ChampionProfile> f) =>
        team.Select(u => u with { Profile = f(u.Profile!) }).ToList();

    [Fact]
    public void Each_power_curve_can_win()
    {
        var mid = Reshape(Team(), p => p with { Curve = PowerCurve.MID });
        var early = Reshape(Team(), p => p with { Curve = PowerCurve.EARLY });
        var late = Reshape(Team(), p => p with { Curve = PowerCurve.LATE });
        var rates = new[] { ("early/mid", WinRate(early, mid)), ("late/mid", WinRate(late, mid)), ("early/late", WinRate(early, late)) };
        foreach (var (label, rate) in rates)
        {
            output.WriteLine($"{label} : {rate:P1}");
            Assert.InRange(rate, 0.40, 0.60);
        }
    }

    [Fact]
    public void Solo_and_teamfight_styles_are_both_viable()
    {
        var solo = Reshape(Team(), p => p with { Style = PlayStyle.SOLO });
        var fight = Reshape(Team(), p => p with { Style = PlayStyle.TEAMFIGHT });
        var rate = WinRate(solo, fight);
        output.WriteLine($"solo contre teamfight : {rate:P1}");
        Assert.InRange(rate, 0.40, 0.60);
    }

    [Fact]
    public void Class_counters_read_the_whole_enemy_composition()
    {
        var foes = Team();
        Assert.Equal(8, BattleRules.ClassCounter(U("Jinx", Rarity.EPIC, ChampionClass.MARKSMAN), foes));
        Assert.Equal(0, BattleRules.ClassCounter(U("Ahri", Rarity.EPIC, ChampionClass.MAGE), foes));
        var squishy = new List<BattleUnit>
        {
            U("Ahri", Rarity.EPIC, ChampionClass.MAGE), U("Lux", Rarity.EPIC, ChampionClass.MAGE), U("Jinx", Rarity.EPIC, ChampionClass.MARKSMAN),
            U("Caitlyn", Rarity.EPIC, ChampionClass.MARKSMAN), U("Xerath", Rarity.EPIC, ChampionClass.MAGE),
        };
        Assert.Equal(12, BattleRules.ClassCounter(U("Zed", Rarity.EPIC, ChampionClass.ASSASSIN), squishy));
        Assert.Equal(8, BattleRules.ClassCounter(U("Zed", Rarity.EPIC, ChampionClass.ASSASSIN), foes));
    }

    [Fact]
    public void A_composition_without_frontline_pays_for_it()
    {
        var (bonus, labels) = BattleRules.Composition(Team());
        Assert.Equal(0, bonus, 3);
        var glass = Team();
        glass[0] = U("Cassiopeia", Rarity.EPIC, ChampionClass.MAGE);
        glass[1] = U("Evelynn", Rarity.EPIC, ChampionClass.ASSASSIN);
        glass[4] = U("Lux", Rarity.EPIC, ChampionClass.MAGE, ChampionClass.SUPPORT);
        (bonus, labels) = BattleRules.Composition(glass);
        Assert.Contains(labels, l => l.Contains("frontline"));
        var rate = WinRate(glass, Team());
        output.WriteLine($"sans frontline : {rate:P1}");
        Assert.InRange(rate, 0.10, 0.45);
    }

    [Fact]
    public void Synergies_reward_skin_lines_and_punish_duplicates()
    {
        var team = Team();
        var lined = team.Select((u, i) => i < 3 ? u with { Lines = [7] } : u).ToList();
        var (bonus, labels) = BattleRules.Synergies(lined, new Dictionary<int, string> { [7] = "Projet" });
        Assert.Equal(0.06, bonus, 3);
        Assert.Contains(labels, l => l.Contains("Projet ×3"));

        var twice = team.Select((u, i) => i == 1 ? u with { ChampionId = team[0].ChampionId } : u).ToList();
        Assert.Contains(BattleRules.Synergies(twice, NoLines).Labels, l => l.Contains("double"));
    }
}

public class BattleFlowTests
{
    private static async Task<(HttpClient Http, Guid Id)> Player(ApiFactory factory, string name)
    {
        var http = factory.CreateClient();
        var auth = await (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = $"{name}@test.fr", password = "password123", displayName = name }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = await db.Users.Where(u => u.DisplayName == name).Select(u => u.Id).SingleAsync();
        return (http, id);
    }

    private static readonly int[] ChampionIds = [1, 2, 3, 4, 5];

    private static void SeedCatalog(ApiFactory factory) =>
        factory.Services.GetRequiredService<CapsuleCatalogService>().Set(new CapsuleCatalog
        {
            Champions =
            [
                new(1, "Darius", "Darius", ["fighter", "tank"]), new(2, "Lee Sin", "LeeSin", ["fighter", "assassin"]),
                new(3, "Ahri", "Ahri", ["mage", "assassin"]), new(4, "Jinx", "Jinx", ["marksman"]), new(5, "Thresh", "Thresh", ["support", "tank"]),
            ],
            Skins = [new(1001, 1, 1, "Darius test", Rarity.EPIC, [9], false, null)],
            Lines = [new(9, "Gamme test")],
            LoadedAt = DateTimeOffset.UtcNow,
        });

    /// <summary>Donne les 5 champions au joueur et les place à leur poste.</summary>
    private static async Task GiveRoster(ApiFactory factory, Guid userId, HttpClient http)
    {
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CapsuleWallets.Add(new CapsuleWallet { UserId = userId, AccrualAnchor = DateTimeOffset.UtcNow });
            foreach (var id in ChampionIds)
                db.CollectionItems.Add(new CollectionItem { UserId = userId, Kind = CapsuleItemKind.CHAMPION, ItemId = id, Count = 1, FirstObtainedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }
        (await http.PutAsJsonAsync("/api/v1/capsules/roster",
            new { slots = ChampionIds.Select(id => new { kind = "CHAMPION", itemId = id }) })).EnsureSuccessStatusCode();
    }

    private static async Task<BattleDto> Attack(HttpClient http, Guid opponent) =>
        (await (await http.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = opponent }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<BattleDto>(ApiJson.Options))!;

    [Fact]
    public async Task Full_rosters_are_required_to_fight()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, aId) = await Player(factory, "arenaA");
        var (_, bId) = await Player(factory, "arenaB");

        var res = await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = bId });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        await GiveRoster(factory, aId, a);
        res = await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = bId });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = aId })).StatusCode);
    }

    [Fact]
    public async Task Attack_updates_ratings_and_blocks_a_second_attack_until_the_revenge()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, aId) = await Player(factory, "duelA");
        var (b, bId) = await Player(factory, "duelB");
        await GiveRoster(factory, aId, a);
        await GiveRoster(factory, bId, b);

        var arena = await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.True(arena!.RosterReady);
        // Dates en UTC : PostgreSQL (Npgsql) refuse un décalage horaire dans les requêtes.
        Assert.Equal(TimeSpan.Zero, arena.ResetAt.Offset);
        Assert.Equal(TimeSpan.Zero, arena.Season.EndsAt.Offset);
        Assert.Contains("Split-push : une tour de plus par teamfight", arena.Team!.Synergies);
        Assert.Equal(12, arena.Team.Units[0].FitPercent);
        Assert.Equal(PowerCurve.EARLY, arena.Team.Units[0].Profile!.Curve);
        Assert.Contains(arena.Opponents, o => o.Player.UserId == bId && o.AvailableAt is null);

        var battle = await Attack(a, bId);
        Assert.Equal(1000, battle.Attacker.RatingBefore);
        Assert.Equal(battle.Attacker.RatingAfter - 1000, 1000 - battle.Defender.RatingAfter);
        Assert.Equal(battle.AttackerWon ? 16 : -16, battle.Attacker.RatingAfter - 1000);
        Assert.Equal(battle.AttackerWon ? 75 : 0, battle.Essence);

        // Deuxième attaque sur la même cible : refusée tant que B n'a pas riposté.
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = bId })).StatusCode);
        arena = await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.NotNull(arena!.Opponents.Single(o => o.Player.UserId == bId).AvailableAt);

        // B voit la revanche, riposte, et A peut de nouveau attaquer.
        var arenaB = await b.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.True(arenaB!.Opponents.Single(o => o.Player.UserId == aId).Revenge);
        factory.Clock.Advance(TimeSpan.FromMinutes(1));
        await Attack(b, aId);
        factory.Clock.Advance(TimeSpan.FromMinutes(1));
        await Attack(a, bId);

        // Ou, sans riposte, après le délai.
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = bId })).StatusCode);
        factory.Clock.Advance(TimeSpan.FromHours(24) + TimeSpan.FromMinutes(1));
        await Attack(a, bId);

        var history = await a.GetFromJsonAsync<List<BattleSummaryDto>>("/api/v1/capsules/battles", ApiJson.Options);
        Assert.Equal(4, history!.Count);
        Assert.Single(history, h => !h.Attacked);
        var replay = await b.GetFromJsonAsync<BattleDto>($"/api/v1/capsules/battles/{battle.Id}", ApiJson.Options);
        Assert.Equal(battle.Events.Count, replay!.Events.Count);

        var ladder = await a.GetFromJsonAsync<LadderDto>("/api/v1/capsules/ladder", ApiJson.Options);
        Assert.Equal(2, ladder!.Top.Count);
        Assert.True(ladder.Top[0].Rating >= ladder.Top[1].Rating);
        Assert.Equal(aId, ladder.Me!.UserId);
    }

    [Fact]
    public async Task Only_four_wins_a_day_pay_essence()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, aId) = await Player(factory, "farmA");
        await GiveRoster(factory, aId, a);
        var foes = new List<Guid>();
        for (var i = 0; i < 12; i++)
        {
            var (f, fId) = await Player(factory, $"foe{i}");
            await GiveRoster(factory, fId, f);
            foes.Add(fId);
        }

        var battles = new List<BattleDto>();
        foreach (var foe in foes) battles.Add(await Attack(a, foe));
        var paid = battles.Where(b => b.Essence > 0).ToList();
        Assert.Equal(Math.Min(4, battles.Count(b => b.AttackerWon)), paid.Count);
        Assert.All(paid, b => Assert.Equal(75, b.Essence));

        var arena = await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.Equal(paid.Count, arena!.RewardedToday);
        var state = await a.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options);
        Assert.Equal(paid.Count * 75, state!.Essence);
    }
}
