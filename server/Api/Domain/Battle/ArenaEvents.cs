using System.Globalization;

namespace Api.Domain.Battle;

public enum ArenaEventKind { DOUBLE_ESSENCE, DOUBLE_XP, CHAOS_META }

/// <summary>Événement du week-end (heure locale) : bonus d'essence, d'XP de pass ou méta chamboulée (Changes).</summary>
public sealed record ArenaEvent(string Id, ArenaEventKind Kind, string Title, string Text, DateTime StartsLocal, DateTime EndsLocal, List<MetaChange> Changes)
{
    public int EssenceMultiplier => Kind == ArenaEventKind.DOUBLE_ESSENCE ? 2 : 1;
    public int XpMultiplier => Kind == ArenaEventKind.DOUBLE_XP ? 2 : 1;
}

/// <summary>
/// Événements de l'arène : chaque week-end, du samedi minuit au lundi minuit (heure de Paris), un événement en rotation
/// selon la semaine ISO : double essence, double XP de pass, puis méta folle (une classe surpuissante, une autre à la ramasse).
/// </summary>
public static class ArenaEvents
{
    public const int ChaosBuff = 15, ChaosNerf = -10;

    /// <summary>Événement du week-end de la semaine qui contient <paramref name="local"/>.</summary>
    public static ArenaEvent ForWeek(DateTime local)
    {
        var monday = Meta.WeekStart(local);
        var id = Meta.IdOf(monday);
        var kind = (ArenaEventKind)(ISOWeek.GetWeekOfYear(monday) % 3);
        var (start, end) = (monday.AddDays(5), monday.AddDays(7));
        return kind switch
        {
            ArenaEventKind.DOUBLE_ESSENCE => new(id, kind, "Week-end double essence",
                "Chaque victoire en attaque rapporte deux fois plus d'essence. Remplis ta forge !", start, end, []),
            ArenaEventKind.DOUBLE_XP => new(id, kind, "Week-end double XP",
                "Tous les combats rapportent deux fois plus d'XP de pass de saison. Grimpe les niveaux !", start, end, []),
            _ => Chaos(id, start, end),
        };
    }

    private static ArenaEvent Chaos(string id, DateTime start, DateTime end)
    {
        var rng = new Random(Meta.StableSeed(id + ":chaos"));
        var classes = Enum.GetValues<ChampionClass>().OrderBy(_ => rng.Next()).ToList();
        var (up, down) = (classes[0], classes[1]);
        return new(id, ArenaEventKind.CHAOS_META, "Week-end méta folle",
            $"{Meta.ClassName(up)} surpuissants (+{ChaosBuff} %), {Meta.ClassName(down)} à la ramasse ({ChaosNerf} %). Adapte ton équipe !", start, end,
            [
                new(MetaTarget.CLASS, null, up, Meta.ClassName(up), ChaosBuff, "Événement : méta folle"),
                new(MetaTarget.CLASS, null, down, Meta.ClassName(down), ChaosNerf, "Événement : méta folle"),
            ]);
    }

    /// <summary>Événement en cours, ou null en semaine.</summary>
    public static ArenaEvent? Current(DateTime local) =>
        ForWeek(local) is var e && local >= e.StartsLocal && local < e.EndsLocal ? e : null;

    /// <summary>Événement en cours, sinon le prochain.</summary>
    public static ArenaEvent CurrentOrNext(DateTime local) => Current(local) ?? ForWeek(local);
}
