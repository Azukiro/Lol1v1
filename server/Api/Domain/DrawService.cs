using System.Security.Cryptography;
using System.Text;

namespace Api.Domain;

/// <summary>
/// Tirages aléatoires déterministes : chaque tirage dérive d'une seed stockée sur la série
/// et d'un libellé (ex. "round:2:mirror"), ce qui permet de rejouer et d'auditer.
/// </summary>
public static class DrawService
{
    public static string NewSeed() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

    public static Random Rng(string seed, string purpose)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{seed}|{purpose}"));
        return new Random(BitConverter.ToInt32(hash, 0));
    }

    /// <summary>Miroir : un champion de l'intersection des pools, jamais rejoué dans la série.</summary>
    public static int DrawMirror(string seed, int roundNumber, IEnumerable<int> poolA, IEnumerable<int> poolB, IEnumerable<int> alreadyPlayed)
    {
        var played = alreadyPlayed.ToHashSet();
        var candidates = poolA.Intersect(poolB).Where(c => !played.Contains(c)).Order().ToList();
        if (candidates.Count == 0) throw new DomainException("Aucun champion commun disponible pour le tirage miroir.");
        return candidates[Rng(seed, $"round:{roundNumber}:mirror").Next(candidates.Count)];
    }

    /// <summary>
    /// Deck miroir : un champion parmi les entrées non consommées des deux decks.
    /// Un champion présent dans les deux decks a deux chances d'être tiré (et peut être joué deux fois).
    /// </summary>
    public static int DrawMirrorDeck(string seed, int roundNumber, IEnumerable<int> remainingEntries)
    {
        var candidates = remainingEntries.Order().ToList();
        if (candidates.Count == 0) throw new DomainException("Plus aucun champion dans les decks pour le tirage.");
        return candidates[Rng(seed, $"round:{roundNumber}:mirror-deck").Next(candidates.Count)];
    }

    /// <summary>Aléatoire : un champion par joueur dans son pool, différents entre eux, sans répétition pour un même joueur.</summary>
    public static (int A, int B) DrawRandom(string seed, int roundNumber,
        IEnumerable<int> poolA, IEnumerable<int> poolB, IEnumerable<int> playedByA, IEnumerable<int> playedByB)
    {
        var rng = Rng(seed, $"round:{roundNumber}:random");
        var exA = playedByA.ToHashSet();
        var exB = playedByB.ToHashSet();
        var candA = poolA.Where(c => !exA.Contains(c)).Order().ToList();
        if (candA.Count == 0) throw new DomainException("Plus aucun champion disponible pour le joueur A.");
        var a = candA[rng.Next(candA.Count)];
        var candB = poolB.Where(c => !exB.Contains(c) && c != a).Order().ToList();
        if (candB.Count == 0)
        {
            // Dernier recours : retirer A pour laisser B jouer s'il n'a que ce champion.
            candA.Remove(a);
            candB = poolB.Where(c => !exB.Contains(c)).Order().ToList();
            if (candA.Count == 0 || candB.Count == 0) throw new DomainException("Plus aucun champion disponible pour le joueur B.");
            var b0 = candB[rng.Next(candB.Count)];
            candA.Remove(b0);
            if (candA.Count == 0) throw new DomainException("Impossible de tirer deux champions différents.");
            return (candA[rng.Next(candA.Count)], b0);
        }
        return (a, candB[rng.Next(candB.Count)]);
    }

    /// <summary>Budget de sorts aléatoire : 2 × BO jetons, plafond par sort respecté.</summary>
    public static Dictionary<int, int> DrawSpellBudget(string seed, string purpose, int bestOf, IReadOnlyList<int> allowedSpells)
    {
        var cap = SeriesRules.SpellCap(bestOf);
        var total = SeriesRules.SpellBudget(bestOf);
        if (allowedSpells.Count * cap < total) throw new DomainException("Pas assez de sorts autorisés pour constituer le budget.");
        var rng = Rng(seed, purpose);
        var budget = allowedSpells.ToDictionary(s => s, _ => 0);
        var ordered = allowedSpells.Order().ToList();
        for (var i = 0; i < total; i++)
        {
            var open = ordered.Where(s => budget[s] < cap).ToList();
            budget[open[rng.Next(open.Count)]]++;
        }
        return budget.Where(kv => kv.Value > 0).ToDictionary();
    }
}
