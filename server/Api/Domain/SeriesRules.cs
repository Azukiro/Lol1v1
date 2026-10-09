using System.Text.Json.Serialization;
using Api.Domain.Lab;

namespace Api.Domain;

/// <summary>Configuration figée à la création : BO, mode de champion, mode de sorts, expression de victoire.</summary>
public sealed class SeriesConfig
{
    [JsonPropertyName("bestOf")] public int BestOf { get; set; }
    [JsonPropertyName("championMode")] public ChampionMode ChampionMode { get; set; }
    [JsonPropertyName("spellMode")] public SpellMode SpellMode { get; set; }
    /// <summary>Ignorée en mode labo « objectifs secrets » (chaque joueur a la sienne).</summary>
    [JsonPropertyName("winExpression")] public WinNode? WinExpression { get; set; }
    /// <summary>Mode expérimental du labo, null pour une série standard.</summary>
    [JsonPropertyName("lab")] public LabConfig? Lab { get; set; }

    public void Validate()
    {
        SeriesRules.ValidateBestOf(BestOf);
        if (!Enum.IsDefined(ChampionMode)) throw new DomainException("Mode de champion inconnu.");
        if (!Enum.IsDefined(SpellMode)) throw new DomainException("Mode de sorts inconnu.");
        if (Lab is not null) Lab.Validate();
        else Api.Domain.WinExpression.Validate(WinExpression);
    }
}

/// <summary>Configuration enregistrée (config prête) : tout sauf le format, choisi au lancement du défi.</summary>
public sealed class PresetConfig
{
    [JsonPropertyName("championMode")] public ChampionMode ChampionMode { get; set; }
    [JsonPropertyName("spellMode")] public SpellMode SpellMode { get; set; }
    [JsonPropertyName("winExpression")] public WinNode WinExpression { get; set; } = null!;

    public void Validate()
    {
        if (!Enum.IsDefined(ChampionMode)) throw new DomainException("Mode de champion inconnu.");
        if (!Enum.IsDefined(SpellMode)) throw new DomainException("Mode de sorts inconnu.");
        Api.Domain.WinExpression.Validate(WinExpression);
    }
}

public static class SeriesRules
{
    public const int BansPerPlayer = 3;
    public static readonly int[] AllowedBestOf = [1, 3, 5, 7, 9, 11];

    public static void ValidateBestOf(int bestOf)
    {
        if (!AllowedBestOf.Contains(bestOf)) throw new DomainException("Le BO doit être impair, entre 1 et 11.");
    }

    public static int WinsNeeded(int bestOf) => (bestOf + 1) / 2;

    /// <summary>Taille minimale d'un deck : BO + 3 (une manche par champion + 3 bans subis).</summary>
    public static int MinDeckSize(int bestOf) => bestOf + BansPerPlayer;

    /// <summary>
    /// Deck miroir : ⌈BO/2⌉ champions chacun. Les deux decks réunis (BO + 1 entrées) couvrent
    /// toutes les manches possibles, chaque manche validée consommant une entrée.
    /// </summary>
    public static int MirrorDeckSize(int bestOf) => WinsNeeded(bestOf);

    /// <summary>Taille de deck attendue dans l'interface (minimum en mode deck, exacte en deck miroir).</summary>
    public static int DeckSize(ChampionMode mode, int bestOf) => mode == ChampionMode.MIRROR_DECK ? MirrorDeckSize(bestOf) : MinDeckSize(bestOf);

    public static bool UsesDeck(ChampionMode mode) => mode is ChampionMode.DECK or ChampionMode.MIRROR_DECK;

    public static int SpellBudget(int bestOf) => 2 * bestOf;

    /// <summary>
    /// Plafond de jetons par sort (Q3) : ⌈BO/2⌉ + 1, borné à BO pour que les jetons restent
    /// toujours répartissables en paires de sorts distincts.
    /// </summary>
    public static int SpellCap(int bestOf) => Math.Min(WinsNeeded(bestOf) + 1, bestOf);

    public static void ValidateDeck(int bestOf, IReadOnlyCollection<int> deck, IReadOnlySet<int> pool)
    {
        if (deck.Distinct().Count() != deck.Count) throw new DomainException("Le deck contient des doublons.");
        var min = MinDeckSize(bestOf);
        if (deck.Count < min) throw new DomainException($"Le deck doit contenir au moins {min} champions (BO + 3).");
        var missing = deck.Where(c => !pool.Contains(c)).ToList();
        if (missing.Count > 0) throw new DomainException($"Champions absents de ton pool : {string.Join(", ", missing)}.");
    }

    /// <summary>Deck miroir : taille exacte, champions possédés par les deux joueurs (ils joueront le même).</summary>
    public static void ValidateMirrorDeck(int bestOf, IReadOnlyCollection<int> deck, IReadOnlySet<int> commonPool)
    {
        if (deck.Distinct().Count() != deck.Count) throw new DomainException("Le deck contient des doublons.");
        var size = MirrorDeckSize(bestOf);
        if (deck.Count != size) throw new DomainException($"Le deck doit contenir exactement {size} champions.");
        if (deck.Any(c => !commonPool.Contains(c))) throw new DomainException("Chaque champion doit être disponible pour vous deux.");
    }

    public static void ValidateSpellBudget(int bestOf, IReadOnlyDictionary<int, int> budget, IReadOnlyCollection<int> allowedSpells)
    {
        var cap = SpellCap(bestOf);
        foreach (var (spell, qty) in budget)
        {
            if (!allowedSpells.Contains(spell)) throw new DomainException($"Sort non autorisé sur l'Abîme hurlant : {spell}.");
            if (qty < 0) throw new DomainException("Quantité négative.");
            if (qty > cap) throw new DomainException($"Maximum {cap} jetons par sort.");
        }
        var total = budget.Values.Sum();
        if (total != SpellBudget(bestOf)) throw new DomainException($"Le budget doit totaliser {SpellBudget(bestOf)} jetons (actuellement {total}).");
    }

    /// <summary>
    /// Des jetons restants (2 par manche restante) sont jouables jusqu'au bout si aucun sort
    /// n'est présent plus de fois qu'il ne reste de manches.
    /// </summary>
    public static bool SpellTokensPlayable(IReadOnlyDictionary<int, int> tokensLeft)
    {
        var total = tokensLeft.Values.Sum();
        var rounds = total / 2;
        return tokensLeft.Values.All(q => q <= rounds);
    }
}
