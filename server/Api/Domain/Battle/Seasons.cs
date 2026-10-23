namespace Api.Domain.Battle;

public enum Tier { BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, MASTER }

/// <summary>
/// Saisons de l'arène : une par mois civil (heure de Paris), la saison 1 est octobre 2026.
/// En fin de saison : récompense selon le palier final (5 combats minimum), puis la cote revient à mi-chemin de 1000.
/// </summary>
public static class Seasons
{
    public const int MinGamesForReward = 5;
    private const int FirstYear = 2026, FirstMonth = 10;

    /// <summary>Seuils de cote des paliers (Bronze en dessous d'Argent).</summary>
    private static readonly (Tier Tier, int Min)[] Thresholds =
        [(Tier.MASTER, 1350), (Tier.DIAMOND, 1250), (Tier.PLATINUM, 1150), (Tier.GOLD, 1050), (Tier.SILVER, 950)];

    public static string IdOf(DateTimeOffset localNow) => $"{localNow.Year:D4}-{localNow.Month:D2}";

    public static int Number(string seasonId)
    {
        var (y, m) = (int.Parse(seasonId[..4]), int.Parse(seasonId[5..]));
        return (y - FirstYear) * 12 + m - FirstMonth + 1;
    }

    public static Tier TierOf(int rating) => Thresholds.FirstOrDefault(t => rating >= t.Min) is { Min: > 0 } t ? t.Tier : Tier.BRONZE;

    /// <summary>Cote minimale du palier suivant (null au sommet).</summary>
    public static int? NextThreshold(int rating) => Thresholds.Where(t => t.Min > rating).Select(t => (int?)t.Min).LastOrDefault();

    /// <summary>Plancher du palier courant.</summary>
    public static int Floor(int rating) => Thresholds.FirstOrDefault(t => rating >= t.Min) is { Min: > 0 } t ? t.Min : 0;

    /// <summary>Reliques standard et prestige gagnées en fin de saison selon le palier.</summary>
    public static (int Standard, int Premium) Reward(Tier tier) => tier switch
    {
        Tier.BRONZE => (1, 0),
        Tier.SILVER => (2, 0),
        Tier.GOLD => (3, 0),
        Tier.PLATINUM => (2, 1),
        Tier.DIAMOND => (0, 2),
        _ => (0, 3),
    };

    /// <summary>Remise à niveau de début de saison : à mi-chemin de la cote de départ.</summary>
    public static int SoftReset(int rating, int start) => start + (rating - start) / 2;
}
