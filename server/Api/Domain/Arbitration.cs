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

public sealed record ConfirmedEvent(ObservationType Type, string EventId, double EventTime, Slot Subject, int? Value);

public sealed class ArbitrationOutcome
{
    public Dictionary<Slot, PlayerFacts> Facts { get; } = new() { [Slot.A] = new(), [Slot.B] = new() };
    public Dictionary<Slot, Satisfaction?> Satisfactions { get; } = new();
    public List<ConfirmedEvent> Confirmed { get; } = [];
    public List<string> Contradictions { get; } = [];
    public double? EarliestPendingTime { get; set; }
    public Slot? Winner { get; set; }
    public Satisfaction? WinningSatisfaction { get; set; }
    public bool Disputed => Contradictions.Count > 0;
}

/// <summary>
/// Arbitrage pur (sans base) : croise les observations des deux clients, en déduit les faits
/// confirmés par joueur, évalue l'expression de victoire et départage par EventTime.
/// Un client contrôle entièrement ce qu'il remonte : un événement ne compte que s'il est vu par les deux équipes.
/// Sans confirmation adverse dans le délai, ou démenti (DENIAL) après vérification, la manche passe en litige.
/// </summary>
public static class Arbitration
{
    /** Délai laissé à l'équipe adverse pour confirmer un événement (remontée propre ou réponse à VerifyEvent). */
    public static readonly TimeSpan ConfirmationDelay = TimeSpan.FromSeconds(20);
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

    public static ArbitrationOutcome Evaluate(WinNode expression, IReadOnlyList<ObservedEvent> events, DateTimeOffset now, int csTolerance = CsTolerance) =>
        Evaluate(_ => expression, events, now, csTolerance);

    /// <summary>
    /// Variante à expression propre à chaque joueur (mode labo « objectifs secrets »).
    /// Les slots sont des équipes : en 2v2, chaque client remonte les faits de son équipe (SELF) et de l'équipe adverse
    /// (OPPONENT), CS cumulés ; <paramref name="csTolerance"/> s'élargit avec le nombre de joueurs dont les CS sont sommés.
    /// </summary>
    public static ArbitrationOutcome Evaluate(Func<Slot, WinNode> expressionOf, IReadOnlyList<ObservedEvent> events, DateTimeOffset now, int csTolerance = CsTolerance)
    {
        var outcome = new ArbitrationOutcome();
        var denials = events.Where(e => e.Type == ObservationType.DENIAL && e.Value is not null).ToList();
        bool Denied(ObservationType type, double time, Slot subject, Slot by) =>
            denials.Any(d => d.Reporter == by && (ObservationType)d.Value!.Value == type && d.Subject == subject && Math.Abs(d.EventTime - time) <= SameEventTolerance);

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
                var reporters = reports.Select(e => e.Reporter).Distinct().ToList();
                if (reporters.Count >= 2)
                {
                    outcome.Confirmed.Add(new ConfirmedEvent(cluster[0].Type, $"{key}:{subject}", eventTime, subject, null));
                    continue;
                }
                // Vu par une seule équipe : l'autre doit le confirmer.
                var other = reporters[0].Other();
                if (Denied(cluster[0].Type, eventTime, subject, other))
                    outcome.Contradictions.Add($"{cluster[0].Type} à {eventTime:0.0} s : démenti par l'équipe {other}.");
                else if (now - reports.Min(e => e.ReceivedAt) >= ConfirmationDelay)
                    outcome.Contradictions.Add($"{cluster[0].Type} à {eventTime:0.0} s : non confirmé par l'équipe {other}.");
                else Pending(eventTime);
            }
        }

        // 2. CS : auto-déclaré par le joueur, corroboré par la vue de l'adversaire (± tolérance) dans le délai.
        foreach (var self in events.Where(e => e.Type == ObservationType.CS && e.Reporter == e.Subject && e.Value is not null))
        {
            var views = events.Where(e => e.Type == ObservationType.CS && e.Reporter != e.Subject && e.Subject == self.Subject && e.Value is not null).ToList();
            var corroborated = views.Any(v => v.Value >= self.Value - csTolerance);
            if (corroborated)
                outcome.Confirmed.Add(new ConfirmedEvent(ObservationType.CS, self.EventId, self.EventTime, self.Subject, self.Value));
            else if (now - self.ReceivedAt < ConfirmationDelay)
                Pending(self.EventTime);
            else
                outcome.Contradictions.Add(views.Count == 0
                    ? $"CS de {self.Subject} : {self.Value} déclaré, non confirmé par l'équipe adverse."
                    : $"CS de {self.Subject} : {self.Value} déclaré, incohérent avec la vue adverse.");
        }

        // 3. Faits par joueur.
        foreach (var e in outcome.Confirmed.OrderBy(e => e.EventTime))
        {
            var facts = outcome.Facts[e.Subject];
            switch (e.Type)
            {
                case ObservationType.KILL: facts.KillTimes.Add(e.EventTime); break;
                case ObservationType.FIRST_BLOOD: facts.FirstBloodTime ??= e.EventTime; break;
                case ObservationType.CS: facts.CsSamples.Add((e.Value!.Value, e.EventTime)); break;
                case ObservationType.TURRET: facts.TowerTimes.Add(e.EventTime); break;
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
            outcome.Satisfactions[slot] = WinExpression.Evaluate(expressionOf(slot), outcome.Facts[slot]);

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
        return outcome;
    }
}
