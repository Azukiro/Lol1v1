using System.Net.Http.Headers;
using System.Net.Http.Json;
using Api.Data;
using Api.Domain.Capsules;
using Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests;

/// <summary>Fil du Club : gros tirages des amis et combats entre amis, sur 7 jours.</summary>
public class FeedTests
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

    private static async Task<List<FeedItemDto>> Feed(HttpClient http) =>
        (await http.GetFromJsonAsync<List<FeedItemDto>>("/api/v1/capsules/feed", ApiJson.Options))!;

    [Fact]
    public async Task Feed_shows_friends_big_new_pulls_and_battles_between_friends_of_the_last_week()
    {
        await using var factory = new ApiFactory();
        var (me, meId) = await Player(factory, "feedMe");
        var (_, friendId) = await Player(factory, "feedFriend");
        var (_, strangerId) = await Player(factory, "feedStranger");

        // Sans ami : fil vide.
        Assert.Empty(await Feed(me));
        (await me.PostAsJsonAsync("/api/v1/capsules/friends", new { userId = friendId })).EnsureSuccessStatusCode();

        var now = factory.Clock.GetUtcNow();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            CapsuleDrop Drop(Guid user, Rarity r, bool isNew, TimeSpan ago, int item) =>
                new() { UserId = user, Kind = CapsuleItemKind.SKIN, ItemId = item, Rarity = r, IsNew = isNew, OpenedAt = now - ago };
            db.CapsuleDrops.AddRange(
                Drop(friendId, Rarity.LEGENDARY, true, TimeSpan.FromHours(2), 1),   // affiché
                Drop(friendId, Rarity.COMMON, true, TimeSpan.FromHours(1), 2),      // trop commun
                Drop(friendId, Rarity.MYTHIC, false, TimeSpan.FromHours(3), 3),     // doublon
                Drop(friendId, Rarity.EPIC, true, TimeSpan.FromDays(8), 4),         // trop ancien
                Drop(strangerId, Rarity.EXALTED, true, TimeSpan.FromHours(1), 5),   // pas un ami
                Drop(meId, Rarity.EXALTED, true, TimeSpan.FromHours(1), 6));        // ses propres tirages restent dans « Derniers tirages »
            RelicBattle Battle(Guid a, Guid d, TimeSpan ago) => new() { AttackerId = a, DefenderId = d, AttackerWon = true, CreatedAt = now - ago };
            db.RelicBattles.AddRange(
                Battle(friendId, meId, TimeSpan.FromMinutes(30)),    // affiché
                Battle(meId, strangerId, TimeSpan.FromMinutes(20)),  // contre un inconnu : non
                Battle(friendId, meId, TimeSpan.FromDays(9)));       // trop ancien
            await db.SaveChangesAsync();
        }

        var feed = await Feed(me);
        Assert.Equal(["BATTLE", "DROP"], feed.Select(f => f.Kind));
        var battle = feed[0];
        Assert.Equal((friendId, meId, true), (battle.Attacker!.UserId, battle.Defender!.UserId, battle.AttackerWon!.Value));
        var drop = feed[1];
        Assert.Equal((friendId, 1, Rarity.LEGENDARY), (drop.Player!.UserId, drop.ItemId!.Value, drop.Rarity!.Value));
        Assert.True(drop.Player.Added);

        // Un combat entre inconnus reste privé.
        Guid hidden;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var b = new RelicBattle { AttackerId = strangerId, DefenderId = Guid.NewGuid(), CreatedAt = now };
            db.RelicBattles.Add(b); await db.SaveChangesAsync(); hidden = b.Id;
        }
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await me.GetAsync($"/api/v1/capsules/battles/{hidden}")).StatusCode);
    }
}
