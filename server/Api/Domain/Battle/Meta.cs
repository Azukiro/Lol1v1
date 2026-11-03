using System.Globalization;

namespace Api.Domain.Battle;

public enum MetaTarget { CHAMPION, CLASS }

/// <summary>Buff (Percent &gt; 0) ou nerf d'un champion ou d'une classe principale, en % de puissance au combat.</summary>
public sealed record MetaChange(MetaTarget Target, int? ChampionId, ChampionClass? Class, string Name, int Percent, string Reason);

/// <summary>Champion du catalogue vu par la méta : classe principale et nombre de rosters complets qui le jouent.</summary>
public sealed record MetaCandidate(int ChampionId, string Name, ChampionClass? Primary, int Usage);

/// <summary>
/// Méta de l'arène : un patch par semaine (lundi minuit, heure de Paris). Les champions les plus joués dans les rosters sont nerfés,
/// des champions peu joués sont buffés, et la classe principale la plus jouée cède sa place à la moins jouée :
/// le meilleur roster change d'une semaine à l'autre. Le patch est figé à sa création (même si les rosters bougent ensuite).
/// </summary>
public static class Meta
{
    public const int ChampionCount = 4, ChampionPercent = 8, ClassPercent = 4;

    /// <summary>Semaine ISO de la date locale, « 2026-W44 ».</summary>
    public static string IdOf(DateTime localDate) => $"{ISOWeek.GetYear(localDate):D4}-W{ISOWeek.GetWeekOfYear(localDate):D2}";

    /// <summary>Lundi de la semaine locale (minuit).</summary>
    public static DateTime WeekStart(DateTime localDate) => localDate.Date.AddDays(-(((int)localDate.DayOfWeek + 6) % 7));

    /// <summary>
    /// Changements du patch : nerf des <see cref="ChampionCount"/> champions les plus joués (au moins un roster), buff d'autant de
    /// champions parmi les moins joués (tirés au sort, seed de la semaine), nerf de la classe la plus jouée et buff de la moins jouée.
    /// </summary>
    public static List<MetaChange> Generate(IReadOnlyList<MetaCandidate> champions, int seed)
    {
        var rng = new Random(seed);
        var shuffled = champions.OrderBy(_ => rng.Next()).ToList();
        var nerfed = shuffled.Where(c => c.Usage > 0).OrderByDescending(c => c.Usage).Take(ChampionCount).ToList();
        var buffed = shuffled.Except(nerfed).OrderBy(c => c.Usage).Take(ChampionCount).ToList();

        var changes = new List<MetaChange>();
        changes.AddRange(nerfed.Select(c => new MetaChange(MetaTarget.CHAMPION, c.ChampionId, null, c.Name, -ChampionPercent,
            $"Joué dans {c.Usage} roster{(c.Usage > 1 ? "s" : "")}")));
        changes.AddRange(buffed.Select(c => new MetaChange(MetaTarget.CHAMPION, c.ChampionId, null, c.Name, ChampionPercent,
            c.Usage == 0 ? "Absent des rosters" : "Peu joué")));

        var classes = Enum.GetValues<ChampionClass>()
            .Select(k => (Class: k, Usage: champions.Where(c => c.Primary == k).Sum(c => c.Usage)))
            .OrderBy(_ => rng.Next()).ToList();
        if (classes.Where(k => k.Usage > 0).OrderByDescending(k => k.Usage).FirstOrDefault() is { Usage: > 0 } top)
        {
            changes.Add(new MetaChange(MetaTarget.CLASS, null, top.Class, ClassName(top.Class), -ClassPercent, "Classe la plus jouée"));
            var low = classes.Where(k => k.Class != top.Class).OrderBy(k => k.Usage).First();
            changes.Add(new MetaChange(MetaTarget.CLASS, null, low.Class, ClassName(low.Class), ClassPercent, "Classe la moins jouée"));
        }
        return changes;
    }

    /// <summary>Bonus de méta d'un champion (multiplicateur − 1) : son changement et celui de sa classe principale se cumulent.</summary>
    public static double Bonus(int championId, ChampionClass? primary, IReadOnlyList<MetaChange> changes)
    {
        var champ = changes.FirstOrDefault(c => c.Target == MetaTarget.CHAMPION && c.ChampionId == championId)?.Percent ?? 0;
        var cls = primary is null ? 0 : changes.FirstOrDefault(c => c.Target == MetaTarget.CLASS && c.Class == primary)?.Percent ?? 0;
        return (1 + champ / 100.0) * (1 + cls / 100.0) - 1;
    }

    public static string ClassName(ChampionClass c) => c switch
    {
        ChampionClass.ASSASSIN => "Assassins",
        ChampionClass.MAGE => "Mages",
        ChampionClass.MARKSMAN => "Tireurs",
        ChampionClass.TANK => "Tanks",
        ChampionClass.FIGHTER => "Combattants",
        _ => "Supports",
    };
}
