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

    /** Écart maximal d'horodatage entre deux remontées du même événement. */
    public const double SameEventTolerance = 0.3;

    /// <summary>Regroupe les remontées d'un même type dont l'horodatage de jeu coïncide (à la tolérance près).</summary>
    private static IEnumerable<List<ObservedEvent>> SharedEventClusters(IReadOnlyList<ObservedEvent> events)
    {
        foreach (var byType in events.Where(e => e.Type is ObservationType.KILL or ObservationType.FIRST_BLOOD or ObservationType.TURRET)
                                     .GroupBy(e => e.Type))
        {
            List<ObservedEvent>? current = null;
            foreach (var e in byType.OrderBy(e => e.EventTime))
            {
                if (current is null || e.EventTime - current[^1].EventTime > SameEventTolerance)
                {
                    if (current is not null) yield return current;
                    current = [];
                }
                current.Add(e);
            }
            if (current is not null) yield return current;
        }
    }

    public static ArbitrationOutcome Evaluate(WinNode expression, IReadOnlyList<ObservedEvent> events, DateTimeOffset now)
    {
        var outcome = new ArbitrationOutcome();
        var singleSourceTimes = new HashSet<double>();

        void Pending(double t) => outcome.EarliestPendingTime = Math.Min(outcome.EarliestPendingTime ?? double.MaxValue, t);

        // 1. Événements partagés (kills, first blood, tours) : rapprochés par type et horodatage de jeu.
        //    L'EventID n'est pas fiable entre les deux PC (le client LoL renumérote après une reconnexion).
        foreach (var cluster in SharedEventClusters(events))
        {
            var eventTime = cluster.Min(e => e.EventTime);
            var key = $"{cluster[0].Type}@{eventTime:0.0}";
            var bySubject = cluster.GroupBy(e => e.Reporter).ToDictionary(g => g.Key, g => g.Select(e => e.Subject).ToHashSet());
            // (un même client qui renvoie le même instant sous un autre identifiant ne compte qu'une fois : HashSet)
            // Les deux clients ont vu l'instant mais ne l'attribuent pas pareil (un échange simultané est vu identique des deux côtés).
            if (bySubject.Count == 2 && !bySubject[Slot.A].SetEquals(bySubject[Slot.B]))
            {
                outcome.Contradictions.Add($"{cluster[0].Type} à {eventTime:0.0} s : attribution contradictoire.");
                continue;
            }
            foreach (var subject in bySubject.Values.SelectMany(s => s).Distinct())
            {
                var reports = cluster.Where(e => e.Subject == subject).ToList();
                bool single;
                if (reports.Select(e => e.Reporter).Distinct().Count() >= 2) single = false;
                else if (now - reports.Min(e => e.ReceivedAt) >= ConfirmationDelay) single = true;
                else { Pending(eventTime); continue; }
                outcome.Confirmed.Add(new ConfirmedEvent(cluster[0].Type, $"{key}:{subject}", eventTime, subject, null, single));
            }
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
