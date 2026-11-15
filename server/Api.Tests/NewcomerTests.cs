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

public class NewcomerRulesTests
{
    private static NewcomerChampion C(int id, string alias, params ChampionClass[] classes) => new(id, alias, classes);

    private static readonly List<NewcomerChampion> Pool =
    [
        C(1, "Darius", ChampionClass.FIGHTER), C(2, "LeeSin", ChampionClass.FIGHTER), C(3, "Ahri", ChampionClass.MAGE),
        C(4, "Jinx", ChampionClass.MARKSMAN), C(5, "Thresh", ChampionClass.SUPPORT), C(6, "Camille", ChampionClass.FIGHTER),
        C(7, "Fiora", ChampionClass.FIGHTER), C(8, "Aatrox", ChampionClass.FIGHTER), C(9, "Caitlyn", ChampionClass.MARKSMAN),
    ];

    [Fact]
    public void Starter_team_puts_a_common_skin_of_a_main_role_champion_at_each_post()
    {
        List<NewcomerSkin> skins =
        [
            .. Pool.Select(c => new NewcomerSkin(100 + c.Id, c.Id, Rarity.COMMON)),
            new(900, 3, Rarity.LEGENDARY), // jamais offert : pas COMMON
        ];
        for (var seed = 0; seed < 20; seed++)
        {
            var team = Newcomers.StarterTeam(Pool, skins, new Random(seed));
            Assert.Equal(BattleRules.TeamSize, team.Count);
            Assert.All(team, s => Assert.Equal(Rarity.COMMON, s!.Rarity));
            Assert.Equal(5, team.Select(s => s!.ChampionId).Distinct().Count());
            for (var role = 0; role < BattleRules.TeamSize; role++)
            {
                var champ = Pool.Single(c => c.Id == team[role]!.ChampionId);
                Assert.Equal(role, Profiles.For(champ.Alias, champ.Classes)!.Main);
            }
        }
    }

    [Fact]
    public void Starter_team_leaves_a_post_empty_when_no_common_skin_fits()
    {
        var team = Newcomers.StarterTeam(Pool, [new(101, 1, Rarity.COMMON)], new Random(1));
        Assert.Equal(101, team[BattleRules.Top]!.Id);
        Assert.All(team.Skip(1), Assert.Null);
    }

    [Fact]
    public void Rotation_is_stable_for_a_week_and_capped_per_role()
    {
        var a = Newcomers.Rotation(Pool, Newcomers.Seed("2026-W46"));
        Assert.Equal(a, Newcomers.Rotation(Pool, Newcomers.Seed("2026-W46")));
        // 4 tops dans le pool : 3 au plus dans la rotation ; un seul champion pour les autres postes.
        Assert.Equal(Newcomers.RotationPerRole, a.Count(id => id is 1 or 6 or 7 or 8));
        Assert.Contains(2, a);
        Assert.Contains(3, a);
        Assert.Contains(5, a);
        Assert.Equal(2, a.Count(id => id is 4 or 9));
        Assert.Equal(a.Count, a.Distinct().Count());
    }
}

public class NewcomerRookieRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(1, 0, true)]
    [InlineData(6, 19, true)]
    [InlineData(1, 20, false)]
    [InlineData(7, 0, false)]
    public void Rookies_are_young_accounts_with_few_attacks(int days, int attacks, bool rookie) =>
        Assert.Equal(rookie, Newcomers.IsRookie(Now.AddDays(-days), attacks, Now, 7, 20));

    [Theory]
    [InlineData(0, 2.0)]
    [InlineData(49, 2.0)]
    [InlineData(50, 1.5)]
    [InlineData(99, 1.5)]
    [InlineData(100, 1.0)]
    [InlineData(250, 1.0)]
    public void Catch_up_doubles_then_adds_half_below_ten_percent(int owned, double mult) =>
        Assert.Equal(mult, Newcomers.CatchUp(owned, 1000, 0.05, 2, 0.10, 1.5));
}

public class NewcomerFlowTests
{
    private static async Task<(HttpClient Http, Guid Id)> Player(ApiFactory factory, string name)
    {
        var http = factory.CreateClient();
        var auth = await (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = $"{name}@test.fr", password = "password123", displayName = name }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (http, await db.Users.Where(u => u.DisplayName == name).Select(u => u.Id).SingleAsync());
    }

    private static void SeedCatalog(ApiFactory factory, int extraSkins = 0) =>
        factory.Services.GetRequiredService<CapsuleCatalogService>().Set(new CapsuleCatalog
        {
            Champions =
            [
                new(1, "Darius", "Darius", ["fighter", "tank"]), new(2, "Lee Sin", "LeeSin", ["fighter", "assassin"]),
                new(3, "Ahri", "Ahri", ["mage", "assassin"]), new(4, "Jinx", "Jinx", ["marksman"]), new(5, "Thresh", "Thresh", ["support", "tank"]),
            ],
            Skins =
            [
                new(1001, 1, 1, "Darius commun", Rarity.COMMON, [], false, null), new(2001, 2, 1, "Lee Sin commun", Rarity.COMMON, [], false, null),
                new(3001, 3, 1, "Ahri commune", Rarity.COMMON, [], false, null), new(4001, 4, 1, "Jinx commune", Rarity.COMMON, [], false, null),
                new(5001, 5, 1, "Thresh commun", Rarity.COMMON, [], false, null), new(3002, 3, 2, "Ahri épique", Rarity.EPIC, [], false, null),
                // Catalogue grossi (skins légendaires) : 5 objets n'en font alors qu'une petite part.
                .. Enumerable.Range(0, extraSkins).Select(i => new CatalogSkin(10_000 + i, 1 + i % 5, 100 + i, $"Skin {i}", Rarity.LEGENDARY, [], false, null)),
            ],
            Lines = [],
            LoadedAt = DateTimeOffset.UtcNow,
        });

    /// <summary>Vétéran : compte vieux d'un mois, 5 champions au roster et <paramref name="extraSkins"/> skins en plus.</summary>
    private static async Task<(HttpClient Http, Guid Id)> Veteran(ApiFactory factory, string name, int extraSkins)
    {
        var (http, id) = await Player(factory, name);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Users.SingleAsync(u => u.Id == id)).CreatedAt = factory.Clock.GetUtcNow().AddDays(-30);
            db.CapsuleWallets.Add(new CapsuleWallet { UserId = id, AccrualAnchor = DateTimeOffset.UtcNow });
            foreach (var c in new[] { 1, 2, 3, 4, 5 })
                db.CollectionItems.Add(new CollectionItem { UserId = id, Kind = CapsuleItemKind.CHAMPION, ItemId = c, Count = 1, FirstObtainedAt = DateTimeOffset.UtcNow });
            for (var i = 0; i < extraSkins; i++)
                db.CollectionItems.Add(new CollectionItem { UserId = id, Kind = CapsuleItemKind.SKIN, ItemId = 10_000 + i, Count = 1, FirstObtainedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }
        (await http.PutAsJsonAsync("/api/v1/capsules/roster",
            new { slots = new[] { 1, 2, 3, 4, 5 }.Select(c => new { kind = "CHAMPION", itemId = c }) })).EnsureSuccessStatusCode();
        return (http, id);
    }

    private static async Task<(HttpClient Http, Guid Id)> Rookie(ApiFactory factory, string name)
    {
        var p = await Player(factory, name);
        // Inscription à l'heure de l'horloge de test (l'API date les comptes à l'heure réelle).
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Users.SingleAsync(u => u.Id == p.Id)).CreatedAt = factory.Clock.GetUtcNow();
            await db.SaveChangesAsync();
        }
        (await p.Http.GetAsync("/api/v1/capsules/state")).EnsureSuccessStatusCode(); // équipe de départ
        return p;
    }

    private static Task<ArenaDto> Arena(HttpClient http) => http.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options)!;

    [Fact]
    public async Task Rookies_meet_small_collections_and_veterans_cannot_pick_on_them()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory, extraSkins: 100);
        var (vet, vetId) = await Veteran(factory, "veteran", extraSkins: 40);
        var (rookie, rookieId) = await Rookie(factory, "recrue1");
        var (_, rookie2Id) = await Rookie(factory, "recrue2");

        // Le vétéran ne voit pas les recrues et ne peut pas les défier.
        Assert.DoesNotContain((await Arena(vet)).Opponents, o => o.Player.UserId == rookieId || o.Player.UserId == rookie2Id);
        Assert.Equal(HttpStatusCode.Conflict, (await vet.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = rookieId })).StatusCode);

        // La recrue voit d'abord les collections proches ; le vétéran (hors de portée) ne vient qu'en complément.
        var arena = await Arena(rookie);
        Assert.NotNull(arena.Rookie);
        Assert.Equal(20, arena.Rookie!.BattlesLeft);
        Assert.Equal(rookie2Id, arena.Opponents.First(o => !o.Friend).Player.UserId);
        Assert.True(arena.Opponents.Single(o => o.Player.UserId == rookie2Id).Rookie);

        // La recrue peut attaquer le vétéran, qui peut alors riposter.
        (await rookie.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = vetId })).EnsureSuccessStatusCode();
        (await vet.PostAsJsonAsync("/api/v1/capsules/battles", new { opponentId = rookieId })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Small_collections_earn_more_essence_per_win()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory, extraSkins: 100);
        var (vet, _) = await Veteran(factory, "veteranEss", extraSkins: 20);
        var (rookie, _) = await Rookie(factory, "recrueEss");

        var veteran = await Arena(vet);
        var mine = await Arena(rookie);
        Assert.Equal(0, veteran.CatchUpPercent);
        Assert.Equal(100, mine.CatchUpPercent);
        Assert.Equal(2 * veteran.WinEssence, mine.WinEssence);
    }

    [Fact]
    public async Task New_players_get_a_full_starter_roster_and_can_borrow_rotation_champions()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var (a, _) = await Player(factory, "recrue");

        (await a.GetAsync("/api/v1/capsules/state")).EnsureSuccessStatusCode();
        var coll = (await a.GetFromJsonAsync<CollectionResponse>("/api/v1/capsules/collection", ApiJson.Options))!;
        Assert.Equal([1001, 2001, 3001, 4001, 5001], coll.Roster.Select(s => s!.ItemId));
        Assert.All(coll.Roster, s => Assert.Equal(CapsuleItemKind.SKIN, s!.Kind));
        Assert.Equal(5, coll.Items.Count);
        Assert.NotNull(coll.Rotation);
        Assert.Equal([1, 2, 3, 4, 5], coll.Rotation!.ChampionIds.Order());

        var arena = (await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.True(arena.RosterReady);

        // Prêt de Jinx (non possédée) au poste bot : jouable, rareté Commune.
        object?[] slots =
        [
            new { kind = "SKIN", itemId = 1001 }, new { kind = "SKIN", itemId = 2001 }, new { kind = "SKIN", itemId = 3001 },
            new { kind = "CHAMPION", itemId = 4, loan = true }, new { kind = "SKIN", itemId = 5001 },
        ];
        var roster = (await (await a.PutAsJsonAsync("/api/v1/capsules/roster", new { slots })).EnsureSuccessStatusCode()
            .Content.ReadFromJsonAsync<List<RosterSlotDto?>>(ApiJson.Options))!;
        Assert.True(roster[BattleRules.Bot]!.Loan);
        arena = (await a.GetFromJsonAsync<ArenaDto>("/api/v1/capsules/arena", ApiJson.Options))!;
        Assert.Equal(Rarity.COMMON, arena.Team!.Units[BattleRules.Bot].Rarity);

        // Sans prêt, un champion non possédé reste refusé ; un prêt hors rotation aussi.
        slots[BattleRules.Bot] = new { kind = "CHAMPION", itemId = 4 };
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/v1/capsules/roster", new { slots })).StatusCode);
        slots[BattleRules.Bot] = new { kind = "CHAMPION", itemId = 999, loan = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/v1/capsules/roster", new { slots })).StatusCode);
        slots[BattleRules.Bot] = new { kind = "SKIN", itemId = 4001, loan = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/v1/capsules/roster", new { slots })).StatusCode);
    }
}
