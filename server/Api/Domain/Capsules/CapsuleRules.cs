namespace Api.Domain.Capsules;

/// <summary>
/// Rareté d'un objet de capsule. Les champions sont communs, les skins montent en rareté avec leur prix en boutique
/// (standard ≤ 975 RP, 1350, 1820, prestige / mythique, 3250, exalté).
/// </summary>
public enum Rarity { COMMON, RARE, EPIC, LEGENDARY, MYTHIC, ULTIMATE, EXALTED }

public enum CapsuleItemKind { CHAMPION, SKIN }

/// <summary>Règles pures des capsules : accumulation horaire, tirage pondéré, garantie, essence des doublons.</summary>
public static class CapsuleRules
{
    /// <summary>Poids de tirage (sur 10 000) par rareté.</summary>
    public static readonly IReadOnlyDictionary<Rarity, int> Weights = new Dictionary<Rarity, int>
    {
        [Rarity.COMMON] = 5500,
        [Rarity.RARE] = 2800,
        [Rarity.EPIC] = 1100,
        [Rarity.LEGENDARY] = 450,
        [Rarity.MYTHIC] = 100,
        [Rarity.ULTIMATE] = 40,
        [Rarity.EXALTED] = 10,
    };

    /// <summary>Essence gagnée quand l'objet tiré est déjà possédé.</summary>
    public static int DuplicateEssence(Rarity rarity) => rarity switch
    {
        Rarity.COMMON => 10,
        Rarity.RARE => 20,
        Rarity.EPIC => 40,
        Rarity.LEGENDARY => 80,
        Rarity.MYTHIC => 150,
        Rarity.ULTIMATE => 300,
        _ => 500,
    };

    /// <summary>Après PityThreshold - 1 tirages sans Épique ou mieux, le suivant en garantit un.</summary>
    public const int PityThreshold = 10;

    /// <summary>
    /// Capsules disponibles à <paramref name="now"/> : une par intervalle écoulé depuis <paramref name="anchor"/>,
    /// sans dépasser <paramref name="max"/> (le stock acheté ou offert peut le dépasser, mais n'accumule plus).
    /// Renvoie le stock et la nouvelle ancre (remise à maintenant quand le stock est plein).
    /// </summary>
    public static (int Available, DateTimeOffset Anchor) Accrue(int stored, DateTimeOffset anchor, DateTimeOffset now, int max, TimeSpan interval)
    {
        if (stored >= max) return (stored, now);
        var ticks = (int)Math.Max(0, Math.Floor((now - anchor) / interval));
        if (stored + ticks >= max) return (max, now);
        return (stored + ticks, anchor + interval * ticks);
    }

    /// <summary>Tire une rareté ; <paramref name="guaranteed"/> exclut Commun et Rare (garantie).</summary>
    public static Rarity RollRarity(Random rng, bool guaranteed, ISet<Rarity> available)
    {
        var pool = Weights.Where(w => available.Contains(w.Key) && (!guaranteed || w.Key >= Rarity.EPIC)).ToList();
        if (pool.Count == 0) pool = Weights.Where(w => available.Contains(w.Key)).ToList();
        var roll = rng.Next(pool.Sum(w => w.Value));
        foreach (var (rarity, weight) in pool)
        {
            if (roll < weight) return rarity;
            roll -= weight;
        }
        return pool[^1].Key;
    }

    /// <summary>Rareté d'un skin d'après le champ « rarity » de CommunityDragon.</summary>
    public static Rarity FromGameRarity(string? rarity) => rarity switch
    {
        "kEpic" => Rarity.EPIC,
        "kLegendary" => Rarity.LEGENDARY,
        "kMythic" => Rarity.MYTHIC,
        "kUltimate" => Rarity.ULTIMATE,
        "kTranscendent" or "kExalted" => Rarity.EXALTED,
        _ => Rarity.RARE,
    };
}
