using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Api.Domain.Capsules;
using Api.Dtos;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests;

public class CapsuleRulesTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Hour = TimeSpan.FromHours(1);

    [Fact]
    public void Accrue_adds_one_capsule_per_full_hour_and_keeps_the_remainder()
    {
        var (available, anchor) = CapsuleRules.Accrue(2, T0, T0.AddMinutes(150), 10, Hour);
        Assert.Equal(4, available);
        Assert.Equal(T0.AddHours(2), anchor);
    }

    [Fact]
    public void Accrue_stops_at_the_cap_and_restarts_the_hour()
    {
        var now = T0.AddHours(30);
        Assert.Equal((10, now), CapsuleRules.Accrue(3, T0, now, 10, Hour));
        // Stock acheté au-delà du plafond : conservé, mais n'accumule plus.
        Assert.Equal((12, now), CapsuleRules.Accrue(12, T0, now, 10, Hour));
    }

    [Fact]
    public void Guaranteed_roll_is_always_epic_or_better()
    {
        var all = Enum.GetValues<Rarity>().ToHashSet();
        var rng = new Random(42);
        for (var i = 0; i < 500; i++) Assert.True(CapsuleRules.RollRarity(rng, CapsuleType.STANDARD, true, all) >= Rarity.EPIC);
    }

    [Fact]
    public void Roll_follows_the_weights_and_skips_missing_rarities()
    {
        var rng = new Random(7);
        var counts = new Dictionary<Rarity, int>();
        var available = new HashSet<Rarity> { Rarity.COMMON, Rarity.RARE, Rarity.EPIC };
        for (var i = 0; i < 20_000; i++)
        {
            var r = CapsuleRules.RollRarity(rng, CapsuleType.STANDARD, false, available);
            counts[r] = counts.GetValueOrDefault(r) + 1;
        }
        Assert.Equal(available, counts.Keys.ToHashSet());
        Assert.InRange(counts[Rarity.COMMON] / 20_000.0, 0.58, 0.62); // 5500 / 9400
    }

    [Theory]
    [InlineData("kNoRarity", Rarity.COMMON)]
    [InlineData("kEpic", Rarity.RARE)]
    [InlineData("kMythic", Rarity.LEGENDARY)]
    [InlineData("kTranscendent", Rarity.ULTIMATE)]
    public void Game_rarity_maps_to_capsule_rarity(string game, Rarity expected) => Assert.Equal(expected, CapsuleRules.FromGameRarity(game));
}

public class CapsuleFlowTests
{
    private static async Task<HttpClient> Login(ApiFactory factory, string name)
    {
        var http = factory.CreateClient();
        var auth = await (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = $"{name}@test.fr", password = "password123", displayName = name }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        return http;
    }

    private static void SeedCatalog(ApiFactory factory) =>
        factory.Services.GetRequiredService<CapsuleCatalogService>().Set(new CapsuleCatalog
        {
            Champions = [new(1, "Annie", "Annie"), new(2, "Olaf", "Olaf")],
            Skins = [new(1001, 1, 1, "Annie gothique", Rarity.COMMON, [], true, null), new(1002, 1, 2, "Annie rouge", Rarity.EPIC, [5], false, null)],
            Lines = [new(5, "Gamme test")],
            LoadedAt = DateTimeOffset.UtcNow,
        });

    [Fact]
    public async Task New_player_gets_welcome_capsules_then_one_per_hour()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var http = await Login(factory, "capsA");

        var state = await http.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options);
        Assert.Equal(3, state!.Available);

        var opened = await (await http.PostAsJsonAsync("/api/v1/capsules/open", new { count = 3 }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<OpenCapsulesResponse>(ApiJson.Options);
        Assert.Equal(3, opened!.Drops.Count);
        Assert.Equal(0, opened.State.Available);
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsJsonAsync("/api/v1/capsules/open", new { count = 1 })).StatusCode);

        factory.Clock.Advance(TimeSpan.FromMinutes(61));
        state = await http.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options);
        Assert.Equal(1, state!.Available);

        var collection = await http.GetFromJsonAsync<CollectionResponse>("/api/v1/capsules/collection", ApiJson.Options);
        Assert.Equal(3, collection!.Items.Sum(i => i.Count));
        Assert.Equal(3, collection.Recent.Count);
    }

    [Fact]
    public async Task Tenth_capsule_without_epic_is_guaranteed()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var http = await Login(factory, "capsB");
        await http.GetAsync("/api/v1/capsules/state");
        factory.Clock.Advance(TimeSpan.FromHours(20));

        var drops = new List<CapsuleDropDto>();
        for (var round = 0; round < 3; round++)
        {
            var res = await (await http.PostAsJsonAsync("/api/v1/capsules/open", new { count = 10 }))
                .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<OpenCapsulesResponse>(ApiJson.Options);
            drops.AddRange(res!.Drops);
            factory.Clock.Advance(TimeSpan.FromHours(20));
        }
        // Jamais plus de 9 tirages d'affilée sous Épique.
        var streak = 0;
        foreach (var d in drops)
        {
            streak = d.Rarity >= Rarity.EPIC ? 0 : streak + 1;
            Assert.True(streak < CapsuleRules.PityThreshold);
        }
        // Doublons convertis en essence.
        Assert.Contains(drops, d => !d.IsNew && d.Essence > 0);
    }

    [Fact]
    public async Task Debug_endpoints_are_unavailable_outside_development()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var http = await Login(factory, "capsC");
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsJsonAsync("/api/v1/capsules/debug/grant", new { count = 50 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsync("/api/v1/capsules/debug/reset", null)).StatusCode);
        var state = await http.GetFromJsonAsync<CapsuleStateDto>("/api/v1/capsules/state", ApiJson.Options);
        Assert.False(state!.Debug);
        Assert.Equal(3, state.Available);
    }

    [Fact]
    public async Task Premium_capsule_is_forged_with_essence_and_never_drops_a_common_skin()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var http = await Login(factory, "capsD");
        await http.GetAsync("/api/v1/capsules/state");
        // Pas assez d'essence pour une prestige.
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsJsonAsync("/api/v1/capsules/buy", new { type = "PREMIUM" })).StatusCode);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Api.Data.AppDbContext>();
            db.CapsuleWallets.Single().Essence = 1300;
            await db.SaveChangesAsync();
        }
        await (await http.PostAsJsonAsync("/api/v1/capsules/buy", new { type = "PREMIUM" })).EnsureSuccessStatusCode().Content.ReadFromJsonAsync<CapsuleStateDto>(ApiJson.Options);
        var state = await (await http.PostAsJsonAsync("/api/v1/capsules/buy", new { type = "PREMIUM" }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<CapsuleStateDto>(ApiJson.Options);
        Assert.Equal(2, state!.PremiumAvailable);
        Assert.Equal(100, state.Essence);
        Assert.Equal(3, state.Available);

        var opened = await (await http.PostAsJsonAsync("/api/v1/capsules/open", new { count = 2, type = "PREMIUM" }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<OpenCapsulesResponse>(ApiJson.Options);
        Assert.All(opened!.Drops, d => Assert.NotEqual(Rarity.COMMON, d.Rarity));
        Assert.Equal(0, opened.State.PremiumAvailable);
        Assert.Equal(3, opened.State.Available);
    }

    [Fact]
    public void Catalog_lists_odds_and_price_of_both_capsules()
    {
        Assert.DoesNotContain(Rarity.COMMON, CapsuleRules.PremiumWeights.Keys);
        Assert.Equal(10_000, CapsuleRules.StandardWeights.Values.Sum());
        Assert.Equal(10_000, CapsuleRules.PremiumWeights.Values.Sum());
    }

    [Fact]
    public async Task Old_capsules_path_redirects_to_reliques()
    {
        await using var factory = new ApiFactory();
        var http = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var res = await http.GetAsync("/capsules/?view=collection");
        Assert.Equal(HttpStatusCode.MovedPermanently, res.StatusCode);
        Assert.Equal("/reliques/?view=collection", res.Headers.Location!.OriginalString);
        res = await http.GetAsync("/capsules");
        Assert.Equal("/reliques/", res.Headers.Location!.OriginalString);
        // L'API garde son nom interne.
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/api/v1/capsules/state")).StatusCode);
    }

    [Fact]
    public async Task Champions_only_drop_at_the_rarest_tier()
    {
        await using var factory = new ApiFactory();
        SeedCatalog(factory);
        var http = await Login(factory, "capsE");
        await http.GetAsync("/api/v1/capsules/state");
        var drops = new List<CapsuleDropDto>();
        for (var round = 0; round < 10; round++)
        {
            factory.Clock.Advance(TimeSpan.FromHours(20));
            drops.AddRange((await (await http.PostAsJsonAsync("/api/v1/capsules/open", new { count = 10 }))
                .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<OpenCapsulesResponse>(ApiJson.Options))!.Drops);
        }
        Assert.All(drops, d => Assert.Equal(d.Kind == CapsuleItemKind.CHAMPION, d.Rarity == CapsuleRules.ChampionRarity));
        Assert.True(CapsuleRules.StandardWeights[CapsuleRules.ChampionRarity] == CapsuleRules.StandardWeights.Values.Min());
    }
}

