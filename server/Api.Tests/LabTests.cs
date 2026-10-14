using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Api.Domain;
using Api.Domain.Lab;
using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests;

public class SecretObjectivesTests
{
    private static IEnumerable<WinNode> Leaves(WinNode n) => n.IsLeaf ? [n] : n.Children!.SelectMany(Leaves);

    [Fact]
    public void Pool_respects_fairness_rules()
    {
        foreach (var tier in Enum.GetValues<ObjectiveTier>())
            Assert.True(SecretObjectives.Pool.Count(o => o.Tier == tier) >= 3);
        Assert.Equal(SecretObjectives.Pool.Count, SecretObjectives.Pool.Select(o => o.Id).Distinct().Count());
        // Aucune condition « première X » : elle deviendrait impossible dès que l'adversaire la prend.
        var conditions = SecretObjectives.Pool.SelectMany(o => Leaves(o.Expression)).Select(l => l.Condition).ToHashSet();
        Assert.DoesNotContain(Conditions.FirstBlood, conditions);
        Assert.DoesNotContain(Conditions.FirstTower, conditions);
        // Le temps limite laisse de la marge à tous les objectifs du palier.
        Assert.All(SecretObjectives.Pool, o => Assert.True(o.EstimatedMinutes * 60 * 1.4 <= SecretObjectives.TimeLimitSeconds(o.Tier)));
    }

    [Fact]
    public void Draw_is_deterministic_and_keeps_both_players_in_the_same_tier()
    {
        var first = SecretObjectives.Draw("seed", 2, 1, null);
        var again = SecretObjectives.Draw("seed", 2, 1, null);
        Assert.Equal((first.Tier, first.A, first.B), (again.Tier, again.A, again.B));
        for (var round = 1; round <= 30; round++)
        {
            var d = SecretObjectives.Draw("seed", round, 1, ObjectiveTier.LONG);
            Assert.Equal(ObjectiveTier.LONG, d.Tier);
            Assert.Equal(ObjectiveTier.LONG, SecretObjectives.Get(d.A).Tier);
            Assert.Equal(ObjectiveTier.LONG, SecretObjectives.Get(d.B).Tier);
        }
    }

    [Fact]
    public void Progress_counts_until_time_limit()
    {
        var facts = new PlayerFacts();
        facts.KillTimes.AddRange([100, 500]);
        facts.CsSamples.Add((40, 200));
        facts.CsSamples.Add((80, 600));
        facts.TowerTimes.Add(300);

        Assert.Equal(0.5, SecretObjectives.Progress(WinNode.Leaf(Conditions.Kills, 2), facts, 400));
        Assert.Equal(1, SecretObjectives.Progress(WinNode.Leaf(Conditions.Kills, 2), facts));
        Assert.Equal(0.4, SecretObjectives.Progress(WinNode.Leaf(Conditions.Cs, 100), facts, 400), 3);
        // ET = moyenne, OU = maximum.
        Assert.Equal(0.7, SecretObjectives.Progress(WinNode.And(WinNode.Leaf(Conditions.Towers, 1), WinNode.Leaf(Conditions.Cs, 100)), facts, 400), 3);
        Assert.Equal(1, SecretObjectives.Progress(WinNode.Or(WinNode.Leaf(Conditions.Towers, 1), WinNode.Leaf(Conditions.Cs, 100)), facts, 400));
    }

    [Fact]
    public void Towers_condition_counts_every_destroyed_tower()
    {
        var t0 = new DateTimeOffset(2026, 10, 7, 20, 0, 0, TimeSpan.Zero);
        ObservedEvent Tower(Slot reporter, string id, double time) => new(reporter, ObservationType.TURRET, id, time, Slot.A, null, t0);
        var events = new List<ObservedEvent> { Tower(Slot.A, "1", 300), Tower(Slot.B, "1", 300), Tower(Slot.A, "2", 450), Tower(Slot.B, "2", 450) };
        var o = Arbitration.Evaluate(s => s == Slot.A ? WinNode.Leaf(Conditions.Towers, 2) : WinNode.Leaf(Conditions.Kills, 1), events, t0);
        Assert.Equal(Slot.A, o.Winner);
        Assert.Equal(450, o.WinningSatisfaction!.Time);
    }

    [Fact]
    public void Lab_config_replaces_win_expression()
    {
        new SeriesConfig { BestOf = 3, ChampionMode = ChampionMode.MIRROR, SpellMode = SpellMode.FREE, Lab = new LabConfig { Tier = ObjectiveTier.SHORT } }.Validate();
        Assert.Throws<DomainException>(() => new SeriesConfig { BestOf = 3, ChampionMode = ChampionMode.MIRROR, SpellMode = SpellMode.FREE }.Validate());
    }
}

public class LabFlowTests
{
    private static object LabConfig(int bo, string? tier) =>
        new { bestOf = bo, championMode = "MIRROR", spellMode = "FREE", lab = new { mode = "SECRET_OBJECTIVES", tier } };

    private static async Task<Guid> StartSeries(TestPlayer a, TestPlayer b, object config)
    {
        var inv = await (await a.Http.PostAsJsonAsync("/api/v1/invitations", new { toRiotId = b.RiotId, config }))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
        Assert.StartsWith("BO", inv!["configLabel"]!.GetValue<string>());
        Assert.Contains("Objectifs secrets", inv["configLabel"]!.GetValue<string>());
        await Eventually(() => b.Received("InvitationReceived"));
        var accepted = await (await b.Http.PostAsync($"/api/v1/invitations/{inv["id"]}/accept", null))
            .EnsureSuccessStatusCode().Content.ReadFromJsonAsync<JsonObject>();
        var id = Guid.Parse(accepted!["seriesId"]!.GetValue<string>());
        await a.PutPool(id, [1, 2, 3, 4, 5]);
        await b.PutPool(id, [1, 2, 3, 4, 5]);
        return id;
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition());
    }

    private static Task Observe(TestPlayer p, Guid id, string type, string eventId, double time, string? subject, int? value = null) =>
        p.Hub.InvokeAsync("ReportObservation", id, new ObservationReport(type, eventId, time, new ObservationPayload(subject, value, null)));

    [Fact]
    public async Task Secret_objectives_are_hidden_then_revealed_and_resolve_the_round()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, LabConfig(3, "LONG"));

        var state = await a.State(id);
        Assert.Null(state.WinExpression);
        Assert.NotNull(state.Lab);
        Assert.Equal("LONG", state.Lab!.Current!.Tier);
        Assert.Null(state.Lab.Current.Mine); // révélé seulement au chargement de la partie

        await a.Hub.InvokeAsync("ReportGameStarted", id, 1L, state.Rounds[0].Assignments[0].ChampionId, (int[]?)null);
        await Eventually(() => a.Received("SecretObjectiveRevealed") && b.Received("SecretObjectiveRevealed"));
        var mine = (await a.State(id)).Lab!.Current!.Mine!;
        Assert.Equal("LONG", mine.Tier);
        Assert.Empty((await a.State(id)).Lab!.History); // objectif adverse jamais exposé pendant la manche

        // A remplit n'importe quel objectif long : 3 kills, 2 tours, 150 CS, vus par les deux clients.
        foreach (var (eid, t) in new[] { ("1", 100.0), ("2", 150.0), ("3", 200.0) })
        {
            await Observe(a, id, "KILL", eid, t, "SELF");
            await Observe(b, id, "KILL", eid, t, "OPPONENT");
        }
        await Observe(a, id, "TURRET", "10", 250, "SELF");
        await Observe(b, id, "TURRET", "10", 250, "OPPONENT");
        await Observe(a, id, "CS", "self-150", 260, "SELF", 150);
        await Observe(b, id, "CS", "view-150", 260, "OPPONENT", 150);
        await Observe(a, id, "TURRET", "11", 300, "SELF");
        await Observe(b, id, "TURRET", "11", 300, "OPPONENT");

        await Eventually(() => b.Received("RoundResolved"));
        state = await b.State(id);
        Assert.Equal("VALIDATED", state.Rounds[0].Status);
        Assert.Equal("A", state.Rounds[0].WinnerSlot);
        Assert.StartsWith("Objectif secret · ", state.Rounds[0].WinningCondition!.Label);
        var reveal = Assert.Single(state.Lab!.History);
        Assert.Equal(mine.Id, reveal.Opponent.Id); // B découvre l'objectif de A à la fin de la manche
        Assert.Null(state.Lab.Current!.Mine); // manche suivante : objectif pas encore révélé
    }

    [Fact]
    public async Task Time_limit_gives_the_round_to_the_best_progress()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, LabConfig(1, "SHORT"));
        var state = await a.State(id);
        await a.Hub.InvokeAsync("ReportGameStarted", id, 1L, state.Rounds[0].Assignments[0].ChampionId, (int[]?)null);
        var mine = (await a.State(id)).Lab!.Current!.Mine!;

        // A : 20 CS, B : rien. Les deux horloges passent le temps limite (8 min).
        await Observe(a, id, "CS", "self-20", 200, "SELF", 20);
        await Observe(b, id, "CS", "view-20", 200, "OPPONENT", 20);
        await Observe(a, id, "CLOCK", "t-16", 490, null);
        Assert.Equal("IN_GAME", (await a.State(id)).Rounds[0].Status); // une seule horloge ne suffit pas à conclure
        await Observe(b, id, "CLOCK", "t-16", 485, null);
        await Eventually(() => a.Received("RoundResolved") || a.Received("RoundVoided"));

        state = await a.State(id);
        if (mine.Id == "s-kills1")
        {
            // 0 % partout : égalité, manche rejouée.
            Assert.Equal("VOIDED", state.Rounds[0].Status);
            Assert.StartsWith("Égalité au temps limite", state.Rounds[0].VoidReason);
        }
        else
        {
            Assert.Equal("VALIDATED", state.Rounds[0].Status);
            Assert.Equal("A", state.Rounds[0].WinnerSlot);
            Assert.StartsWith("Temps limite · ", state.Rounds[0].WinningCondition!.Label);
            Assert.Equal("FINISHED", state.Status);
        }
    }

    [Fact]
    public async Task Single_clock_counts_after_delay_when_opponent_is_silent()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        await using var b = await TestPlayer.CreateAsync(factory, "Vorn");
        var id = await StartSeries(a, b, LabConfig(3, "SHORT"));
        var state = await a.State(id);
        await a.Hub.InvokeAsync("ReportGameStarted", id, 1L, state.Rounds[0].Assignments[0].ChampionId, (int[]?)null);
        await Observe(a, id, "CLOCK", "t-16", 490, null);
        Assert.Equal("IN_GAME", (await a.State(id)).Rounds[0].Status);

        factory.Clock.Advance(TimeSpan.FromSeconds(46));
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<SeriesService>().TickAsync(id);
        Assert.NotEqual("IN_GAME", (await a.State(id)).Rounds[0].Status);
    }

    [Fact]
    public async Task Catalog_and_trial_draw_are_exposed()
    {
        await using var factory = new ApiFactory();
        await using var a = await TestPlayer.CreateAsync(factory, "Kaelis");
        var catalog = await a.Http.GetFromJsonAsync<List<LabTierDto>>("/api/v1/lab/secret-objectives", ApiJson.Options);
        Assert.Equal(["SHORT", "MEDIUM", "LONG"], catalog!.Select(t => t.Tier));
        var draw = await a.Http.GetFromJsonAsync<LabDrawDto>("/api/v1/lab/secret-objectives/draw?tier=MEDIUM", ApiJson.Options);
        Assert.Equal("MEDIUM", draw!.Tier);
        Assert.Equal("MEDIUM", draw.A.Tier);
    }
}
