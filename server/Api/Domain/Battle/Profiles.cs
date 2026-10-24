namespace Api.Domain.Battle;

/// <summary>Moment de la partie où un champion est le plus fort.</summary>
public enum PowerCurve { EARLY, MID, LATE }

/// <summary>Solo : duels, side lane et picks. Teamfight : combats à cinq.</summary>
public enum PlayStyle { SOLO, TEAMFIGHT }

/// <summary>Profil de combat d'un champion : poste principal, poste secondaire éventuel (index de <see cref="BattleRules.RoleNames"/>), courbe et style.</summary>
public sealed record ChampionProfile(int Main, int? Secondary, PowerCurve Curve, PlayStyle Style);

/// <summary>
/// Profils des champions, écrits à la main d'après leur place habituelle : le poste vient du champion, pas de sa classe
/// (Malphite est un tank du top, Leona une tank support). Les champions absents de la table reçoivent un profil déduit de leurs classes.
/// </summary>
public static class Profiles
{
    private const int T = BattleRules.Top, J = BattleRules.Jungle, M = BattleRules.Mid, B = BattleRules.Bot, S = BattleRules.Support;
    private const PowerCurve E = PowerCurve.EARLY, Md = PowerCurve.MID, L = PowerCurve.LATE;
    private const PlayStyle Solo = PlayStyle.SOLO, Tf = PlayStyle.TEAMFIGHT;

    private static ChampionProfile P(int main, int? secondary, PowerCurve curve, PlayStyle style) => new(main, secondary, curve, style);

    private static readonly Dictionary<string, ChampionProfile> ByAlias = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Aatrox"] = P(T, null, Md, Solo),
        ["Ahri"] = P(M, null, Md, Solo),
        ["Akali"] = P(M, T, Md, Solo),
        ["Akshan"] = P(M, T, Md, Solo),
        ["Alistar"] = P(S, J, E, Tf),
        ["Ambessa"] = P(T, J, Md, Solo),
        ["Amumu"] = P(J, S, Md, Tf),
        ["Anivia"] = P(M, null, L, Tf),
        ["Annie"] = P(M, S, Md, Tf),
        ["Aphelios"] = P(B, null, L, Tf),
        ["Ashe"] = P(B, S, Md, Tf),
        ["AurelionSol"] = P(M, null, L, Tf),
        ["Aurora"] = P(M, T, Md, Solo),
        ["Azir"] = P(M, null, L, Tf),
        ["Bard"] = P(S, null, Md, Solo),
        ["Belveth"] = P(J, null, L, Solo),
        ["Blitzcrank"] = P(S, null, E, Solo),
        ["Brand"] = P(S, M, Md, Tf),
        ["Braum"] = P(S, null, E, Tf),
        ["Briar"] = P(J, null, E, Solo),
        ["Caitlyn"] = P(B, null, E, Solo),
        ["Camille"] = P(T, null, Md, Solo),
        ["Cassiopeia"] = P(M, T, L, Tf),
        ["Chogath"] = P(T, M, L, Tf),
        ["Corki"] = P(M, B, Md, Tf),
        ["Darius"] = P(T, J, E, Solo),
        ["Diana"] = P(J, M, Md, Tf),
        ["DrMundo"] = P(T, J, L, Solo),
        ["Draven"] = P(B, null, E, Solo),
        ["Ekko"] = P(J, M, Md, Solo),
        ["Elise"] = P(J, S, E, Solo),
        ["Evelynn"] = P(J, null, Md, Solo),
        ["Ezreal"] = P(B, null, Md, Solo),
        ["Fiddlesticks"] = P(J, S, Md, Tf),
        ["Fiora"] = P(T, null, L, Solo),
        ["Fizz"] = P(M, null, Md, Solo),
        ["Galio"] = P(M, S, Md, Tf),
        ["Gangplank"] = P(T, M, L, Solo),
        ["Garen"] = P(T, null, E, Solo),
        ["Gnar"] = P(T, null, Md, Tf),
        ["Gragas"] = P(J, T, Md, Tf),
        ["Graves"] = P(J, null, E, Solo),
        ["Gwen"] = P(T, J, L, Solo),
        ["Hecarim"] = P(J, null, Md, Tf),
        ["Heimerdinger"] = P(M, S, E, Solo),
        ["Hwei"] = P(M, S, Md, Tf),
        ["Illaoi"] = P(T, null, Md, Solo),
        ["Irelia"] = P(T, M, Md, Solo),
        ["Ivern"] = P(J, null, Md, Tf),
        ["Janna"] = P(S, null, Md, Tf),
        ["JarvanIV"] = P(J, T, E, Tf),
        ["Jax"] = P(T, J, L, Solo),
        ["Jayce"] = P(T, M, E, Solo),
        ["Jhin"] = P(B, null, Md, Tf),
        ["Jinx"] = P(B, null, L, Tf),
        ["KSante"] = P(T, null, Md, Tf),
        ["Kaisa"] = P(B, null, L, Tf),
        ["Kalista"] = P(B, null, E, Solo),
        ["Karma"] = P(S, M, E, Tf),
        ["Karthus"] = P(J, M, L, Tf),
        ["Kassadin"] = P(M, null, L, Solo),
        ["Katarina"] = P(M, null, Md, Tf),
        ["Kayle"] = P(T, null, L, Tf),
        ["Kayn"] = P(J, null, Md, Solo),
        ["Kennen"] = P(T, M, Md, Tf),
        ["Khazix"] = P(J, null, Md, Solo),
        ["Kindred"] = P(J, null, L, Solo),
        ["Kled"] = P(T, null, E, Solo),
        ["KogMaw"] = P(B, null, L, Tf),
        ["Leblanc"] = P(M, null, E, Solo),
        ["LeeSin"] = P(J, T, E, Solo),
        ["Leona"] = P(S, null, E, Tf),
        ["Lillia"] = P(J, T, Md, Tf),
        ["Lissandra"] = P(M, null, Md, Tf),
        ["Lucian"] = P(B, M, E, Solo),
        ["Lulu"] = P(S, null, Md, Tf),
        ["Lux"] = P(S, M, Md, Tf),
        ["Malphite"] = P(T, S, L, Tf),
        ["Malzahar"] = P(M, null, Md, Solo),
        ["Maokai"] = P(S, J, Md, Tf),
        ["MasterYi"] = P(J, null, L, Solo),
        ["Mel"] = P(M, null, Md, Tf),
        ["Milio"] = P(S, null, L, Tf),
        ["MissFortune"] = P(B, null, E, Tf),
        ["MonkeyKing"] = P(T, J, Md, Tf),
        ["Mordekaiser"] = P(T, null, Md, Solo),
        ["Morgana"] = P(S, M, Md, Tf),
        ["Naafiri"] = P(M, J, E, Solo),
        ["Nami"] = P(S, null, E, Tf),
        ["Nasus"] = P(T, null, L, Solo),
        ["Nautilus"] = P(S, J, E, Tf),
        ["Neeko"] = P(M, S, Md, Tf),
        ["Nidalee"] = P(J, null, E, Solo),
        ["Nilah"] = P(B, null, L, Tf),
        ["Nocturne"] = P(J, M, Md, Solo),
        ["Nunu"] = P(J, null, Md, Tf),
        ["Olaf"] = P(J, T, E, Solo),
        ["Orianna"] = P(M, null, Md, Tf),
        ["Ornn"] = P(T, null, L, Tf),
        ["Pantheon"] = P(T, S, E, Solo),
        ["Poppy"] = P(T, S, Md, Solo),
        ["Pyke"] = P(S, null, E, Solo),
        ["Qiyana"] = P(M, J, Md, Tf),
        ["Quinn"] = P(T, null, E, Solo),
        ["Rakan"] = P(S, null, Md, Tf),
        ["Rammus"] = P(J, null, Md, Tf),
        ["RekSai"] = P(J, null, E, Solo),
        ["Rell"] = P(S, null, Md, Tf),
        ["Renata"] = P(S, null, Md, Tf),
        ["Renekton"] = P(T, null, E, Solo),
        ["Rengar"] = P(J, T, Md, Solo),
        ["Riven"] = P(T, null, Md, Solo),
        ["Rumble"] = P(T, M, Md, Tf),
        ["Ryze"] = P(M, T, L, Solo),
        ["Samira"] = P(B, null, Md, Tf),
        ["Sejuani"] = P(J, null, Md, Tf),
        ["Senna"] = P(S, B, L, Tf),
        ["Seraphine"] = P(S, M, L, Tf),
        ["Sett"] = P(T, S, E, Solo),
        ["Shaco"] = P(J, S, E, Solo),
        ["Shen"] = P(T, S, Md, Solo),
        ["Shyvana"] = P(J, null, Md, Tf),
        ["Singed"] = P(T, null, Md, Solo),
        ["Sion"] = P(T, null, L, Tf),
        ["Sivir"] = P(B, null, Md, Tf),
        ["Skarner"] = P(J, T, Md, Solo),
        ["Smolder"] = P(B, M, L, Tf),
        ["Sona"] = P(S, null, L, Tf),
        ["Soraka"] = P(S, null, Md, Tf),
        ["Swain"] = P(S, M, Md, Tf),
        ["Sylas"] = P(M, J, Md, Solo),
        ["Syndra"] = P(M, null, Md, Solo),
        ["TahmKench"] = P(T, S, Md, Tf),
        ["Taliyah"] = P(J, M, E, Solo),
        ["Talon"] = P(M, J, E, Solo),
        ["Taric"] = P(S, null, Md, Tf),
        ["Teemo"] = P(T, null, E, Solo),
        ["Thresh"] = P(S, null, Md, Solo),
        ["Tristana"] = P(B, M, L, Solo),
        ["Trundle"] = P(J, T, E, Solo),
        ["Tryndamere"] = P(T, null, L, Solo),
        ["TwistedFate"] = P(M, null, Md, Solo),
        ["Twitch"] = P(B, J, L, Tf),
        ["Udyr"] = P(J, T, E, Solo),
        ["Urgot"] = P(T, null, Md, Solo),
        ["Varus"] = P(B, M, Md, Tf),
        ["Vayne"] = P(B, T, L, Solo),
        ["Veigar"] = P(M, null, L, Tf),
        ["Velkoz"] = P(S, M, Md, Tf),
        ["Vex"] = P(M, null, Md, Tf),
        ["Vi"] = P(J, null, E, Solo),
        ["Viego"] = P(J, null, Md, Solo),
        ["Viktor"] = P(M, null, L, Tf),
        ["Vladimir"] = P(M, T, L, Tf),
        ["Volibear"] = P(T, J, E, Solo),
        ["Warwick"] = P(J, T, E, Solo),
        ["Xayah"] = P(B, null, Md, Tf),
        ["Xerath"] = P(M, S, Md, Tf),
        ["XinZhao"] = P(J, null, E, Solo),
        ["Yasuo"] = P(M, T, Md, Tf),
        ["Yone"] = P(M, T, L, Tf),
        ["Yorick"] = P(T, null, Md, Solo),
        ["Yunara"] = P(B, null, L, Tf),
        ["Yuumi"] = P(S, null, L, Tf),
        ["Zaahen"] = P(T, J, Md, Solo),
        ["Zac"] = P(J, T, Md, Tf),
        ["Zed"] = P(M, null, Md, Solo),
        ["Zeri"] = P(B, null, L, Tf),
        ["Ziggs"] = P(M, B, Md, Tf),
        ["Zilean"] = P(S, M, L, Tf),
        ["Zoe"] = P(M, null, Md, Solo),
        ["Zyra"] = P(S, null, Md, Tf),
    };

    public static bool IsMapped(string alias) => ByAlias.ContainsKey(alias);

    /// <summary>Profil d'un champion ; absent de la table, déduit de ses classes (null sans classe connue).</summary>
    public static ChampionProfile? For(string alias, ChampionClass[] classes) => ByAlias.GetValueOrDefault(alias) ?? Fallback(classes);

    /// <summary>Poste habituel de la classe principale, poste secondaire de la deuxième classe, courbe mid.</summary>
    public static ChampionProfile? Fallback(ChampionClass[] classes)
    {
        if (classes.Length == 0) return null;
        var main = Home(classes[0]);
        int? secondary = classes.Length > 1 && Home(classes[1]) != main ? Home(classes[1]) : Second(classes[0]);
        var style = classes[0] is ChampionClass.FIGHTER or ChampionClass.ASSASSIN ? PlayStyle.SOLO : PlayStyle.TEAMFIGHT;
        return new ChampionProfile(main, secondary, PowerCurve.MID, style);
    }

    private static int Home(ChampionClass c) => c switch
    {
        ChampionClass.FIGHTER or ChampionClass.TANK => T,
        ChampionClass.ASSASSIN or ChampionClass.MAGE => M,
        ChampionClass.MARKSMAN => B,
        _ => S,
    };

    private static int? Second(ChampionClass c) => c switch
    {
        ChampionClass.FIGHTER or ChampionClass.ASSASSIN => J,
        ChampionClass.TANK or ChampionClass.MAGE => S,
        _ => null,
    };
}
