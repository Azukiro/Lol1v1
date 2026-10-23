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

public class TalentTests(ITestOutputHelper output)
{
    private static readonly Dictionary<int, string> NoLines = [];
    private static readonly (string, string?)[] Kit = [("Passif", "p.png"), ("Sort Q", "q.png"), ("Sort W", "w.png"), ("Sort E", "e.png"), ("Destinée", "r.png")];

    private static BattleUnit U(int id, string alias, Rarity rarity, params ChampionClass[] classes) =>
        new(CapsuleItemKind.CHAMPION, id, alias, id, rarity, classes, [], Talents.For(alias, classes, Kit));

    private static List<BattleUnit> Team(params string[] aliases)
    {
        ChampionClass[][] classes =
        [
            [ChampionClass.FIGHTER], [ChampionClass.FIGHTER, ChampionClass.ASSASSIN], [ChampionClass.MAGE], [ChampionClass.MARKSMAN], [ChampionClass.SUPPORT],
        ];
        return aliases.Select((a, i) => U(i + 1, a, Rarity.EPIC, classes[i])).ToList();
    }

    [Fact]
    public void Talents_use_the_real_spell_and_fall_back_by_class()
    {
        var tf = Talents.For("TwistedFate", [ChampionClass.MAGE], Kit);
        Assert.Equal(TalentEffect.GLOBAL, tf.Effect);
        Assert.Equal('R', tf.Slot);
        Assert.Equal("Destinée", tf.Spell);
        Assert.Equal("r.png", tf.Icon);

        var unknown = Talents.For("Nouveau", [ChampionClass.TANK], null);
        Assert.Equal(TalentEffect.ENGAGE, unknown.Effect);
        Assert.Equal("Ultime", unknown.Spell);
        Assert.True(Talents.IsMapped("MonkeyKing"));
    }

    [Fact]
    public void Sylas_steals_the_strongest_enemy_talent()
    {
        var mine = Team("Garen", "LeeSin", "Sylas", "Jinx", "Thresh");
        var theirs = Team("Darius", "Nunu", "Karthus", "Caitlyn", "Janna");
        theirs[2] = theirs[2] with { Rarity = Rarity.EXALTED };
        var (a, _) = BattleRules.Analyze(mine, theirs, NoLines);
        var sylas = a.Units[2].Talent!;
        Assert.Equal(TalentEffect.TEAMFIGHT, sylas.Effect);
        Assert.Contains("Karthus", sylas.Description);
    }

    [Fact]
    public void Talents_show_up_in_the_game_and_keep_the_score_consistent()
    {
        var mine = Team("Garen", "Warwick", "TwistedFate", "Jinx", "Blitzcrank");
        var theirs = Team("Nasus", "Nunu", "Zilean", "Ezreal", "Janna");
        var talents = 0;
        for (var seed = 0; seed < 300; seed++)
        {
            var o = BattleRules.Simulate(mine, theirs, seed, NoLines);
            talents += o.Events.Count(e => e.Kind == BattleEventKind.TALENT);
            Assert.Equal(o.Events[^1].KillsA, o.A.Units.Sum(u => u.Kills));
            Assert.Equal(o.Events[^1].KillsB, o.B.Units.Sum(u => u.Kills));
            Assert.Equal(o.Events[^1].KillsA, o.B.Units.Sum(u => u.Deaths));
            Assert.Contains(o.Events, e => e.Text.Contains("Destinée"));
        }
        Assert.True(talents > 300 * 3);
    }

    [Fact]
    public void Talent_mirror_stays_balanced()
    {
        var team = Team("Garen", "Warwick", "TwistedFate", "Jinx", "Blitzcrank");
        var wins = Enumerable.Range(0, 4000).Count(seed => BattleRules.Simulate(team, team, seed, NoLines).Winner == BattleSide.A) / 4000.0;
        output.WriteLine($"miroir avec talents : {wins:P1}");
        Assert.InRange(wins, 0.45, 0.55);
    }

    [Fact]
    public void Seasons_map_ratings_to_tiers_and_soften_resets()
    {
        Assert.Equal(1, Seasons.Number("2026-10"));
        Assert.Equal(4, Seasons.Number("2027-01"));
        Assert.Equal(Tier.BRONZE, Seasons.TierOf(900));
        Assert.Equal(Tier.SILVER, Seasons.TierOf(1000));
        Assert.Equal(Tier.GOLD, Seasons.TierOf(1050));
        Assert.Equal(Tier.MASTER, Seasons.TierOf(1600));
        Assert.Equal(1050, Seasons.NextThreshold(1000));
        Assert.Null(Seasons.NextThreshold(1400));
        Assert.Equal(950, Seasons.Floor(1000));
        Assert.Equal(1100, Seasons.SoftReset(1200, 1000));
        Assert.Equal(950, Seasons.SoftReset(900, 1000));
    }
}

public class SeasonAndReplayFlowTests
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

    private static async Task<BattleDto> Attack(HttpClient http, Guid opponent) =>
        (await (await http.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = opponent }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<BattleDto>(ApiJson.Options))!;

    [Fact]
    public async Task Season_end_archives_pays_and_softly_resets()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, aId) = await Player(factory, "seasonA");
        var foes = new List<Guid>();
        for (var i = 0; i < 5; i++) foes.Add((await Player(factory, $"seasonFoe{i}")).Id);
        foreach (var foe in foes) await Attack(a, foe);

        var arena = await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.Equal(1, arena!.Season.Number);
        Assert.Null(arena.LastSeason);
        Assert.Equal(Seasons.TierOf(arena.Rating), arena.Season.Tier);
        Assert.Contains(arena.Team!.Units, u => u.Talent is { Spell: "Destinée", Effect: TalentEffect.GLOBAL });
        var before = arena.Rating;
        var stockBefore = (await a.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options))!;

        // Passage en novembre (heure de Paris) : saison 2.
        factory.Clock.Advance(TimeSpan.FromDays(26));
        arena = await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options);
        Assert.Equal(2, arena!.Season.Number);
        Assert.Equal(0, arena.Wins + arena.Losses);
        Assert.Equal(Seasons.SoftReset(before, 1000), arena.Rating);
        var last = arena.LastSeason!;
        Assert.Equal(1, last.Number);
        Assert.Equal(before, last.Rating);
        var (std, prem) = Seasons.Reward(Seasons.TierOf(before));
        Assert.Equal((std, prem), (last.RewardStandard, last.RewardPremium));
        var stock = (await a.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options))!;
        Assert.Equal(stockBefore.PremiumAvailable + prem, stock.PremiumAvailable);

        // Le classement repart de zéro ; le bilan disparaît une fois vu.
        Assert.Empty((await a.GetFromJsonAsync<LadderDto>("/api/v1/capsules/ladder", ApiJson.Options))!.Top);
        (await a.PostAsync($"/api/v1/capsules/seasons/{last.Id}/seen", null)).EnsureSuccessStatusCode();
        Assert.Null((await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!.LastSeason);
    }

    [Fact]
    public async Task Shared_replay_is_readable_without_an_account()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, _) = await Player(factory, "shareA");
        var (b, bId) = await Player(factory, "shareB");
        var battle = await Attack(a, bId);

        var share = await (await a.PostAsync($"/api/v1/capsules/battles/{battle.Id}/share", null)).EnsureSuccessStatusCode()
            .Content.ReadFromJsonAsync<ShareDto>(ApiJson.Options);
        var again = await (await b.PostAsync($"/api/v1/capsules/battles/{battle.Id}/share", null)).EnsureSuccessStatusCode()
            .Content.ReadFromJsonAsync<ShareDto>(ApiJson.Options);
        Assert.Equal(share!.Code, again!.Code);

        var anonymous = factory.CreateClient();
        var replay = await anonymous.GetFromJsonAsync<BattleDto>($"/api/v1/replays/{share.Code}", ApiJson.Options);
        Assert.Equal(battle.Events.Count, replay!.Events.Count);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/v1/replays/inconnu")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/api/v1/capsules/catalog")).StatusCode);

        // Un tiers connecté ne peut pas créer de lien sur un combat qui n'est pas le sien.
        var (c, _) = await Player(factory, "shareC");
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsync($"/api/v1/capsules/battles/{battle.Id}/share", null)).StatusCode);
    }
}
