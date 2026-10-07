namespace Api.Domain;

/// <summary>Observation normalisée : le bénéficiaire (Subject) est exprimé en slot absolu.</summary>
public sealed record ObservedEvent(
    Slot Reporter,
    ObservationType Type,
    string EventId,
    double EventTime,
    Slot Subject,
    int? Value,
    DateTimeOffset ReceivedAt);

public sealed record ConfirmedEvent(ObservationType Type, string EventId, double EventTime, Slot Subject, int? Value, bool SingleSource);

public sealed class ArbitrationOutcome
{
    public Dictionary<Slot, PlayerFacts> Facts { get; } = new() { [Slot.A] = new(), [Slot.B] = new() };
    public Dictionary<Slot, Satisfaction?> Satisfactions { get; } = new();
    public List<ConfirmedEvent> Confirmed { get; } = [];
    public List<string> Contradictions { get; } = [];
    public double? EarliestPendingTime { get; set; }
    public Slot? Winner { get; set; }
    public Satisfaction? WinningSatisfaction { get; set; }
    public bool WinnerSingleSource { get; set; }
    public bool Disputed => Contradictions.Count > 0;
}

/// <summary>
/// Arbitrage pur (sans base) : croise les observations des deux clients, en déduit les faits
/// confirmés par joueur, évalue l'expression de victoire et départage par EventTime.
/// </summary>
public static class Arbitration
{
    public static readonly TimeSpan ConfirmationDelay = TimeSpan.FromSeconds(10);
    public const int CsTolerance = 10;

    public static ArbitrationOutcome Evaluate(WinNode expression, IReadOnlyList<ObservedEvent> events, DateTimeOffset now)
    {
        var outcome = new ArbitrationOutcome();
        var singleSourceTimes = new HashSet<double>();

        void Pending(double t) => outcome.EarliestPendingTime = Math.Min(outcome.EarliestPendingTime ?? double.MaxValue, t);

        // 1. Événements partagés (kills, first blood, tours) : même EventID vu par les deux clients.
        foreach (var group in events.Where(e => e.Type is ObservationType.KILL or ObservationType.FIRST_BLOOD or ObservationType.TURRET)
                                    .GroupBy(e => (e.Type, e.EventId)))
        {
            var subjects = group.Select(e => e.Subject).Distinct().ToList();
            var first = group.OrderBy(e => e.ReceivedAt).First();
            if (subjects.Count > 1)
            {
                outcome.Contradictions.Add($"{group.Key.Type} #{group.Key.EventId} : attribution contradictoire.");
                continue;
            }
            var reporters = group.Select(e => e.Reporter).Distinct().Count();
            var eventTime = group.Min(e => e.EventTime);
            bool single;
            if (reporters >= 2) single = false;
            else if (now - first.ReceivedAt >= ConfirmationDelay) single = true;
            else { Pending(eventTime); continue; }
            outcome.Confirmed.Add(new ConfirmedEvent(group.Key.Type, group.Key.EventId, eventTime, subjects[0], null, single));
        }

        // 2. CS : auto-déclaré par le joueur, corroboré par la vue de l'adversaire (± tolérance).
        foreach (var self in events.Where(e => e.Type == ObservationType.CS && e.Reporter == e.Subject && e.Value is not null))
        {
            var views = events.Where(e => e.Type == ObservationType.CS && e.Reporter != e.Subject && e.Subject == self.Subject && e.Value is not null).ToList();
            var corroborated = views.Any(v => v.Value >= self.Value - CsTolerance);
            if (corroborated)
                outcome.Confirmed.Add(new ConfirmedEvent(ObservationType.CS, self.EventId, self.EventTime, self.Subject, self.Value, false));
            else if (now - self.ReceivedAt < ConfirmationDelay)
                Pending(self.EventTime);
            else if (views.Count == 0)
                outcome.Confirmed.Add(new ConfirmedEvent(ObservationType.CS, self.EventId, self.EventTime, self.Subject, self.Value, true));
            else if (views.Any(v => v.ReceivedAt > self.ReceivedAt + ConfirmationDelay))
                outcome.Contradictions.Add($"CS de {self.Subject} : {self.Value} déclaré, incohérent avec la vue adverse.");
            else
                Pending(self.EventTime);
        }

        // 3. Faits par joueur.
        foreach (var e in outcome.Confirmed.OrderBy(e => e.EventTime))
        {
            var facts = outcome.Facts[e.Subject];
            if (e.SingleSource) singleSourceTimes.Add(e.EventTime);
            switch (e.Type)
            {
                case ObservationType.KILL: facts.KillTimes.Add(e.EventTime); break;
                case ObservationType.FIRST_BLOOD: facts.FirstBloodTime ??= e.EventTime; break;
                case ObservationType.CS: facts.CsSamples.Add((e.Value!.Value, e.EventTime)); break;
            }
        }
        var firstTower = outcome.Confirmed.Where(e => e.Type == ObservationType.TURRET).OrderBy(e => e.EventTime).FirstOrDefault();
        if (firstTower is not null) outcome.Facts[firstTower.Subject].FirstTowerTime = firstTower.EventTime;
        // Le first blood implique un kill : si l'événement ChampionKill manque, on le déduit.
        foreach (var slot in new[] { Slot.A, Slot.B })
        {
            var f = outcome.Facts[slot];
            if (f.FirstBloodTime is { } fb && f.KillTimes.Count == 0) f.KillTimes.Add(fb);
        }

        if (outcome.Disputed) return outcome;

        // 4. Évaluation et départage.
        foreach (var slot in new[] { Slot.A, Slot.B })
            outcome.Satisfactions[slot] = WinExpression.Evaluate(expression, outcome.Facts[slot]);

        var candidates = outcome.Satisfactions.Where(kv => kv.Value is not null).OrderBy(kv => kv.Value!.Time).ToList();
        if (candidates.Count == 0) return outcome;

        var best = candidates[0];
        // Un événement non encore confirmé, antérieur ou simultané, pourrait changer le vainqueur : on attend.
        if (outcome.EarliestPendingTime is { } pending && pending <= best.Value!.Time) return outcome;

        if (candidates.Count == 2 && Math.Abs(candidates[1].Value!.Time - best.Value!.Time) < 0.001)
        {
            // Égalité parfaite : le détenteur du first blood l'emporte.
            var fbHolder = new[] { Slot.A, Slot.B }.FirstOrDefault(s => outcome.Facts[s].FirstBloodTime is not null, (Slot)(-1));
            if ((int)fbHolder < 0) { outcome.Contradictions.Add("Égalité parfaite sans first blood."); return outcome; }
            best = candidates.First(c => c.Key == fbHolder);
        }

        outcome.Winner = best.Key;
        outcome.WinningSatisfaction = best.Value;
        outcome.WinnerSingleSource = singleSourceTimes.Contains(best.Value!.Time);
        return outcome;
    }
}
