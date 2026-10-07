using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Api.Data;
using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Api.Tests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 7, 20, 0, 0, TimeSpan.Zero));
    private readonly string _db = Guid.NewGuid().ToString();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Jwt:Key", "test-key-0123456789-0123456789-0123456789");
        builder.UseSetting("ConnectionStrings:Default", "Host=unused");
        builder.UseSetting("Game:LoadDataDragon", "false");
        builder.UseSetting("Game:EnableTicker", "false");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase(_db));
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }
}

internal static class ServiceCollectionExt
{
    public static void RemoveAll<T>(this IServiceCollection services)
    {
        foreach (var d in services.Where(d => d.ServiceType == typeof(T)).ToList()) services.Remove(d);
    }
}

/// <summary>Joueur simulé : client HTTP + connexion SignalR qui enregistre les événements reçus.</summary>
public sealed class TestPlayer : IAsyncDisposable
{
    public required HttpClient Http { get; init; }
    public required HubConnection Hub { get; init; }
    public required string RiotId { get; init; }
    public ConcurrentQueue<(string Name, JsonElement? Payload)> Events { get; } = new();

    public static async Task<TestPlayer> CreateAsync(ApiFactory factory, string name)
    {
        var http = factory.CreateClient();
        var auth = await (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = $"{name}@test.fr", password = "password123", displayName = name }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        (await http.PostAsJsonAsync("/api/v1/riot-accounts/link", new { puuid = $"puuid-{name}", gameName = name, tagLine = "EUW", region = "EUW" }))
            .EnsureSuccessStatusCode();

        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/series"), o =>
            {
                o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.AccessTokenProvider = () => Task.FromResult<string?>(auth.Token);
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()))
            .Build();
        var player = new TestPlayer { Http = http, Hub = hub, RiotId = $"{name}#EUW" };
        foreach (var evt in new[] { "SeriesUpdated", "BansRevealed", "AssignmentReady", "PicksRevealed", "LaunchLobby", "PickWarning",
                     "RoundVoided", "RoundResolved", "RoundDisputed", "SeriesFinished", "VoidRequested", "SeriesAborted" })
            hub.On<Guid, JsonElement?>(evt, (_, payload) => player.Events.Enqueue((evt, payload)));
        hub.On<JsonElement>("InvitationReceived", p => player.Events.Enqueue(("InvitationReceived", p)));
        hub.On<JsonElement>("InvitationUpdated", p => player.Events.Enqueue(("InvitationUpdated", p)));
        await hub.StartAsync();
        return player;
    }

    public async Task<SeriesStateDto> State(Guid seriesId) =>
        (await Http.GetFromJsonAsync<SeriesStateDto>($"/api/v1/series/{seriesId}", ApiJson.Options))!;

    public async Task PutPool(Guid seriesId, int[] owned, int[]? free = null) =>
        (await Http.PutAsJsonAsync($"/api/v1/series/{seriesId}/pool", new { championIds = owned, freeChampionIds = free ?? [] })).EnsureSuccessStatusCode();

    public Task Kill(Guid seriesId, string eventId, double time, string subject) =>
        Hub.InvokeAsync("ReportObservation", seriesId, new ObservationReport("KILL", eventId, time, new ObservationPayload(subject, null, null)));

    public bool Received(string name) => Events.Any(e => e.Name == name);

    public async ValueTask DisposeAsync() => await Hub.DisposeAsync();
}

public static class ApiJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };
}

public class SeriesFlowTests
{
    private static object Config(int bo, string champ, string spells, object expr) =>
        new { bestOf = bo, championMode = champ, spellMode = spells, winExpression = expr };

    private static readonly object KillsOrTower = new
    {
        op = "OR",
        children = new object[] { new { condition = "KILLS", threshold = 2 }, new { condition = "FIRST_TOWER" } },
    };

    private static async Task<Guid> StartSeries(TestPlayer a, TestPlayer b, object config)
    {
        var inv = await (await a.Http.PostAsJsonAsync("/api/v1/invitations", new { toRiotId = b.RiotId, config }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
        await Eventually(() => b.Received("InvitationReceived"));
        var accepted = await (await b.Http.PostAsync($"/api/v1/invitations/{inv!["id"]}/accept", null))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
        return Guid.Parse(accepted!["seriesId"]!.GetValue<string>());
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition());
    }

    [Fact]
    public async Task Invitation_rejects_even_best_of()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var res = await a.Http.PostAsJsonAsync("/api/v1/invitations", new { toRiotId = b.RiotId, config = Config(4, "MIRROR", "FREE", KillsOrTower) });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Riot_account_links_to_a_single_user()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var res = await b.Http.PostAsJsonAsync("/api/v1/riot-accounts/link", new { puuid = "puuid-Kaelis", gameName = "Kaelis", tagLine = "EUW", region = "EUW" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Presets_server_and_user_defined()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        var bad = await a.Http.PostAsJsonAsync("/api/v1/presets", new { name = "Pair", config = Config(4, "MIRROR", "FREE", KillsOrTower) });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var created = await (await a.Http.PostAsJsonAsync("/api/v1/presets", new { name = "Mon BO5", config = Config(5, "DECK", "FREE", KillsOrTower) }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
        var list = await a.Http.GetFromJsonAsync<PresetsResponse>("/api/v1/presets", ApiJson.Options);
        Assert.True(list!.Server.Count >= 3);
        Assert.All(list.Server, p => p.Config.Validate());
        Assert.Equal("Mon BO5", Assert.Single(list.Mine).Name);
        (await a.Http.DeleteAsync($"/api/v1/presets/{created!["id"]}")).EnsureSuccessStatusCode();
        Assert.Empty((await a.Http.GetFromJsonAsync<PresetsResponse>("/api/v1/presets", ApiJson.Options))!.Mine);
    }

    [Fact]
    public async Task Lookup_returns_only_registered_friends()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var res = await (await a.Http.PostAsJsonAsync("/api/v1/users/lookup", new { puuids = new[] { "puuid-Vorn", "puuid-inconnu" } }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<List<RegisteredPlayer>>();
        Assert.Equal("Vorn#EUW", Assert.Single(res!).RiotId);
    }

    [Fact]
    public async Task Mirror_bo3_played_end_to_end()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, Config(3, "MIRROR", "FREE", KillsOrTower));

        await a.PutPool(id, [1, 2, 3, 4, 5]);
        Assert.Equal("SETUP", (await a.State(id)).Status);
        await b.PutPool(id, [3, 4, 5, 6], [7]);

        var state = await a.State(id);
        Assert.Equal("IN_PROGRESS", state.Status);
        var r1 = state.Rounds.Single();
        Assert.Equal("LOBBY", r1.Status);
        Assert.All(r1.Assignments, x => Assert.Contains(x.ChampionId!.Value, new[] { 3, 4, 5 }));
        Assert.Equal(r1.Assignments[0].ChampionId, r1.Assignments[1].ChampionId);
        await Eventually(() => a.Received("LaunchLobby"));
        Assert.False(b.Received("LaunchLobby"));

        // Manche 1 : A fait 2 kills vus par les deux clients.
        await a.Hub.InvokeAsync("ReportGameStarted", id, 4242L, r1.Assignments[0].ChampionId, (int[]?)null);
        foreach (var (eid, t) in new[] { ("1", 120.0), ("2", 312.4) })
        {
            await a.Kill(id, eid, t, "SELF");
            await b.Kill(id, eid, t, "OPPONENT");
        }
        await Eventually(() => b.Received("RoundResolved"));
        state = await b.State(id);
        Assert.Equal("VALIDATED", state.Rounds[0].Status);
        Assert.Equal("A", state.Rounds[0].WinnerSlot);
        Assert.Equal("Kills ≥ 2", state.Rounds[0].WinningCondition!.Label);
        Assert.Equal(312.4, state.Rounds[0].WinningCondition!.EventTime);

        // Observation tardive ignorée.
        await b.Kill(id, "3", 330, "SELF");

        // Manche 2 : champion différent, A gagne à nouveau → série terminée 2:0.
        var r2 = state.Rounds[1];
        Assert.NotEqual(state.Rounds[0].Assignments[0].ChampionId, r2.Assignments[0].ChampionId);
        await b.Hub.InvokeAsync("ReportGameStarted", id, 4243L, (int?)null, (int[]?)null);
        await a.Hub.InvokeAsync("ReportObservation", id, new ObservationReport("TURRET", "40", 500, new ObservationPayload("SELF", null, null)));
        await b.Hub.InvokeAsync("ReportObservation", id, new ObservationReport("TURRET", "40", 500, new ObservationPayload("OPPONENT", null, null)));
        await Eventually(() => a.Received("SeriesFinished"));
        state = await a.State(id);
        Assert.Equal("FINISHED", state.Status);
        Assert.Equal("A", state.WinnerSlot);
        Assert.Equal(2, state.Players[0].RoundsWon);
        Assert.Equal(2, state.Rounds.Count);

        var history = await b.Http.GetFromJsonAsync<List<SeriesSummaryDto>>("/api/v1/series?status=FINISHED", ApiJson.Options);
        Assert.Single(history!);
        Assert.Equal(0, history![0].MyWins);
    }

    [Fact]
    public async Task Deck_mode_with_bans_blind_picks_spells_and_voided_round()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, Config(1, "DECK", "DECK_COMPOSED", new { condition = "FIRST_BLOOD" }));

        await a.PutPool(id, Enumerable.Range(1, 10).ToArray());
        await b.PutPool(id, Enumerable.Range(11, 10).ToArray());

        // Deck trop petit refusé (BO1 → 4 minimum).
        var small = await a.Http.PutAsJsonAsync($"/api/v1/series/{id}/deck", new { championIds = new[] { 1, 2, 3 } });
        Assert.Equal(HttpStatusCode.BadRequest, small.StatusCode);
        (await a.Http.PutAsJsonAsync($"/api/v1/series/{id}/deck", new { championIds = new[] { 1, 2, 3, 4, 5 } })).EnsureSuccessStatusCode();
        Assert.Null((await b.State(id)).Opponent.Deck);
        (await b.Http.PutAsJsonAsync($"/api/v1/series/{id}/deck", new { championIds = new[] { 11, 12, 13, 14 } })).EnsureSuccessStatusCode();

        // Budget BO1 : 2 jetons, 1 max par sort.
        var bad = await a.Http.PutAsJsonAsync($"/api/v1/series/{id}/spell-budget", new { tokens = new Dictionary<int, int> { [4] = 2 } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        (await a.Http.PutAsJsonAsync($"/api/v1/series/{id}/spell-budget", new { tokens = new Dictionary<int, int> { [4] = 1, [14] = 1 } })).EnsureSuccessStatusCode();
        (await b.Http.PutAsJsonAsync($"/api/v1/series/{id}/spell-budget", new { tokens = new Dictionary<int, int> { [4] = 1, [7] = 1 } })).EnsureSuccessStatusCode();

        var state = await a.State(id);
        Assert.Equal("BANS", state.Status);
        Assert.Equal(4, state.Opponent.Deck!.Count);

        await a.Hub.InvokeAsync("SubmitBans", id, new[] { 11, 12, 13 });
        Assert.Null((await b.State(id)).Opponent.BansOnMe); // bans masqués avant révélation
        await Assert.ThrowsAsync<HubException>(() => b.Hub.InvokeAsync("SubmitBans", id, new[] { 1, 2, 99 }));
        await b.Hub.InvokeAsync("SubmitBans", id, new[] { 1, 2, 3 });
        await Eventually(() => a.Received("BansRevealed"));

        state = await b.State(id);
        Assert.Equal("IN_PROGRESS", state.Status);
        Assert.Equal(new[] { 11, 12, 13 }, state.Opponent.BansOnMe!.Order().ToArray());

        // Pick aveugle : banni refusé, puis choix masqué jusqu'à révélation.
        await Assert.ThrowsAsync<HubException>(() => b.Hub.InvokeAsync("SubmitPick", id, 11, new[] { 4, 7 }));
        await b.Hub.InvokeAsync("SubmitPick", id, 14, new[] { 4, 7 });
        var hidden = (await a.State(id)).Rounds[0].Assignments.Single(x => x.Slot == "B");
        Assert.True(hidden.Submitted);
        Assert.Null(hidden.ChampionId);
        await a.Hub.InvokeAsync("SubmitPick", id, 5, new[] { 4, 14 });
        await Eventually(() => b.Received("PicksRevealed"));

        // Mauvais champion verrouillé → manche annulée et rejouée avec les mêmes attributions.
        await b.Hub.InvokeAsync("ReportChampSelect", id, 12, false, new[] { 4, 7 });
        await Eventually(() => b.Received("PickWarning"));
        await b.Hub.InvokeAsync("ReportChampSelect", id, 12, true, new[] { 4, 7 });
        await Eventually(() => a.Received("RoundVoided"));
        state = await a.State(id);
        Assert.Equal(2, state.Rounds.Count);
        Assert.Equal("VOIDED", state.Rounds[0].Status);
        Assert.Equal(2, state.Rounds[1].Attempt);
        Assert.Equal("LOBBY", state.Rounds[1].Status);
        Assert.Equal(14, state.Rounds[1].Assignments.Single(x => x.Slot == "B").ChampionId);
        Assert.All(state.Me.SpellTokens, t => Assert.Equal(t.Initial, t.Left)); // rien consommé

        // Sorts non conformes au chargement → annulée.
        await a.Hub.InvokeAsync("ReportGameStarted", id, 1L, 5, new[] { 4, 7 });
        state = await a.State(id);
        Assert.Equal(3, state.Rounds.Count);

        // Tentative 3 : first blood de B, source unique validée après le délai.
        await b.Hub.InvokeAsync("ReportGameStarted", id, 2L, 14, new[] { 7, 4 });
        await b.Hub.InvokeAsync("ReportObservation", id, new ObservationReport("FIRST_BLOOD", "1", 95.5, new ObservationPayload("SELF", null, null)));
        Assert.Equal("IN_GAME", (await a.State(id)).Rounds[2].Status);
        factory.Clock.Advance(TimeSpan.FromSeconds(11));
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<SeriesService>().TickAsync(id);
        await Eventually(() => a.Received("SeriesFinished"));
        state = await b.State(id);
        Assert.Equal("B", state.WinnerSlot);
        Assert.True(state.Rounds[2].WinningCondition!.SingleSource);
        Assert.True(state.Me.Deck.Single(d => d.ChampionId == 14).Consumed);
        Assert.All(state.Me.SpellTokens, t => Assert.Equal(0, t.Left));
    }

    [Fact]
    public async Task Dispute_resolved_by_votes_and_mutual_void()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, Config(3, "RANDOM", "FREE", new { condition = "KILLS", threshold = 1 }));
        await a.PutPool(id, [1, 2, 3]);
        await b.PutPool(id, [1, 2, 3]);
        var r = (await a.State(id)).Rounds[0];
        Assert.NotEqual(r.Assignments[0].ChampionId, r.Assignments[1].ChampionId);

        // Annulation d'un commun accord.
        await a.Hub.InvokeAsync("RequestVoidRound", id, "déconnexion");
        Assert.Single((await a.State(id)).Rounds);
        await b.Hub.InvokeAsync("RequestVoidRound", id, "déconnexion");
        Assert.Equal("VOIDED", (await a.State(id)).Rounds[0].Status);

        // Litige : les deux clients attribuent le même kill différemment.
        await a.Hub.InvokeAsync("ReportGameStarted", id, 77L, (int?)null, (int[]?)null);
        await a.Kill(id, "1", 60, "SELF");
        await b.Kill(id, "1", 60, "SELF");
        await Eventually(() => a.Received("RoundDisputed"));
        await a.Hub.InvokeAsync("VoteDispute", id, "B");
        await b.Hub.InvokeAsync("VoteDispute", id, "B");
        var state = await a.State(id);
        Assert.Equal("VALIDATED", state.Rounds[1].Status);
        Assert.Equal("B", state.Rounds[1].WinnerSlot);
        Assert.Equal(1, state.Players[1].RoundsWon);
    }
}
