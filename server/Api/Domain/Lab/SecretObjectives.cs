using System.Text.Json.Serialization;

namespace Api.Domain.Lab;

/// <summary>Modes expérimentaux du labo, isolés des modes standards.</summary>
public enum LabMode { SECRET_OBJECTIVES }

/// <summary>Palier d'objectifs : tous les objectifs d'un palier visent la même durée de manche.</summary>
public enum ObjectiveTier { SHORT, MEDIUM, LONG }

/// <summary>Configuration labo d'une série. Tier null = palier tiré au sort à chaque manche.</summary>
public sealed class LabConfig
{
    [JsonPropertyName("mode")] public LabMode Mode { get; set; }
    [JsonPropertyName("tier")] public ObjectiveTier? Tier { get; set; }

    public void Validate()
    {
        if (!Enum.IsDefined(Mode)) throw new DomainException("Mode labo inconnu.");
        if (Tier is { } t && !Enum.IsDefined(t)) throw new DomainException("Palier d'objectifs inconnu.");
    }

    public string Label => $"Labo · Objectifs secrets · {(Tier is { } t ? SecretObjectives.TierLabel(t) : "palier aléatoire")}";
}

/// <summary>Objectif secret : expression de victoire propre à un joueur, avec sa durée estimée.</summary>
public sealed record SecretObjective(string Id, ObjectiveTier Tier, WinNode Expression, double EstimatedMinutes)
{
    public string Label => WinExpression.Describe(Expression);
}

/// <summary>Objectifs tirés pour une manche (jsonb sur la manche).</summary>
public sealed class RoundObjectives
{
    [JsonPropertyName("tier")] public ObjectiveTier Tier { get; set; }
    /// <summary>Temps de jeu (s) au-delà duquel la progression départage.</summary>
    [JsonPropertyName("timeLimit")] public double TimeLimit { get; set; }
    [JsonPropertyName("a")] public string A { get; set; } = "";
    [JsonPropertyName("b")] public string B { get; set; } = "";
    [JsonPropertyName("expressionA")] public WinNode ExpressionA { get; set; } = null!;
    [JsonPropertyName("expressionB")] public WinNode ExpressionB { get; set; } = null!;

    public string IdOf(Slot slot) => slot == Slot.A ? A : B;
    public WinNode ExpressionOf(Slot slot) => slot == Slot.A ? ExpressionA : ExpressionB;
}

/// <summary>
/// Mode « objectifs secrets » : chaque joueur reçoit un objectif tiré dans le même palier,
/// sans connaître celui de l'adversaire. Règles d'équité du pool :
/// pas de condition « première X » (impossible dès que l'adversaire la prend),
/// uniquement des conditions contestables (kills, CS, tours), pas de condition négative.
/// </summary>
public static class SecretObjectives
{
    private static WinNode Kills(int n) => WinNode.Leaf(Conditions.Kills, n);
    private static WinNode Cs(int n) => WinNode.Leaf(Conditions.Cs, n);
    private static WinNode Towers(int n) => WinNode.Leaf(Conditions.Towers, n);

    /// <summary>Durées estimées (min) sur l'Abîme hurlant en 1v1 équilibré : point de départ, à recalibrer sur l'historique.</summary>
    public static readonly IReadOnlyList<SecretObjective> Pool =
    [
        new("s-kills1", ObjectiveTier.SHORT, Kills(1), 4),
        new("s-cs50", ObjectiveTier.SHORT, Cs(50), 5),
        new("s-kill-cs30", ObjectiveTier.SHORT, WinNode.And(Kills(1), Cs(30)), 5),

        new("m-kills2", ObjectiveTier.MEDIUM, Kills(2), 8),
        new("m-cs100", ObjectiveTier.MEDIUM, Cs(100), 9),
        new("m-towers1", ObjectiveTier.MEDIUM, Towers(1), 9),
        new("m-kill-cs70", ObjectiveTier.MEDIUM, WinNode.And(Kills(1), Cs(70)), 8.5),

        new("l-kills3", ObjectiveTier.LONG, Kills(3), 13),
        new("l-cs150", ObjectiveTier.LONG, Cs(150), 14),
        new("l-towers2", ObjectiveTier.LONG, Towers(2), 14),
        new("l-tower-kills2", ObjectiveTier.LONG, WinNode.And(Towers(1), Kills(2)), 14),
        new("l-cs120-kill", ObjectiveTier.LONG, WinNode.And(Cs(120), Kills(1)), 13.5),
    ];

    /// <summary>Temps limite par palier (≈ 1,6 × la durée visée).</summary>
    public static double TimeLimitSeconds(ObjectiveTier tier) => tier switch
    {
        ObjectiveTier.SHORT => 8 * 60,
        ObjectiveTier.MEDIUM => 14 * 60,
        _ => 22 * 60,
    };

    public static string TierLabel(ObjectiveTier tier) => tier switch
    {
        ObjectiveTier.SHORT => "court",
        ObjectiveTier.MEDIUM => "moyen",
        _ => "long",
    };

    public static SecretObjective Get(string id) =>
        Pool.FirstOrDefault(o => o.Id == id) ?? throw new DomainException($"Objectif inconnu : {id}.");

    /// <summary>
    /// Tirage d'une manche : même palier pour les deux, objectifs tirés indépendamment
    /// (le même objectif peut tomber deux fois, l'adversaire ne peut donc rien exclure).
    /// </summary>
    public static RoundObjectives Draw(string seed, int roundNumber, int attempt, ObjectiveTier? tier)
    {
        var rng = DrawService.Rng(seed, $"round:{roundNumber}:{attempt}:secret");
        var t = tier ?? (ObjectiveTier)rng.Next(3);
        var candidates = Pool.Where(o => o.Tier == t).OrderBy(o => o.Id, StringComparer.Ordinal).ToList();
        var a = candidates[rng.Next(candidates.Count)];
        var b = candidates[rng.Next(candidates.Count)];
        return new RoundObjectives { Tier = t, TimeLimit = TimeLimitSeconds(t), A = a.Id, B = b.Id, ExpressionA = a.Expression, ExpressionB = b.Expression };
    }

    /// <summary>
    /// Progression (0 à 1) vers l'objectif avec les faits antérieurs à <paramref name="until"/> :
    /// compteur / seuil pour une condition, maximum des enfants pour OU, moyenne pour ET.
    /// </summary>
    public static double Progress(WinNode node, PlayerFacts facts, double until = double.MaxValue)
    {
        if (node.IsLeaf)
        {
            var threshold = Math.Max(1, node.Threshold ?? 1);
            double value = node.Condition switch
            {
                Conditions.Kills => facts.KillTimes.Count(t => t <= until),
                Conditions.Towers => facts.TowerTimes.Count(t => t <= until),
                Conditions.Cs => facts.CsSamples.Where(s => s.Time <= until).Select(s => s.Value).DefaultIfEmpty(0).Max(),
                Conditions.FirstBlood => facts.FirstBloodTime <= until ? 1 : 0,
                Conditions.FirstTower => facts.FirstTowerTime <= until ? 1 : 0,
                _ => 0,
            };
            return Math.Min(1, value / threshold);
        }
        var children = node.Children!.Select(c => Progress(c, facts, until)).ToList();
        return node.Op == "OR" ? children.Max() : children.Average();
    }
}
