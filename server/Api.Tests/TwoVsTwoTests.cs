using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Api.Domain;
using Api.Dtos;
using Microsoft.AspNetCore.SignalR.Client;

namespace Api.Tests;

public class TwoVsTwoTests
{
    private static readonly object TeamKills = new { condition = "KILLS", threshold = 2 };

    private static object Config(string champ, object expr, int bo = 1) =>
        new { bestOf = bo, teamSize = 2, championMode = champ, spellMode = "FREE", winExpression = expr };

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition());
    }

    private static async Task<JsonObject> Invite(TestPlayer creator, TestPlayer g1, TestPlayer g2, TestPlayer g3, object config)
    {
        var res = await creator.Http.PostAsJsonAsync("/api/v1/invitations",
            new { config, playerRiotIds = new[] { g1.RiotId, g2.RiotId, g3.RiotId } });
        return (await res.EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>())!;
    }

    /// <summary>Invitation reçue par ce joueur (une par invité dans un défi 2v2).</summary>
    private static async Task<string> MyInvitation(TestPlayer p)
    {
        var list = await p.Http.GetFromJsonAsync<List<InvitationDto>>("/api/v1/invitations", ApiJson.Options);
        return list!.Single(i => i.To.RiotId == p.RiotId).Id.ToString();
    }

    /// <summary>Démarre la série ; renvoie les joueurs rangés par équipe tirée au sort : A0 (créateur), A1, B0, B1.</summary>
    private static async Task<(Guid Id, TestPlayer[] Seats)> StartSeries(TestPlayer creator, TestPlayer g1, TestPlayer g2, TestPlayer g3, object config)
    {
        await Invite(creator, g1, g2, g3, config);
        string? seriesId = null;
        foreach (var p in new[] { g1, g2, g3 })
        {
            var accepted = await (await p.Http.PostAsync($"/api/v1/invitations/{await MyInvitation(p)}/accept", null))
                .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
            seriesId = accepted!["seriesId"]?.GetValue<string>();
        }
        var id = Guid.Parse(seriesId!);
        var all = new[] { creator, g1, g2, g3 };
        var seats = (await creator.State(id)).Players.OrderBy(p => p.Slot).ThenBy(p => p.Seat)
            .Select(p => all.Single(t => t.RiotId == p.RiotId)).ToArray();
        return (id, seats);
    }

    [Fact]
    public async Task Group_invitation_starts_the_series_only_when_all_three_accept()
    {
        await using var factory = new ApiFactory();
        await using var a1 = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var a2 = await TestPlayer.CreateAsync(factory, "Mira");
        await using var b1 = await TestPlayer.CreateAsync(factory, "Vorn");
        await using var b2 = await TestPlayer.CreateAsync(factory, "Thane");
        await Invite(a1, a2, b1, b2, Config("MIRROR", TeamKills));
        await Eventually(() => a2.Received("InvitationReceived") && b1.Received("InvitationReceived") && b2.Received("InvitationReceived"));

        var first = await (await a2.Http.PostAsync($"/api/v1/invitations/{await MyInvitation(a2)}/accept", null))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<InvitationDto>(ApiJson.Options);
        Assert.Null(first!.SeriesId);
        Assert.Equal(3, first.Group!.Count);
        // Toujours listée, en attente des autres.
        var mine = await a1.Http.GetFromJsonAsync<List<InvitationDto>>("/api/v1/invitations", ApiJson.Options);
        var single = Assert.Single(mine!);
        Assert.Equal(["ACCEPTED", "PENDING", "PENDING"], single.Group!.Select(m => m.Status));

        // Un refus annule le défi pour tout le monde.
        (await b1.Http.PostAsync($"/api/v1/invitations/{await MyInvitation(b1)}/decline", null)).EnsureSuccessStatusCode();
        Assert.Empty((await a1.Http.GetFromJsonAsync<List<InvitationDto>>("/api/v1/invitations", ApiJson.Options))!);
        Assert.Empty((await b2.Http.GetFromJsonAsync<List<InvitationDto>>("/api/v1/invitations", ApiJson.Options))!);
    }

    [Fact]
    public async Task Invalid_2v2_configurations_are_rejected()
    {
        await using var factory = new ApiFactory();
        await using var a1 = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var a2 = await TestPlayer.CreateAsync(factory, "Mira");
        await using var b1 = await TestPlayer.CreateAsync(factory, "Vorn");

        var deck = await a1.Http.PostAsJsonAsync("/api/v1/invitations",
            new { config = Config("DECK", TeamKills, 3), playerRiotIds = new[] { a2.RiotId, b1.RiotId, "Ghost#EUW" } });
        Assert.Equal(HttpStatusCode.BadRequest, deck.StatusCode);

        var twice = await a1.Http.PostAsJsonAsync("/api/v1/invitations",
            new { config = Config("MIRROR", TeamKills), playerRiotIds = new[] { a2.RiotId, b1.RiotId, a2.RiotId } });
        Assert.Equal(HttpStatusCode.BadRequest, twice.StatusCode);

        var missing = await a1.Http.PostAsJsonAsync("/api/v1/invitations",
            new { config = Config("MIRROR", TeamKills), playerRiotIds = new[] { a2.RiotId, b1.RiotId } });
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
    }

    private static string Name(TestPlayer p) => p.RiotId.Split('#')[0];

    [Fact]
    public async Task Teams_are_drawn_at_random_with_the_creator_as_team_A_captain()
    {
        var mates = new HashSet<string>();
        for (var i = 0; i < 12 && mates.Count < 2; i++)
        {
            await using var factory = new ApiFactory();
            await using var p1 = await TestPlayer.CreateAsync(factory, "Kaelis");
            await using var p2 = await TestPlayer.CreateAsync(factory, "Mira");
            await using var p3 = await TestPlayer.CreateAsync(factory, "Vorn");
            await using var p4 = await TestPlayer.CreateAsync(factory, "Thane");
            var (_, seats) = await StartSeries(p1, p2, p3, p4, Config("MIRROR", TeamKills));
            Assert.Same(p1, seats[0]);
            Assert.Equal(4, seats.Distinct().Count());
            mates.Add(seats[1].RiotId);
        }
        // Sur 12 tirages, le coéquipier du créateur n'est pas toujours le même (probabilité d'échec : 3 × (1/3)^12).
        Assert.True(mates.Count >= 2);
    }

    [Fact]
    public async Task Mirror_2v2_team_kills_win_the_round()
    {
        await using var factory = new ApiFactory();
        await using var p1 = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var p2 = await TestPlayer.CreateAsync(factory, "Mira");
        await using var p3 = await TestPlayer.CreateAsync(factory, "Vorn");
        await using var p4 = await TestPlayer.CreateAsync(factory, "Thane");
        var (id, seats) = await StartSeries(p1, p2, p3, p4, Config("MIRROR", TeamKills));
        var (a1, a2, b1, b2) = (seats[0], seats[1], seats[2], seats[3]);

        await p1.PutPool(id, [1, 2, 3, 4, 5]);
        await p2.PutPool(id, [2, 3, 4, 5]);
        await p3.PutPool(id, [3, 4, 5, 9]);
        Assert.Equal("SETUP", (await p1.State(id)).Status);
        await p4.PutPool(id, [3, 4, 8]);

        var state = await b2.State(id);
        Assert.Equal("IN_PROGRESS", state.Status);
        Assert.Equal(2, state.TeamSize);
        Assert.Equal("B", state.MySlot);
        Assert.Equal(4, state.Players.Count);
        var r1 = state.Rounds.Single();
        Assert.Equal("LOBBY", r1.Status);
        // Mêmes places, même champion ; coéquipiers, champions différents (3 et 4, seuls communs aux quatre).
        var seat0 = r1.Assignments.Where(x => x.Seat == 0).Select(x => x.ChampionId).Distinct().Single();
        var seat1 = r1.Assignments.Where(x => x.Seat == 1).Select(x => x.ChampionId).Distinct().Single();
        Assert.Equal([3, 4], new[] { seat0!.Value, seat1!.Value }.Order());

        await Eventually(() => a1.Received("LaunchLobby"));
        Assert.False(a2.Received("LaunchLobby") || b1.Received("LaunchLobby"));
        var order = a1.Events.First(e => e.Name == "LaunchLobby").Payload!.Value;
        Assert.Equal(3, order.GetProperty("guests").GetArrayLength());

        foreach (var p in seats)
            await p.Hub.InvokeAsync("ReportGameStarted", id, 77L, (int?)null, (int[]?)null);

        // Un kill chacun pour l'équipe A : 2 kills d'équipe. Vus par un joueur de chaque équipe.
        await a1.Kill(id, "1", 100, "SELF");
        await b1.Kill(id, "1", 100, "OPPONENT");
        await a2.Kill(id, "2", 210.5, "SELF");
        await b2.Kill(id, "2", 210.5, "OPPONENT");
        await Eventually(() => b2.Received("SeriesFinished"));

        state = await a2.State(id);
        Assert.Equal("FINISHED", state.Status);
        Assert.Equal("A", state.WinnerSlot);
        Assert.Equal(210.5, state.Rounds[0].WinningCondition!.EventTime);
        Assert.All(state.Players.Where(p => p.Slot == "A"), p => Assert.Equal(1, p.RoundsWon));
        var finished = b1.Events.First(e => e.Name == "SeriesFinished").Payload!.Value;
        Assert.Equal($"{Name(a1)} & {Name(a2)}", finished.GetProperty("winnerName").GetString());

        var summary = (await b1.Http.GetFromJsonAsync<List<SeriesSummaryDto>>("/api/v1/series", ApiJson.Options))!.Single();
        Assert.Equal($"{Name(a1)} & {Name(a2)}", summary.OpponentName);
        Assert.Equal(Name(b2), summary.PartnerName);
        Assert.Equal(2, summary.TeamSize);
    }

    [Fact]
    public async Task Random_2v2_draws_four_different_champions_and_void_needs_the_other_team()
    {
        await using var factory = new ApiFactory();
        await using var p1 = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var p2 = await TestPlayer.CreateAsync(factory, "Mira");
        await using var p3 = await TestPlayer.CreateAsync(factory, "Vorn");
        await using var p4 = await TestPlayer.CreateAsync(factory, "Thane");
        var (id, seats) = await StartSeries(p1, p2, p3, p4, Config("RANDOM", TeamKills, 3));
        var (a1, a2, _, b2) = (seats[0], seats[1], seats[2], seats[3]);
        foreach (var p in seats) await p.PutPool(id, [1, 2, 3, 4, 5]);

        var state = await a1.State(id);
        var r1 = state.Rounds.Single();
        Assert.Equal(4, r1.Assignments.Select(x => x.ChampionId).Distinct().Count());

        // Le coéquipier ne suffit pas à annuler la manche.
        await a1.Hub.InvokeAsync("RequestVoidRound", id, (string?)null);
        await a2.Hub.InvokeAsync("RequestVoidRound", id, (string?)null);
        Assert.Single((await a1.State(id)).Rounds);
        await b2.Hub.InvokeAsync("RequestVoidRound", id, (string?)null);
        state = await a1.State(id);
        Assert.Equal("VOIDED", state.Rounds[0].Status);
        Assert.Equal(2, state.Rounds[1].Attempt);
    }
}

public class TwoVsTwoDomainTests
{
    [Fact]
    public void Team_size_rules()
    {
        SeriesRules.ValidateTeamSize(1, ChampionMode.DECK, lab: true);
        SeriesRules.ValidateTeamSize(2, ChampionMode.MIRROR, lab: false);
        SeriesRules.ValidateTeamSize(2, ChampionMode.RANDOM, lab: false);
        Assert.Throws<DomainException>(() => SeriesRules.ValidateTeamSize(3, ChampionMode.MIRROR, lab: false));
        Assert.Throws<DomainException>(() => SeriesRules.ValidateTeamSize(2, ChampionMode.MIRROR_DECK, lab: false));
        Assert.Throws<DomainException>(() => SeriesRules.ValidateTeamSize(2, ChampionMode.MIRROR, lab: true));
    }

    [Fact]
    public void Mirror_teams_draw_distinct_common_champions()
    {
        int[][] pools = [[1, 2, 3], [2, 3, 4], [1, 2, 3], [2, 3]];
        var seats = DrawService.DrawMirrorTeams("seed", 1, 2, pools, []);
        Assert.Equal([2, 3], seats.Order());
        // Un seul champion commun encore jouable : pas de quoi en donner un à chaque place.
        Assert.Throws<DomainException>(() => DrawService.DrawMirrorTeams("seed", 1, 2, pools, [3]));
    }

    [Fact]
    public void Team_cs_is_corroborated_with_a_wider_tolerance()
    {
        var t0 = DateTimeOffset.UtcNow;
        ObservedEvent Cs(Slot reporter, Slot subject, int value) => new(reporter, ObservationType.CS, $"{reporter}-{subject}-{value}", 600, subject, value, t0);
        // Équipe A déclare 100 CS cumulés, l'équipe B en voit 85 (retard des CS des alliés).
        var events = new[] { Cs(Slot.A, Slot.A, 100), Cs(Slot.B, Slot.A, 85) };
        var expr = WinNode.Leaf(Conditions.Cs, 100);
        Assert.Null(Arbitration.Evaluate(expr, events, t0).Winner);
        Assert.Equal(Slot.A, Arbitration.Evaluate(expr, events, t0, Arbitration.CsTolerance * 2).Winner);
    }
}
