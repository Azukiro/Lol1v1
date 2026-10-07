using System.Text.Json;
using System.Text.Json.Serialization;

namespace Api.Domain;

/// <summary>
/// Noeud de l'expression de victoire : soit un opérateur (AND / OR) avec des enfants,
/// soit une condition atomique du catalogue (avec seuil éventuel).
/// </summary>
public sealed class WinNode
{
    [JsonPropertyName("op")] public string? Op { get; set; }
    [JsonPropertyName("children")] public List<WinNode>? Children { get; set; }
    [JsonPropertyName("condition")] public string? Condition { get; set; }
    [JsonPropertyName("threshold")] public int? Threshold { get; set; }

    [JsonIgnore] public bool IsLeaf => Condition is not null;

    public static WinNode Leaf(string condition, int? threshold = null) => new() { Condition = condition, Threshold = threshold };
    public static WinNode Or(params WinNode[] children) => new() { Op = "OR", Children = children.ToList() };
    public static WinNode And(params WinNode[] children) => new() { Op = "AND", Children = children.ToList() };

    public override string ToString() => WinExpression.Describe(this);
}

public static class Conditions
{
    public const string FirstBlood = "FIRST_BLOOD";
    public const string Kills = "KILLS";
    public const string FirstTower = "FIRST_TOWER";
    public const string Cs = "CS";

    public static readonly string[] Catalog = [FirstBlood, Kills, FirstTower, Cs];
    public static bool NeedsThreshold(string condition) => condition is Kills or Cs;
}

/// <summary>Faits observés pour un joueur, chacun avec l'horodatage de jeu où il est devenu vrai.</summary>
public sealed class PlayerFacts
{
    /// <summary>Horodatages (EventTime) des kills attribués au joueur, triés.</summary>
    public List<double> KillTimes { get; } = [];
    public double? FirstBloodTime { get; set; }
    public double? FirstTowerTime { get; set; }
    /// <summary>Paliers de CS confirmés : (valeur, EventTime).</summary>
    public List<(int Value, double Time)> CsSamples { get; } = [];

    public int Kills => KillTimes.Count;
    public int Cs => CsSamples.Count == 0 ? 0 : CsSamples.Max(s => s.Value);
}

public sealed record Satisfaction(double Time, WinNode Trigger);

public static class WinExpression
{
    public const int MaxDepth = 3;
    public const int CsStep = 10;
    public static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public static WinNode Parse(string json) =>
        JsonSerializer.Deserialize<WinNode>(json, Json) ?? throw new DomainException("Expression de victoire vide.");

    public static string Serialize(WinNode node) => JsonSerializer.Serialize(node, Json);

    /// <summary>Valide l'expression : profondeur ≤ 3, conditions du catalogue, seuils > 0.</summary>
    public static void Validate(WinNode? node, int depth = 1)
    {
        if (node is null) throw new DomainException("Expression de victoire manquante.");
        if (depth > MaxDepth) throw new DomainException($"Expression trop profonde (max {MaxDepth}).");

        if (node.IsLeaf)
        {
            if (node.Op is not null || node.Children is { Count: > 0 })
                throw new DomainException("Une condition ne peut pas avoir d'enfants.");
            if (!Conditions.Catalog.Contains(node.Condition))
                throw new DomainException($"Condition inconnue : {node.Condition}.");
            if (Conditions.NeedsThreshold(node.Condition!))
            {
                if (node.Threshold is null or <= 0) throw new DomainException($"{node.Condition} demande un seuil > 0.");
                if (node.Threshold > 1000) throw new DomainException($"Seuil trop élevé pour {node.Condition}.");
                // La Live Client Data API ne donne les CS que par dizaines, même pour le joueur local.
                if (node.Condition == Conditions.Cs && node.Threshold % CsStep != 0)
                    throw new DomainException($"CS : multiple de {CsStep} (le jeu ne donne les CS que par dizaines).");
            }
            else if (node.Threshold is not null)
                throw new DomainException($"{node.Condition} ne prend pas de seuil.");
            return;
        }

        if (node.Op is not ("AND" or "OR")) throw new DomainException("Opérateur attendu : AND ou OR.");
        if (node.Children is null || node.Children.Count < 2) throw new DomainException("Un opérateur demande au moins deux enfants.");
        foreach (var child in node.Children) Validate(child, depth + 1);
    }

    /// <summary>
    /// Évalue l'expression pour un joueur. Retourne l'horodatage de jeu auquel elle est devenue vraie
    /// (OR = plus tôt des enfants, AND = plus tard des enfants) et la condition déclencheuse, ou null.
    /// </summary>
    public static Satisfaction? Evaluate(WinNode node, PlayerFacts facts)
    {
        if (node.IsLeaf)
        {
            double? time = node.Condition switch
            {
                Conditions.FirstBlood => facts.FirstBloodTime,
                Conditions.FirstTower => facts.FirstTowerTime,
                Conditions.Kills => facts.KillTimes.Count >= node.Threshold ? facts.KillTimes.Order().ElementAt(node.Threshold!.Value - 1) : null,
                Conditions.Cs => facts.CsSamples.Where(s => s.Value >= node.Threshold).Select(s => (double?)s.Time).Min(),
                _ => null,
            };
            return time is null ? null : new Satisfaction(time.Value, node);
        }

        var results = node.Children!.Select(c => Evaluate(c, facts)).ToList();
        if (node.Op == "OR")
            return results.Where(r => r is not null).OrderBy(r => r!.Time).FirstOrDefault();
        if (results.Any(r => r is null)) return null;
        return results.OrderByDescending(r => r!.Time).First();
    }

    public static string Describe(WinNode node, bool root = true)
    {
        if (node.IsLeaf)
        {
            return node.Condition switch
            {
                Conditions.FirstBlood => "First blood",
                Conditions.FirstTower => "Première tour",
                Conditions.Kills => $"Kills ≥ {node.Threshold}",
                Conditions.Cs => $"CS ≥ {node.Threshold}",
                _ => node.Condition ?? "?",
            };
        }
        var sep = node.Op == "AND" ? " ET " : " OU ";
        var inner = string.Join(sep, node.Children!.Select(c => Describe(c, false)));
        return root ? inner : $"({inner})";
    }
}

public sealed class DomainException(string message) : Exception(message);
