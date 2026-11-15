namespace Api.Domain.Battle;

public enum Tier { BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, MASTER, GRANDMASTER, CHALLENGER }

/// <summary>
/// Saisons de l'arène (heure de Paris). Saisons 1 et 2 : mois civils (octobre, puis novembre jusqu'au 15), id "2026-10".
/// Depuis le lundi 16 novembre 2026 : deux semaines, du lundi minuit au lundi minuit, id = date de début ("2026-11-16").
/// En fin de saison : récompense selon le palier final (5 combats minimum), cadre de l'icône pour la saison suivante,
/// puis la cote revient à mi-chemin de 1000.
/// </summary>
public static class Seasons
{
    public const int MinGamesForReward = 5;
    public const int LengthDays = 14;
    private const int FirstYear = 2026, FirstMonth = 10;
    /// <summary>Début de la première saison de deux semaines (saison 3).</summary>
    private static readonly DateTime FirstSprint = new(2026, 11, 16);
    private const int FirstSprintNumber = 3;

    /// <summary>Seuils de cote des paliers (Bronze en dessous d'Argent), espacés pour que le volume de combats ne suffise pas.</summary>
    private static readonly (Tier Tier, int Min)[] Thresholds =
    [
        (Tier.CHALLENGER, 1850), (Tier.GRANDMASTER, 1700), (Tier.MASTER, 1550), (Tier.DIAMOND, 1400),
        (Tier.PLATINUM, 1250), (Tier.GOLD, 1150), (Tier.SILVER, 1050),
    ];

    /// <summary>Début (heure locale) de la saison qui contient <paramref name="local"/>.</summary>
    public static DateTime StartOf(DateTime local)
    {
        if (local < FirstSprint) return new DateTime(local.Year, local.Month, 1);
        var n = (int)(local.Date - FirstSprint).TotalDays / LengthDays;
        return FirstSprint.AddDays(n * LengthDays);
    }

    /// <summary>Fin (heure locale, exclue) de la saison qui contient <paramref name="local"/>.</summary>
    public static DateTime EndOf(DateTime local)
    {
        if (local >= FirstSprint) return StartOf(local).AddDays(LengthDays);
        var next = new DateTime(local.Year, local.Month, 1).AddMonths(1);
        return next < FirstSprint ? next : FirstSprint;
    }

    public static string IdOf(DateTime local) =>
        local < FirstSprint ? $"{local.Year:D4}-{local.Month:D2}" : StartOf(local).ToString("yyyy-MM-dd");

    public static int Number(string seasonId)
    {
        if (seasonId.Length > 7)
            return FirstSprintNumber + (int)(DateTime.Parse(seasonId, System.Globalization.CultureInfo.InvariantCulture) - FirstSprint).TotalDays / LengthDays;
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
        Tier.MASTER => (0, 3),
        Tier.GRANDMASTER => (1, 4),
        _ => (2, 5),
    };

    /// <summary>Remise à niveau de début de saison : à mi-chemin de la cote de départ.</summary>
    public static int SoftReset(int rating, int start) => start + (rating - start) / 2;
}
