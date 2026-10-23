using Api.Domain.Capsules;

namespace Api.Domain.Battle;

/// <summary>Classe d'un champion (rôles CommunityDragon), la première est la principale.</summary>
public enum ChampionClass { ASSASSIN, MAGE, MARKSMAN, TANK, FIGHTER, SUPPORT }

public enum BattleSide { A, B }

public enum BattleEventKind { GANK, FIRST_BLOOD, KILL, TOWER, OBJECTIVE, FIGHT, ACE, END }

/// <summary>Objet du roster engagé au combat.</summary>
public sealed record BattleUnit(CapsuleItemKind Kind, int ItemId, string Champion, int ChampionId, Rarity Rarity, ChampionClass[] Classes, int[] Lines);

/// <summary>Bilan d'une unité : puissance, bonus de poste et de contre (en %), éliminations.</summary>
public sealed record UnitReport(
    int Role, CapsuleItemKind Kind, int ItemId, string Champion, Rarity Rarity, ChampionClass[] Classes,
    int Power, int FitPercent, int CounterPercent, int Kills = 0, int Deaths = 0);

public sealed record TeamReport(List<UnitReport> Units, List<string> Synergies, int Power);

/// <summary>Événement de la partie, avec le score après l'événement (or en milliers).</summary>
public sealed record BattleEvent(
    int Minute, BattleEventKind Kind, BattleSide Side, string Text, int KillsA, int KillsB, int TowersA, int TowersB, double GoldA, double GoldB);

public sealed record BattleOutcome(BattleSide Winner, int Minutes, TeamReport A, TeamReport B, List<BattleEvent> Events);

/// <summary>
/// Partie simulée entre deux rosters (TOP, JUNGLE, MID, BOT, SUPPORT) : phase de lanes, objectifs, puis teamfights au meilleur des 3.
/// La stratégie vient de la composition : classe adaptée au poste, contres de classe face au vis-à-vis, synergies d'équipe.
/// Déterministe pour un seed donné.
/// </summary>
public static class BattleRules
{
    public const int TeamSize = 5;
    public const int Top = 0, Jungle = 1, Mid = 2, Bot = 3, Support = 4;
    public const double CounterBonus = 0.12;

    public static readonly string[] RoleNames = ["top", "jungle", "mid", "bot", "support"];

    /// <summary>Classes à l'aise à chaque poste.</summary>
    private static readonly ChampionClass[][] RoleFit =
    [
        [ChampionClass.FIGHTER, ChampionClass.TANK],
        [ChampionClass.FIGHTER, ChampionClass.ASSASSIN, ChampionClass.TANK],
        [ChampionClass.MAGE, ChampionClass.ASSASSIN],
        [ChampionClass.MARKSMAN],
        [ChampionClass.SUPPORT, ChampionClass.TANK],
    ];

    /// <summary>Cycle des contres : chaque classe bat les deux suivantes et perd contre les deux précédentes.</summary>
    private static readonly ChampionClass[] CounterRing =
        [ChampionClass.ASSASSIN, ChampionClass.MAGE, ChampionClass.MARKSMAN, ChampionClass.TANK, ChampionClass.FIGHTER, ChampionClass.SUPPORT];

    public static ChampionClass? ParseClass(string? role) => role?.ToLowerInvariant() switch
    {
        "assassin" => ChampionClass.ASSASSIN,
        "mage" => ChampionClass.MAGE,
        "marksman" => ChampionClass.MARKSMAN,
        "tank" => ChampionClass.TANK,
        "fighter" => ChampionClass.FIGHTER,
        "support" => ChampionClass.SUPPORT,
        _ => null,
    };

    /// <summary>+2 % par palier de rareté (Commun 0 %, Exalté +12 %).</summary>
    public static double RarityBonus(Rarity rarity) => (int)rarity * 0.02;

    /// <summary>Classe principale adaptée au poste +10 %, classe secondaire +4 %, hors poste −10 % (classes inconnues : neutre).</summary>
    public static double RoleFitBonus(BattleUnit unit, int role)
    {
        if (unit.Classes.Length == 0) return 0;
        if (RoleFit[role].Contains(unit.Classes[0])) return 0.10;
        return unit.Classes.Any(RoleFit[role].Contains) ? 0.04 : -0.10;
    }

    /// <summary>+1 si la classe principale de <paramref name="a"/> contre celle de <paramref name="b"/>, −1 dans l'autre sens, 0 sinon.</summary>
    public static int Counter(BattleUnit a, BattleUnit b)
    {
        if (a.Classes.Length == 0 || b.Classes.Length == 0) return 0;
        var d = (Array.IndexOf(CounterRing, b.Classes[0]) - Array.IndexOf(CounterRing, a.Classes[0]) + CounterRing.Length) % CounterRing.Length;
        return d is 1 or 2 ? 1 : d is 4 or 5 ? -1 : 0;
    }

    /// <summary>Synergies d'une équipe et bonus total (multiplicateur − 1).</summary>
    public static (double Bonus, List<string> Labels) Synergies(IReadOnlyList<BattleUnit> team, IReadOnlyDictionary<int, string> lineNames)
    {
        var bonus = 0.0;
        var labels = new List<string>();
        var line = team.SelectMany(u => u.Lines.Distinct()).GroupBy(l => l).OrderByDescending(g => g.Count()).FirstOrDefault();
        if (line is not null && line.Count() >= 2)
        {
            var b = 0.03 * (line.Count() - 1);
            bonus += b;
            labels.Add($"Gamme {lineNames.GetValueOrDefault(line.Key, "commune")} ×{line.Count()} : +{b * 100:0} %");
        }
        var primary = team.Where(u => u.Classes.Length > 0).Select(u => u.Classes[0]).ToList();
        if (primary.Any(c => c is ChampionClass.TANK or ChampionClass.FIGHTER)
            && primary.Any(c => c is ChampionClass.MARKSMAN or ChampionClass.MAGE)
            && team.Any(u => u.Classes.Contains(ChampionClass.SUPPORT)))
        {
            bonus += 0.05;
            labels.Add("Composition équilibrée : +5 %");
        }
        if (team.GroupBy(u => u.ChampionId).Any(g => g.Count() > 1))
        {
            bonus -= 0.10;
            labels.Add("Champion en double : −10 %");
        }
        return (bonus, labels);
    }

    /// <summary>Vis-à-vis : jungle contre jungle, chaque poste contre le même poste.</summary>
    public static (TeamReport A, TeamReport B) Analyze(IReadOnlyList<BattleUnit> a, IReadOnlyList<BattleUnit> b, IReadOnlyDictionary<int, string> lineNames) =>
        (Report(a, b, lineNames), Report(b, a, lineNames));

    /// <summary>Analyse d'une équipe seule (sans adversaire : pas de contre).</summary>
    public static TeamReport Analyze(IReadOnlyList<BattleUnit> team, IReadOnlyDictionary<int, string> lineNames) => Report(team, null, lineNames);

    private static TeamReport Report(IReadOnlyList<BattleUnit> team, IReadOnlyList<BattleUnit>? foes, IReadOnlyDictionary<int, string> lineNames)
    {
        var (bonus, labels) = Synergies(team, lineNames);
        var units = team.Select((u, i) => new UnitReport(i, u.Kind, u.ItemId, u.Champion, u.Rarity, u.Classes,
            (int)Math.Round(100 * (1 + RarityBonus(u.Rarity)) * (1 + RoleFitBonus(u, i)) * (1 + bonus)),
            (int)Math.Round(RoleFitBonus(u, i) * 100),
            foes is null ? 0 : (int)Math.Round(Counter(u, foes[i]) * CounterBonus * 100))).ToList();
        return new TeamReport(units, labels, units.Sum(u => u.Power));
    }

    public static BattleOutcome Simulate(IReadOnlyList<BattleUnit> a, IReadOnlyList<BattleUnit> b, int seed, IReadOnlyDictionary<int, string> lineNames)
    {
        if (a.Count != TeamSize || b.Count != TeamSize) throw new ArgumentException($"Il faut {TeamSize} unités par équipe.");
        var (ra, rb) = Analyze(a, b, lineNames);
        return new Game([a, b], [ra, rb], new Random(seed)).Play();
    }

    /// <summary>État d'une partie en cours.</summary>
    private sealed class Game(IReadOnlyList<BattleUnit>[] teams, TeamReport[] reports, Random rng)
    {
        private readonly int[] _kills = new int[2], _towers = new int[2], _objectives = new int[2];
        private readonly double[] _buff = new double[2];
        private readonly int[,] _unitKills = new int[2, TeamSize], _unitDeaths = new int[2, TeamSize];
        private readonly List<BattleEvent> _events = [];
        private int _minute;

        private double Power(int side, int role) => reports[side].Units[role].Power;
        private string Name(int side, int role) => teams[side][role].Champion;
        private double Gold(int side) => Math.Round(_minute * 2.0 + _kills[side] * 0.3 + _towers[side] * 0.6 + _objectives[side] * 0.5, 1);

        private bool Wins(double a, double b, double k) => rng.NextDouble() < Math.Pow(a, k) / (Math.Pow(a, k) + Math.Pow(b, k));

        private void Emit(BattleEventKind kind, int side, string text) =>
            _events.Add(new BattleEvent(_minute, kind, (BattleSide)side, text, _kills[0], _kills[1], _towers[0], _towers[1], Gold(0), Gold(1)));

        private void Kill(int side, int killer, int victim)
        {
            _kills[side]++;
            _unitKills[side, killer]++;
            _unitDeaths[1 - side, victim]++;
        }

        /// <summary>Avance l'or : multiplicateur de puissance ±15 % au plus.</summary>
        private double Lead(int side)
        {
            var (mine, theirs) = (Gold(side), Gold(1 - side));
            return 1 + Math.Clamp((mine - theirs) / Math.Max(1, mine + theirs) * 3, -0.15, 0.15);
        }

        private double CounterMult(int side, int role) => 1 + reports[side].Units[role].CounterPercent / 100.0;

        public BattleOutcome Play()
        {
            _minute = 3;
            var lanesWon = new int?[3];
            var lanes = new[] { 0, 1, 2 }.OrderBy(_ => rng.Next()).ToArray();
            foreach (var lane in lanes)
            {
                _minute += rng.Next(1, 4);
                lanesWon[lane] = PlayLane(lane);
            }

            _minute += rng.Next(2, 4);
            Objective("le premier dragon", 0.04);

            _minute += rng.Next(2, 4);
            for (var lane = 0; lane < 3; lane++)
            {
                if (lanesWon[lane] is not { } side) continue;
                _towers[side]++;
                var who = lane == 2 ? Bot : lane == 0 ? Top : Mid;
                Emit(BattleEventKind.TOWER, side, $"{Name(side, who)} fait tomber la première tour du {(lane == 2 ? "bot" : RoleNames[who])}");
            }

            _minute += rng.Next(3, 5);
            Objective("le deuxième dragon", 0.04);

            var fights = new int[2];
            var fightIndex = 0;
            while (fights[0] < 2 && fights[1] < 2)
            {
                _minute += rng.Next(3, 6);
                if (fightIndex == 2) Objective("le gardien ancien", 0.08);
                var winner = Teamfight(++fightIndex);
                fights[winner]++;
            }
            var champion = fights[0] == 2 ? 0 : 1;
            _minute += rng.Next(1, 3);
            _towers[champion] += 2;
            Emit(BattleEventKind.END, champion, "La base adverse tombe : victoire !");

            var final = new TeamReport[2];
            for (var s = 0; s < 2; s++)
                final[s] = reports[s] with { Units = reports[s].Units.Select((u, i) => u with { Kills = _unitKills[s, i], Deaths = _unitDeaths[s, i] }).ToList() };
            return new BattleOutcome((BattleSide)champion, _minute, final[0], final[1], _events);
        }

        /// <summary>Duel de lane (0 top, 1 mid, 2 bot) avec un éventuel gank ; renvoie le camp gagnant.</summary>
        private int PlayLane(int lane)
        {
            var roles = lane switch { 0 => new[] { Top }, 1 => [Mid], _ => [Bot, Support] };
            var label = lane switch { 0 => "top", 1 => "mid", _ => "bot" };
            var power = new double[2];
            for (var s = 0; s < 2; s++) power[s] = roles.Sum(r => Power(s, r) * CounterMult(s, r));

            int? ganker = null;
            if (rng.NextDouble() < 0.35)
            {
                ganker = Wins(Power(0, Jungle), Power(1, Jungle), 4) ? 0 : 1;
                power[ganker.Value] += Power(ganker.Value, Jungle) * (roles.Length == 1 ? 0.5 : 0.35);
                Emit(BattleEventKind.GANK, ganker.Value, $"{Name(ganker.Value, Jungle)} gank le {label}");
            }

            var winner = Wins(power[0], power[1], 5) ? 0 : 1;
            var killer = ganker == winner && rng.NextDouble() < 0.5 ? Jungle : roles[rng.Next(roles.Length)];
            var victim = roles[rng.Next(roles.Length)];
            var first = _kills[0] + _kills[1] == 0;
            Kill(winner, killer, victim);
            Emit(first ? BattleEventKind.FIRST_BLOOD : BattleEventKind.KILL, winner,
                first ? $"Premier sang : {Name(winner, killer)} élimine {Name(1 - winner, victim)} au {label}"
                    : $"{Name(winner, killer)} élimine {Name(1 - winner, victim)} au {label}");
            return winner;
        }

        /// <summary>Objectif neutre disputé par la jungle (et le support), avantage d'or compris ; bonus de puissance au vainqueur.</summary>
        private void Objective(string name, double buff)
        {
            var p = new double[2];
            for (var s = 0; s < 2; s++) p[s] = (Power(s, Jungle) + Power(s, Support) * 0.5) * Lead(s) * (1 + _buff[s]);
            var winner = Wins(p[0], p[1], 4) ? 0 : 1;
            _buff[winner] += buff;
            _objectives[winner]++;
            Emit(BattleEventKind.OBJECTIVE, winner, $"{Name(winner, Jungle)} sécurise {name}");
        }

        /// <summary>Teamfight : la puissance d'équipe pondérée par l'or et les objectifs décide ; renvoie le camp gagnant.</summary>
        private int Teamfight(int index)
        {
            var p = new double[2];
            // Les vis-à-vis comptent aussi en teamfight : chacun affronte surtout son contre-poste.
            for (var s = 0; s < 2; s++) p[s] = Enumerable.Range(0, TeamSize).Sum(r => Power(s, r) * CounterMult(s, r)) * Lead(s) * (1 + _buff[s]);
            var winner = Wins(p[0], p[1], 6) ? 0 : 1;
            var loser = 1 - winner;

            var winKills = rng.Next(2, 6);
            var loseKills = rng.Next(0, Math.Min(3, winKills));
            Skirmish(winner, winKills);
            Skirmish(loser, loseKills);
            var ace = winKills == TeamSize;
            _towers[winner] += ace ? 2 : 1;
            Emit(BattleEventKind.FIGHT, winner, $"Teamfight {index} remporté {winKills} à {loseKills}, la tour suivante tombe");
            if (ace) Emit(BattleEventKind.ACE, winner, "ACE : toute l'équipe adverse est à terre");
            return winner;
        }

        /// <summary>Éliminations d'un camp : victimes distinctes, auteurs tirés selon leur puissance.</summary>
        private void Skirmish(int side, int count)
        {
            var victims = Enumerable.Range(0, TeamSize).OrderBy(_ => rng.Next()).Take(count);
            var total = Enumerable.Range(0, TeamSize).Sum(r => Power(side, r));
            foreach (var victim in victims)
            {
                var roll = rng.NextDouble() * total;
                var killer = 0;
                while (killer < TeamSize - 1 && (roll -= Power(side, killer)) > 0) killer++;
                Kill(side, killer, victim);
            }
        }
    }
}
