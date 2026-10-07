using Api.Domain;

namespace Api.Tests;

public class WinExpressionTests
{
    [Fact]
    public void Validate_accepts_spec_example()
    {
        var expr = WinExpression.Parse("""
        { "op": "OR", "children": [
            { "condition": "KILLS", "threshold": 2 },
            { "condition": "FIRST_TOWER" },
            { "op": "AND", "children": [ { "condition": "CS", "threshold": 50 }, { "condition": "FIRST_BLOOD" } ] } ] }
        """);
        WinExpression.Validate(expr);
        Assert.Equal("Kills ≥ 2 OU Première tour OU (CS ≥ 50 ET First blood)", WinExpression.Describe(expr));
    }

    [Theory]
    [InlineData("""{ "condition": "GOLD", "threshold": 1 }""")]
    [InlineData("""{ "condition": "KILLS" }""")]
    [InlineData("""{ "condition": "KILLS", "threshold": 0 }""")]
    [InlineData("""{ "condition": "FIRST_BLOOD", "threshold": 3 }""")]
    [InlineData("""{ "condition": "CS", "threshold": 125 }""")]
    [InlineData("""{ "op": "XOR", "children": [ { "condition": "FIRST_BLOOD" }, { "condition": "FIRST_TOWER" } ] }""")]
    [InlineData("""{ "op": "OR", "children": [ { "condition": "FIRST_BLOOD" } ] }""")]
    [InlineData("""{ "op": "OR", "children": [ { "condition": "FIRST_BLOOD" }, { "op": "AND", "children": [ { "condition": "FIRST_TOWER" }, { "op": "OR", "children": [ { "condition": "FIRST_BLOOD" }, { "condition": "FIRST_TOWER" } ] } ] } ] }""")]
    public void Validate_rejects_invalid(string json)
    {
        Assert.Throws<DomainException>(() => WinExpression.Validate(WinExpression.Parse(json)));
    }

    [Fact]
    public void Evaluate_or_takes_earliest_and_takes_latest()
    {
        var facts = new PlayerFacts();
        facts.KillTimes.AddRange([100, 200]);
        facts.CsSamples.Add((50, 150));
        facts.FirstBloodTime = 100;

        var or = WinNode.Or(WinNode.Leaf(Conditions.Kills, 2), WinNode.Leaf(Conditions.Cs, 50));
        Assert.Equal(150, WinExpression.Evaluate(or, facts)!.Time);

        var and = WinNode.And(WinNode.Leaf(Conditions.FirstBlood), WinNode.Leaf(Conditions.Kills, 2));
        Assert.Equal(200, WinExpression.Evaluate(and, facts)!.Time);

        Assert.Null(WinExpression.Evaluate(WinNode.Leaf(Conditions.Kills, 3), facts));
        Assert.Null(WinExpression.Evaluate(WinNode.Leaf(Conditions.FirstTower), facts));
    }
}

public class SeriesRulesTests
{
    [Theory]
    [InlineData(1, true)] [InlineData(4, false)] [InlineData(11, true)] [InlineData(13, false)] [InlineData(0, false)]
    public void BestOf_must_be_odd_1_to_11(int bo, bool ok)
    {
        if (ok) SeriesRules.ValidateBestOf(bo);
        else Assert.Throws<DomainException>(() => SeriesRules.ValidateBestOf(bo));
    }

    [Fact]
    public void Deck_needs_bo_plus_three()
    {
        var pool = Enumerable.Range(1, 20).ToHashSet();
        Assert.Throws<DomainException>(() => SeriesRules.ValidateDeck(5, Enumerable.Range(1, 7).ToArray(), pool));
        SeriesRules.ValidateDeck(5, Enumerable.Range(1, 8).ToArray(), pool);
        Assert.Throws<DomainException>(() => SeriesRules.ValidateDeck(5, Enumerable.Range(15, 8).ToArray(), pool));
    }

    [Fact]
    public void Spell_budget_total_and_cap()
    {
        int[] allowed = [1, 3, 4, 6, 7, 13, 14, 21, 32];
        Assert.Equal(4, SeriesRules.SpellCap(5));
        Assert.Equal(1, SeriesRules.SpellCap(1));
        SeriesRules.ValidateSpellBudget(5, new Dictionary<int, int> { [4] = 4, [14] = 3, [7] = 3 }, allowed);
        Assert.Throws<DomainException>(() => SeriesRules.ValidateSpellBudget(5, new Dictionary<int, int> { [4] = 5, [14] = 5 }, allowed));
        Assert.Throws<DomainException>(() => SeriesRules.ValidateSpellBudget(5, new Dictionary<int, int> { [4] = 4, [14] = 4 }, allowed));
        Assert.Throws<DomainException>(() => SeriesRules.ValidateSpellBudget(5, new Dictionary<int, int> { [4] = 4, [12] = 3, [7] = 3 }, allowed));
    }

    [Fact]
    public void Spell_tokens_playable()
    {
        Assert.True(SeriesRules.SpellTokensPlayable(new Dictionary<int, int> { [4] = 2, [14] = 2 }));
        Assert.False(SeriesRules.SpellTokensPlayable(new Dictionary<int, int> { [4] = 3, [14] = 1 }));
    }
}

public class DrawServiceTests
{
    [Fact]
    public void Mirror_draw_is_deterministic_and_in_intersection()
    {
        int[] a = [1, 2, 3, 4, 5];
        int[] b = [4, 5, 6];
        var c1 = DrawService.DrawMirror("seed", 1, a, b, []);
        Assert.Equal(c1, DrawService.DrawMirror("seed", 1, a, b, []));
        Assert.Contains(c1, new[] { 4, 5 });
        var c2 = DrawService.DrawMirror("seed", 2, a, b, [c1]);
        Assert.NotEqual(c1, c2);
        Assert.Throws<DomainException>(() => DrawService.DrawMirror("seed", 3, a, b, [4, 5]));
    }

    [Fact]
    public void Random_draw_gives_distinct_champions()
    {
        for (var i = 0; i < 50; i++)
        {
            var (x, y) = DrawService.DrawRandom($"s{i}", 1, [1, 2], [1, 2], [], []);
            Assert.NotEqual(x, y);
        }
        var (p, q) = DrawService.DrawRandom("s", 1, [1, 2], [1], [], []);
        Assert.Equal((2, 1), (p, q));
    }

    [Fact]
    public void Spell_budget_draw_respects_rules()
    {
        int[] allowed = [1, 3, 4, 6, 7, 13, 14, 21, 32];
        foreach (var bo in SeriesRules.AllowedBestOf)
        {
            var budget = DrawService.DrawSpellBudget("x", "spells:A", bo, allowed);
            SeriesRules.ValidateSpellBudget(bo, budget, allowed);
            Assert.True(SeriesRules.SpellTokensPlayable(budget));
        }
    }
}

public class ArbitrationTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 7, 20, 0, 0, TimeSpan.Zero);
    private static readonly WinNode Expr = WinNode.Or(WinNode.Leaf(Conditions.Kills, 2), WinNode.Leaf(Conditions.FirstTower));

    private static ObservedEvent E(Slot reporter, ObservationType type, string id, double time, Slot subject, int? value = null, int receivedSec = 0) =>
        new(reporter, type, id, time, subject, value, T0.AddSeconds(receivedSec));

    [Fact]
    public void Kills_confirmed_by_both_clients_resolve_immediately()
    {
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.KILL, "3", 100, Slot.A), E(Slot.B, ObservationType.KILL, "3", 100, Slot.A),
            E(Slot.A, ObservationType.KILL, "7", 312.4, Slot.A), E(Slot.B, ObservationType.KILL, "7", 312.4, Slot.A),
        };
        var o = Arbitration.Evaluate(Expr, events, T0.AddSeconds(1));
        Assert.Equal(Slot.A, o.Winner);
        Assert.Equal(312.4, o.WinningSatisfaction!.Time);
        Assert.False(o.WinnerSingleSource);
    }

    [Fact]
    public void Same_kill_with_different_event_ids_counts_once()
    {
        // Partie réelle : le client de A a renuméroté ses événements après une reconnexion (n° 3 chez A, n° 20 chez B).
        var expr = WinNode.Leaf(Conditions.Kills, 2);
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.KILL, "3", 485.3, Slot.B), E(Slot.B, ObservationType.KILL, "20", 485.3, Slot.B),
        };
        var o = Arbitration.Evaluate(expr, events, T0.AddSeconds(30));
        Assert.Equal(1, o.Facts[Slot.B].Kills);
        Assert.False(o.Confirmed.Single().SingleSource);
        Assert.Null(o.Winner);
    }

    [Fact]
    public void Simultaneous_trade_is_not_a_contradiction()
    {
        var expr = WinNode.Leaf(Conditions.Kills, 3);
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.KILL, "1", 200, Slot.A), E(Slot.A, ObservationType.KILL, "2", 200, Slot.B),
            E(Slot.B, ObservationType.KILL, "1", 200, Slot.A), E(Slot.B, ObservationType.KILL, "2", 200, Slot.B),
        };
        var o = Arbitration.Evaluate(expr, events, T0);
        Assert.False(o.Disputed);
        Assert.Equal(1, o.Facts[Slot.A].Kills);
        Assert.Equal(1, o.Facts[Slot.B].Kills);
    }

    [Fact]
    public void Single_source_waits_for_delay()
    {
        var events = new List<ObservedEvent> { E(Slot.B, ObservationType.TURRET, "9", 400, Slot.B) };
        Assert.Null(Arbitration.Evaluate(Expr, events, T0.AddSeconds(5)).Winner);
        var o = Arbitration.Evaluate(Expr, events, T0.AddSeconds(11));
        Assert.Equal(Slot.B, o.Winner);
        Assert.True(o.WinnerSingleSource);
    }

    [Fact]
    public void Contradictory_attribution_is_disputed()
    {
        var events = new List<ObservedEvent> { E(Slot.A, ObservationType.KILL, "3", 100, Slot.A), E(Slot.B, ObservationType.KILL, "3", 100, Slot.B) };
        var o = Arbitration.Evaluate(Expr, events, T0);
        Assert.True(o.Disputed);
        Assert.Null(o.Winner);
    }

    [Fact]
    public void Earliest_event_time_wins_when_both_expressions_true()
    {
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.KILL, "1", 50, Slot.B), E(Slot.B, ObservationType.KILL, "1", 50, Slot.B),
            E(Slot.A, ObservationType.TURRET, "5", 300, Slot.A), E(Slot.B, ObservationType.TURRET, "5", 300, Slot.A),
            E(Slot.A, ObservationType.KILL, "6", 301, Slot.B), E(Slot.B, ObservationType.KILL, "6", 301, Slot.B),
        };
        var o = Arbitration.Evaluate(Expr, events, T0);
        Assert.Equal(Slot.A, o.Winner);
        Assert.Equal(Conditions.FirstTower, o.WinningSatisfaction!.Trigger.Condition);
    }

    [Fact]
    public void Pending_earlier_event_blocks_resolution()
    {
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.TURRET, "5", 300, Slot.A), E(Slot.B, ObservationType.TURRET, "5", 300, Slot.A),
            E(Slot.B, ObservationType.TURRET, "4", 290, Slot.B, receivedSec: 0),
        };
        Assert.Null(Arbitration.Evaluate(Expr, events, T0.AddSeconds(2)).Winner);
        Assert.Equal(Slot.B, Arbitration.Evaluate(Expr, events, T0.AddSeconds(12)).Winner);
    }

    [Fact]
    public void Cs_is_corroborated_by_opponent_view()
    {
        var expr = WinNode.Leaf(Conditions.Cs, 50);
        var self = E(Slot.A, ObservationType.CS, "cs-50", 600, Slot.A, 50);
        Assert.Null(Arbitration.Evaluate(expr, [self], T0.AddSeconds(1)).Winner);

        var view = E(Slot.B, ObservationType.CS, "cs-A-40", 598, Slot.A, 40);
        Assert.Equal(Slot.A, Arbitration.Evaluate(expr, [self, view], T0.AddSeconds(1)).Winner);

        var lowView = E(Slot.B, ObservationType.CS, "cs-A-20", 650, Slot.A, 20, receivedSec: 15);
        Assert.True(Arbitration.Evaluate(expr, [self, lowView], T0.AddSeconds(16)).Disputed);
    }

    [Fact]
    public void Exact_tie_goes_to_first_blood_holder()
    {
        var expr = WinNode.Leaf(Conditions.Kills, 1);
        var events = new List<ObservedEvent>
        {
            E(Slot.A, ObservationType.KILL, "1", 100, Slot.A), E(Slot.B, ObservationType.KILL, "1", 100, Slot.A),
            E(Slot.A, ObservationType.KILL, "2", 100, Slot.B), E(Slot.B, ObservationType.KILL, "2", 100, Slot.B),
            E(Slot.A, ObservationType.FIRST_BLOOD, "fb", 100, Slot.B), E(Slot.B, ObservationType.FIRST_BLOOD, "fb", 100, Slot.B),
        };
        Assert.Equal(Slot.B, Arbitration.Evaluate(expr, events, T0).Winner);
    }
}
