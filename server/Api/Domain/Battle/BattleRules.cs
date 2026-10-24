using Api.Domain.Capsules;

namespace Api.Domain.Battle;

/// <summary>Classe d'un champion (rôles CommunityDragon), la première est la principale.</summary>
public enum ChampionClass { ASSASSIN, MAGE, MARKSMAN, TANK, FIGHTER, SUPPORT }

public enum BattleSide { A, B }

public enum BattleEventKind { GANK, FIRST_BLOOD, KILL, TOWER, OBJECTIVE, FIGHT, ACE, END, TALENT }

/// <summary>Objet du roster engagé au combat. Sans profil, celui-ci est déduit des classes.</summary>
public sealed record BattleUnit(
    CapsuleItemKind Kind, int ItemId, string Champion, int ChampionId, Rarity Rarity, ChampionClass[] Classes, int[] Lines, Talent? Talent = null,
    ChampionProfile? Profile = null);

/// <summary>Bilan d'une unité : puissance, bonus de poste et de contre de classe en teamfight (en %), talent, profil, éliminations.</summary>
public sealed record UnitReport(
    int Role, CapsuleItemKind Kind, int ItemId, string Champion, Rarity Rarity, ChampionClass[] Classes,
    int Power, int FitPercent, int CounterPercent, int Kills = 0, int Deaths = 0, Talent? Talent = null, ChampionProfile? Profile = null);

/// <summary>Bilan d'une équipe ; FightPercent = bonus ou malus de composition en teamfight.</summary>
public sealed record TeamReport(List<UnitReport> Units, List<string> Synergies, int Power, int FightPercent = 0);

/// <summary>
/// Événement de la partie, avec le score après l'événement (or en milliers). Pour l'animation : Icon = sort utilisé (talent),
/// Actor = poste de l'auteur (camp Side), Target = poste de la cible (camp adverse), Place = lieu (top, mid, bot, dragon, ancient,
/// fight-dragon, fight-mid, fight-ancient pour les teamfights, base),
/// Down = postes adverses éliminés et Lost = postes perdus par le camp Side (teamfight).
/// </summary>
public sealed record BattleEvent(
    int Minute, BattleEventKind Kind, BattleSide Side, string Text, int KillsA, int KillsB, int TowersA, int TowersB, double GoldA, double GoldB,
    string? Icon = null, int? Actor = null, int? Target = null, string? Place = null, int[]? Down = null, int[]? Lost = null);

public sealed record BattleOutcome(BattleSide Winner, int Minutes, TeamReport A, TeamReport B, List<BattleEvent> Events);

/// <summary>
/// Partie simulée entre deux rosters (TOP, JUNGLE, MID, BOT, SUPPORT) : phase de lanes, objectifs, puis teamfights au meilleur des 3.
/// La stratégie vient de la composition : champion à son poste (<see cref="Profiles"/>), courbe early / mid / late selon la phase,
/// style solo ou teamfight, besoins et contres de classe en teamfight, synergies d'équipe, et le talent de chaque champion
/// (<see cref="Talents"/>). Tous les champions peuvent jouer partout, hors poste avec un malus. Déterministe pour un seed donné.
/// </summary>
public static class BattleRules
{
    public const int TeamSize = 5;
    public const int Top = 0, Jungle = 1, Mid = 2, Bot = 3, Support = 4;
    public const double MainRoleBonus = 0.12, SecondaryRoleBonus = 0.08, OffRolePenalty = -0.10;
    public const int CounterCap = 12;

    public static readonly string[] RoleNames = ["top", "jungle", "mid", "bot", "support"];

    /// <summary>Multiplicateur de la courbe [courbe, phase] : phase 0 = lanes, 1 = objectifs et premier teamfight, 2 = teamfights suivants.</summary>
    private static readonly double[,] CurveMult =
    {
        { 1.18, 1.02, 0.88 },
        { 0.98, 1.08, 0.98 },
        { 0.88, 0.98, 1.18 },
    };

    /// <summary>Style en lane (duels) et en teamfight.</summary>
    private const double SoloLane = 1.10, SoloFight = 0.97, TeamfightLane = 0.95, TeamfightFight = 1.04;

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

    public static ChampionProfile? ProfileOf(BattleUnit unit) => unit.Profile ?? Profiles.Fallback(unit.Classes);

    /// <summary>Poste principal +12 %, poste secondaire +8 %, ailleurs −10 % (profil inconnu : neutre).</summary>
    public static double RoleFitBonus(BattleUnit unit, int role) => ProfileOf(unit) switch
    {
        null => 0,
        var p when p.Main == role => MainRoleBonus,
        var p when p.Secondary == role => SecondaryRoleBonus,
        _ => OffRolePenalty,
    };

    /// <summary>
    /// Multiplicateur de courbe et de style d'une unité. Phase 0 = lanes (style de duel), 1 = objectifs et premier teamfight,
    /// 2 = teamfights suivants ; <paramref name="fight"/> applique le style de teamfight.
    /// </summary>
    public static double PhaseMult(BattleUnit unit, int phase, bool fight)
    {
        if (ProfileOf(unit) is not { } p) return 1;
        var style = phase == 0 ? (p.Style == PlayStyle.SOLO ? SoloLane : TeamfightLane)
            : fight ? (p.Style == PlayStyle.SOLO ? SoloFight : TeamfightFight) : 1;
        return CurveMult[(int)p.Curve, phase] * style;
    }

    private static ChampionClass? Primary(BattleUnit u) => u.Classes.Length > 0 ? u.Classes[0] : null;

    /// <summary>
    /// Contre de classe en teamfight (en %, plafonné), face à toute la composition adverse : l'assassin plonge sur les carrys mal protégés,
    /// le tireur fait fondre la frontline, le mage ravage une équipe de mêlée groupée, le tank encaisse assassins et combattants,
    /// le combattant écrase les cibles fragiles au contact, le support protège des assassins.
    /// </summary>
    public static int ClassCounter(BattleUnit unit, IReadOnlyList<BattleUnit> foes)
    {
        var p = foes.Select(Primary).ToList();
        int Count(params ChampionClass[] cs) => p.Count(c => c is { } x && cs.Contains(x));
        var peel = foes.Count(f => f.Classes.Contains(ChampionClass.SUPPORT) || Primary(f) == ChampionClass.TANK);
        var percent = Primary(unit) switch
        {
            ChampionClass.ASSASSIN => 4 * Math.Max(0, Count(ChampionClass.MARKSMAN, ChampionClass.MAGE) - peel + 1),
            ChampionClass.MARKSMAN => 4 * Count(ChampionClass.TANK, ChampionClass.FIGHTER),
            ChampionClass.MAGE => Count(ChampionClass.TANK, ChampionClass.FIGHTER, ChampionClass.ASSASSIN) >= 3 ? 8 : 0,
            ChampionClass.TANK => 3 * Count(ChampionClass.ASSASSIN, ChampionClass.FIGHTER),
            ChampionClass.FIGHTER => 3 * Count(ChampionClass.MAGE, ChampionClass.ASSASSIN),
            ChampionClass.SUPPORT => 4 * Count(ChampionClass.ASSASSIN) + 2 * Count(ChampionClass.FIGHTER),
            _ => 0,
        };
        return Math.Min(CounterCap, percent);
    }

    /// <summary>
    /// Besoins de composition en teamfight (bonus total et libellés) : une frontline, des dégâts, de la protection ou de l'engage,
    /// et le style dominant (au moins 3 champions teamfight). Au moins 2 champions solo mettent la pression en side lane.
    /// </summary>
    public static (double Bonus, List<string> Labels) Composition(IReadOnlyList<BattleUnit> team)
    {
        var bonus = 0.0;
        var labels = new List<string>();
        if (team.All(u => u.Classes.Length == 0 && u.Profile is null)) return (0, labels);
        if (!team.Any(u => Primary(u) is ChampionClass.TANK or ChampionClass.FIGHTER || u.Classes.Contains(ChampionClass.TANK)))
        {
            bonus -= 0.10;
            labels.Add("Pas de frontline : −10 % en teamfight");
        }
        if (!team.Any(u => Primary(u) is ChampionClass.MARKSMAN or ChampionClass.MAGE or ChampionClass.ASSASSIN))
        {
            bonus -= 0.10;
            labels.Add("Pas de dégâts : −10 % en teamfight");
        }
        if (!team.Any(u => u.Classes.Contains(ChampionClass.SUPPORT) || Primary(u) == ChampionClass.TANK))
        {
            bonus -= 0.05;
            labels.Add("Ni protection ni engage : −5 % en teamfight");
        }
        if (team.Count(u => ProfileOf(u)?.Style == PlayStyle.TEAMFIGHT) >= 3)
        {
            bonus += 0.05;
            labels.Add("Comp teamfight : +5 % en teamfight");
        }
        if (SplitPushers(team).Count >= 2) labels.Add("Split-push : une tour de plus par teamfight");
        return (bonus, labels);
    }

    /// <summary>Postes des champions solo ; à partir de 2, l'équipe met la pression en side lane.</summary>
    public static List<int> SplitPushers(IReadOnlyList<BattleUnit> team) =>
        Enumerable.Range(0, team.Count).Where(r => ProfileOf(team[r])?.Style == PlayStyle.SOLO).ToList();

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
        if (team.GroupBy(u => u.ChampionId).Any(g => g.Count() > 1))
        {
            bonus -= 0.10;
            labels.Add("Champion en double : −10 %");
        }
        return (bonus, labels);
    }

    /// <summary>Vis-à-vis : jungle contre jungle, chaque poste contre le même poste. Les talents volés (Sylas) sont résolus ici.</summary>
    public static (TeamReport A, TeamReport B) Analyze(IReadOnlyList<BattleUnit> a, IReadOnlyList<BattleUnit> b, IReadOnlyDictionary<int, string> lineNames)
    {
        var (ra, rb) = (Report(a, b, lineNames), Report(b, a, lineNames));
        return (ResolveSteal(ra, rb), ResolveSteal(rb, ra));
    }

    /// <summary>Analyse d'une équipe seule (sans adversaire : pas de contre).</summary>
    public static TeamReport Analyze(IReadOnlyList<BattleUnit> team, IReadOnlyDictionary<int, string> lineNames) => Report(team, null, lineNames);

    private static TeamReport Report(IReadOnlyList<BattleUnit> team, IReadOnlyList<BattleUnit>? foes, IReadOnlyDictionary<int, string> lineNames)
    {
        var (bonus, labels) = Synergies(team, lineNames);
        var (fight, fightLabels) = Composition(team);
        var units = team.Select((u, i) => new UnitReport(i, u.Kind, u.ItemId, u.Champion, u.Rarity, u.Classes,
            (int)Math.Round(100 * (1 + RarityBonus(u.Rarity)) * (1 + RoleFitBonus(u, i)) * (1 + bonus)),
            (int)Math.Round(RoleFitBonus(u, i) * 100),
            foes is null ? 0 : ClassCounter(u, foes),
            Talent: u.Talent, Profile: ProfileOf(u))).ToList();
        return new TeamReport(units, [.. labels, .. fightLabels], units.Sum(u => u.Power), (int)Math.Round(fight * 100));
    }

    /// <summary>Un talent de vol copie le talent de l'adversaire le plus puissant (hors vol), sous son propre nom de sort.</summary>
    private static TeamReport ResolveSteal(TeamReport team, TeamReport foes)
    {
        if (!team.Units.Any(u => u.Talent?.Effect == TalentEffect.STEAL)) return team;
        var target = foes.Units.Where(u => u.Talent is { } t && t.Effect != TalentEffect.STEAL).OrderByDescending(u => u.Power).FirstOrDefault();
        if (target is null) return team;
        var stolen = target.Talent!;
        return team with
        {
            Units = team.Units.Select(u => u.Talent is { Effect: TalentEffect.STEAL } t
                ? u with { Talent = t with { Effect = stolen.Effect, Description = $"Vole « {stolen.Spell} » de {target.Champion} : {stolen.Description}" } }
                : u).ToList(),
        };
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
        private readonly bool[] _revived = new bool[2];
        private readonly int[,] _unitKills = new int[2, TeamSize], _unitDeaths = new int[2, TeamSize];
        private readonly List<BattleEvent> _events = [];
        private int _minute;
        private int? _lastFightWinner;

        private double Power(int side, int role) => reports[side].Units[role].Power;
        private string Name(int side, int role) => teams[side][role].Champion;
        private Talent? TalentOf(int side, int role) => reports[side].Units[role].Talent;
        private bool Has(int side, int role, TalentEffect effect) => TalentOf(side, role)?.Effect == effect;
        private IEnumerable<int> With(int side, TalentEffect effect) => Enumerable.Range(0, TeamSize).Where(r => Has(side, r, effect));
        private double Gold(int side) => Math.Round(_minute * 2.0 + _kills[side] * 0.3 + _towers[side] * 0.6 + _objectives[side] * 0.5, 1);

        private bool Wins(double a, double b, double k) => rng.NextDouble() < Math.Pow(a, k) / (Math.Pow(a, k) + Math.Pow(b, k));

        private void Emit(BattleEventKind kind, int side, string text, string? icon = null,
            int? actor = null, int? target = null, string? place = null, int[]? down = null, int[]? lost = null) =>
            _events.Add(new BattleEvent(_minute, kind, (BattleSide)side, text, _kills[0], _kills[1], _towers[0], _towers[1], Gold(0), Gold(1),
                icon, actor, target, place, down, lost));

        /// <summary>Événement de talent : « {champion} … {sort} », avec l'icône du sort.</summary>
        private void EmitTalent(int side, int role, string text, int? target = null, string? place = null) =>
            Emit(BattleEventKind.TALENT, side, text, TalentOf(side, role)?.Icon, role, target, place);

        private static readonly string[] LaneNames = ["top", "mid", "bot"];

        private string Spell(int side, int role) => TalentOf(side, role)?.Spell ?? "son ultime";

        private void Kill(int side, int killer, int victim)
        {
            _kills[side]++;
            _unitKills[side, killer]++;
            _unitDeaths[1 - side, victim]++;
        }

        /// <summary>Avance l'or : multiplicateur de puissance ±15 % au plus ; un talent de soin divise le retard par deux.</summary>
        private double Lead(int side)
        {
            var (mine, theirs) = (Gold(side), Gold(1 - side));
            var lead = 1 + Math.Clamp((mine - theirs) / Math.Max(1, mine + theirs) * 3, -0.15, 0.15);
            return lead < 1 && With(side, TalentEffect.SUSTAIN).Any() ? 1 - (1 - lead) / 2 : lead;
        }

        private double CounterMult(int side, int role) => 1 + reports[side].Units[role].CounterPercent / 100.0;

        private double At(int side, int role, int phase, bool fight = false) => PhaseMult(teams[side][role], phase, fight);

        public BattleOutcome Play()
        {
            _minute = 3;
            var lanesWon = new int?[3];
            var lanes = new[] { 0, 1, 2 }.OrderBy(_ => rng.Next()).ToArray();
            var roams = PlanRoams();
            foreach (var lane in lanes)
            {
                _minute += rng.Next(1, 4);
                lanesWon[lane] = PlayLane(lane, roams.Where(r => r.Lane == lane).ToList());
            }

            _minute += rng.Next(2, 4);
            Objective("le premier dragon", 0.04, "dragon");

            _minute += rng.Next(2, 4);
            for (var lane = 0; lane < 3; lane++)
            {
                if (lanesWon[lane] is not { } side) continue;
                _towers[side]++;
                var who = lane == 2 ? Bot : lane == 0 ? Top : Mid;
                Emit(BattleEventKind.TOWER, side, $"{Name(side, who)} fait tomber la première tour du {(lane == 2 ? "bot" : RoleNames[who])}",
                    actor: who, place: LaneNames[lane]);
            }
            for (var side = 0; side < 2; side++)
            {
                if (!lanesWon.Contains(side)) continue;
                foreach (var r in With(side, TalentEffect.POKE))
                {
                    _towers[side]++;
                    EmitTalent(side, r, $"{Name(side, r)} assiège une tour de plus avec {Spell(side, r)}", place: LaneNames[lanesWon.ToList().IndexOf(side)]);
                }
            }

            _minute += rng.Next(3, 5);
            Objective("le deuxième dragon", 0.04, "dragon");

            var fights = new int[2];
            var fightIndex = 0;
            while (fights[0] < 2 && fights[1] < 2)
            {
                _minute += rng.Next(3, 6);
                if (fightIndex == 2) Objective("le gardien ancien", 0.08, "ancient");
                var winner = Teamfight(++fightIndex);
                fights[winner]++;
            }
            var champion = fights[0] == 2 ? 0 : 1;
            _minute += rng.Next(1, 3);
            _towers[champion] += 2;
            Emit(BattleEventKind.END, champion, "La base adverse tombe : victoire !", place: "base");

            var final = new TeamReport[2];
            for (var s = 0; s < 2; s++)
                final[s] = reports[s] with { Units = reports[s].Units.Select((u, i) => u with { Kills = _unitKills[s, i], Deaths = _unitDeaths[s, i] }).ToList() };
            return new BattleOutcome((BattleSide)champion, _minute, final[0], final[1], _events);
        }

        /// <summary>Talents globaux : chaque porteur rejoint une autre lane (0 top, 1 mid, 2 bot) que la sienne.</summary>
        private List<(int Side, int Role, int Lane)> PlanRoams()
        {
            var roams = new List<(int, int, int)>();
            for (var s = 0; s < 2; s++)
                foreach (var r in With(s, TalentEffect.GLOBAL))
                {
                    int? own = r switch { Top => 0, Mid => 1, Bot or Support => 2, _ => null };
                    var options = new[] { 0, 1, 2 }.Where(l => l != own).ToArray();
                    roams.Add((s, r, options[rng.Next(options.Length)]));
                }
            return roams;
        }

        /// <summary>Duel de lane (0 top, 1 mid, 2 bot) avec un éventuel gank et les renforts globaux ; renvoie le camp gagnant.</summary>
        private int PlayLane(int lane, List<(int Side, int Role, int Lane)> roams)
        {
            var roles = lane switch { 0 => new[] { Top }, 1 => [Mid], _ => [Bot, Support] };
            var label = lane switch { 0 => "top", 1 => "mid", _ => "bot" };
            var power = new double[2];
            for (var s = 0; s < 2; s++)
                power[s] = roles.Sum(r => Power(s, r) * At(s, r, 0)
                    * (Has(s, r, TalentEffect.LANE_DOMINANCE) ? 1.25 : 1) * (Has(s, r, TalentEffect.SCALING) ? 0.93 : 1));

            foreach (var (s, r, _) in roams)
            {
                power[s] += Power(s, r) * At(s, r, 0) * 0.4;
                EmitTalent(s, r, $"{Name(s, r)} utilise {Spell(s, r)} et rejoint le {label}", place: label);
            }

            int? ganker = null;
            var gankTalent = new[] { Has(0, Jungle, TalentEffect.GANK), Has(1, Jungle, TalentEffect.GANK) };
            if (rng.NextDouble() < (gankTalent[0] || gankTalent[1] ? 0.5 : 0.35))
            {
                ganker = Wins(Power(0, Jungle) * At(0, Jungle, 0) * (gankTalent[0] ? 1.6 : 1), Power(1, Jungle) * At(1, Jungle, 0) * (gankTalent[1] ? 1.6 : 1), 4) ? 0 : 1;
                var g = ganker.Value;
                power[g] += Power(g, Jungle) * At(g, Jungle, 0) * (roles.Length == 1 ? 0.5 : 0.35) * (gankTalent[g] ? 1.35 : 1);
                if (gankTalent[g]) EmitTalent(g, Jungle, $"{Name(g, Jungle)} surgit au {label} avec {Spell(g, Jungle)}", place: label);
                else Emit(BattleEventKind.GANK, g, $"{Name(g, Jungle)} gank le {label}", actor: Jungle, place: label);
            }

            var winner = Wins(power[0], power[1], 5) ? 0 : 1;
            var killer = ganker == winner && rng.NextDouble() < 0.5 ? Jungle : roles[rng.Next(roles.Length)];
            var victim = roles[rng.Next(roles.Length)];
            var first = _kills[0] + _kills[1] == 0;
            Kill(winner, killer, victim);
            var dominance = Has(winner, killer, TalentEffect.LANE_DOMINANCE);
            var text = first ? $"Premier sang : {Name(winner, killer)} élimine {Name(1 - winner, victim)} au {label}"
                : $"{Name(winner, killer)} élimine {Name(1 - winner, victim)} au {label}";
            Emit(first ? BattleEventKind.FIRST_BLOOD : BattleEventKind.KILL, winner,
                dominance ? $"{text} grâce à {Spell(winner, killer)}" : text, dominance ? TalentOf(winner, killer)?.Icon : null,
                actor: killer, target: victim, place: label);
            return winner;
        }

        /// <summary>Objectif neutre disputé par la jungle (et le support), avantage d'or compris ; bonus de puissance au vainqueur.</summary>
        private void Objective(string name, double buff, string place)
        {
            var p = new double[2];
            for (var s = 0; s < 2; s++)
                p[s] = (Power(s, Jungle) * At(s, Jungle, 1) + Power(s, Support) * At(s, Support, 1) * 0.5) * Lead(s) * (1 + _buff[s]) * (With(s, TalentEffect.OBJECTIVE).Any() ? 1.2 : 1);
            var winner = Wins(p[0], p[1], 4) ? 0 : 1;
            _buff[winner] += buff;
            _objectives[winner]++;
            if (With(winner, TalentEffect.OBJECTIVE).FirstOrDefault(-1) is var r and >= 0)
                EmitTalent(winner, r, $"{Name(winner, r)} sécurise {name} avec {Spell(winner, r)}", place: place);
            else Emit(BattleEventKind.OBJECTIVE, winner, $"{Name(winner, Jungle)} sécurise {name}", actor: Jungle, place: place);
        }

        /// <summary>Teamfight : la puissance d'équipe pondérée par l'or, les objectifs et les talents décide ; renvoie le camp gagnant.</summary>
        private int Teamfight(int index)
        {
            var down = new[] { new HashSet<int>(), new HashSet<int>() };
            var place = index switch { 1 => "fight-dragon", 2 => "fight-mid", _ => "fight-ancient" };

            // Avant le combat : un adversaire attrapé ne participe pas.
            for (var s = 0; s < 2; s++)
            {
                if (With(s, TalentEffect.PICK).FirstOrDefault(-1) is not (var r and >= 0) || rng.NextDouble() >= 0.25) continue;
                var victim = rng.Next(TeamSize);
                if (!down[1 - s].Add(victim)) continue;
                Kill(s, r, victim);
                EmitTalent(s, r, $"{Name(s, r)} attrape {Name(1 - s, victim)} avec {Spell(s, r)}", victim, place);
            }
            var mult = new[] { 1.0, 1.0 };
            for (var s = 0; s < 2; s++)
            {
                if (index == 1)
                    foreach (var r in With(s, TalentEffect.ENGAGE))
                    {
                        mult[s] *= 1.10;
                        EmitTalent(s, r, $"{Name(s, r)} engage avec {Spell(s, r)}", place: place);
                    }
                mult[s] *= Math.Pow(1.05, With(s, TalentEffect.TEAMFIGHT).Count())
                    * Math.Pow(1.03, With(s, TalentEffect.PROTECT).Count())
                    * Math.Pow(1.04, With(s, TalentEffect.EXECUTE).Count())
                    * Math.Pow(1.04, With(s, TalentEffect.SUSTAIN).Count())
                    * Math.Pow(1.02, With(s, TalentEffect.LANE_DOMINANCE).Count())
                    * Math.Pow(_lastFightWinner == s ? 1.10 : 1.03, With(s, TalentEffect.HYPERCARRY).Count())
                    * (index == 3 ? Math.Pow(1.05, With(s, TalentEffect.SPLITPUSH).Count()) : 1);
            }

            // Courbe : le premier teamfight est en mid game, les suivants en late game. Contres de classe et besoins de composition.
            var phase = index == 1 ? 1 : 2;
            var p = new double[2];
            for (var s = 0; s < 2; s++)
                p[s] = Enumerable.Range(0, TeamSize).Where(r => !down[s].Contains(r))
                    .Sum(r => Power(s, r) * CounterMult(s, r) * At(s, r, phase, fight: true) * (Has(s, r, TalentEffect.SCALING) ? 1 + 0.12 * index : 1))
                    * Lead(s) * (1 + _buff[s]) * mult[s] * (1 + reports[s].FightPercent / 100.0);
            var winner = Wins(p[0], p[1], 6) ? 0 : 1;

            // Une fois par partie, un talent de résurrection peut renverser un combat perdu.
            if (!_revived[1 - winner] && With(1 - winner, TalentEffect.REVIVE).FirstOrDefault(-1) is var rv and >= 0 && rng.NextDouble() < 0.18)
            {
                _revived[1 - winner] = true;
                winner = 1 - winner;
                EmitTalent(winner, rv, $"{Name(winner, rv)} : {Spell(winner, rv)} ! Le combat bascule", place: place);
            }
            var loser = 1 - winner;

            var alive = Enumerable.Range(0, TeamSize).Where(r => !down[loser].Contains(r)).ToList();
            var winKills = Math.Min(alive.Count, rng.Next(2, 6) - With(loser, TalentEffect.PROTECT).Count());
            winKills = Math.Max(1, winKills);
            var loseKills = Math.Max(0, rng.Next(0, Math.Min(3, winKills)) - With(winner, TalentEffect.PROTECT).Count());
            var victims = alive.OrderBy(_ => rng.Next()).Take(winKills).ToList();
            var fallen = Enumerable.Range(0, TeamSize).Where(r => !down[winner].Contains(r)).OrderBy(_ => rng.Next()).Take(loseKills).ToList();
            Skirmish(winner, victims.Take(winKills - Bonus(winner, victims)).ToList());
            Skirmish(loser, fallen);
            var ace = down[loser].Count + winKills >= TeamSize;
            _towers[winner] += ace ? 2 : 1;
            Emit(BattleEventKind.FIGHT, winner, $"Teamfight {index} remporté {winKills} à {loseKills}, la tour suivante tombe",
                place: place, down: [.. victims], lost: [.. fallen]);
            CreditBonusKills(winner, victims);
            foreach (var r in With(winner, TalentEffect.PROTECT).Take(1))
                EmitTalent(winner, r, $"{Name(winner, r)} protège un allié avec {Spell(winner, r)}", place: place);
            if (ace) Emit(BattleEventKind.ACE, winner, "ACE : toute l'équipe adverse est à terre", place: place);

            for (var s = 0; s < 2; s++)
                foreach (var r in With(s, TalentEffect.SPLITPUSH))
                {
                    _towers[s]++;
                    EmitTalent(s, r, $"{Name(s, r)} fait tomber une tour en side lane avec {Spell(s, r)}", place: r == Bot || r == Support ? "bot" : "top");
                }
            for (var s = 0; s < 2; s++)
            {
                var solos = SplitPushers(teams[s]);
                if (solos.Count < 2) continue;
                var r = solos[rng.Next(solos.Count)];
                _towers[s]++;
                Emit(BattleEventKind.TOWER, s, $"Pression en side lane : {Name(s, r)} fait tomber une tour", actor: r, place: r == Bot || r == Support ? "bot" : "top");
            }
            _lastFightWinner = winner;
            return winner;
        }

        /// <summary>Éliminations réservées aux talents d'exécution et d'enchaînement du vainqueur (une chacun, dans la limite des victimes).</summary>
        private int Bonus(int side, List<int> victims) =>
            Math.Min(victims.Count - 1, With(side, TalentEffect.EXECUTE).Concat(With(side, TalentEffect.HYPERCARRY)).Take(2).Count());

        private void CreditBonusKills(int side, List<int> victims)
        {
            var bonus = Bonus(side, victims);
            var finishers = With(side, TalentEffect.EXECUTE).Concat(With(side, TalentEffect.HYPERCARRY)).Take(bonus).ToList();
            for (var i = 0; i < finishers.Count; i++)
            {
                var (r, victim) = (finishers[i], victims[victims.Count - bonus + i]);
                Kill(side, r, victim);
                EmitTalent(side, r, Has(side, r, TalentEffect.EXECUTE)
                    ? $"{Name(side, r)} achève {Name(1 - side, victim)} avec {Spell(side, r)}"
                    : $"{Name(side, r)} enchaîne sur {Name(1 - side, victim)} avec {Spell(side, r)}", victim);
            }
        }

        /// <summary>Éliminations d'un camp sur les victimes données, auteurs tirés selon leur puissance.</summary>
        private void Skirmish(int side, List<int> victims)
        {
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
