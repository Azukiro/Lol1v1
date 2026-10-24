namespace Api.Domain.Battle;

/// <summary>Mécanique de combat d'un talent ; chaque champion en reçoit une, tirée du sort qui fait son identité.</summary>
public enum TalentEffect
{
    /// <summary>Gagne plus souvent son duel de lane.</summary>
    LANE_DOMINANCE,
    /// <summary>Ganks plus fréquents et plus forts (depuis la jungle).</summary>
    GANK,
    /// <summary>Rejoint une autre lane pendant la phase de lanes.</summary>
    GLOBAL,
    /// <summary>Sécurise mieux les objectifs neutres.</summary>
    OBJECTIVE,
    /// <summary>Lance le premier teamfight.</summary>
    ENGAGE,
    /// <summary>Dégâts de zone à chaque teamfight.</summary>
    TEAMFIGHT,
    /// <summary>Attrape un adversaire avant le teamfight.</summary>
    PICK,
    /// <summary>Sauve un allié à chaque teamfight.</summary>
    PROTECT,
    /// <summary>Une fois par partie, peut renverser un teamfight perdu.</summary>
    REVIVE,
    /// <summary>Faible en lane, de plus en plus fort ensuite.</summary>
    SCALING,
    /// <summary>Achève un adversaire de plus quand son équipe gagne un teamfight.</summary>
    EXECUTE,
    /// <summary>Fait tomber des tours en side lane pendant que les autres combattent.</summary>
    SPLITPUSH,
    /// <summary>Assiège les tours à distance.</summary>
    POKE,
    /// <summary>Soigne : réduit l'effet du retard d'or.</summary>
    SUSTAIN,
    /// <summary>Enchaîne les éliminations et prend de l'élan.</summary>
    HYPERCARRY,
    /// <summary>Vole le talent du meilleur adversaire (Sylas).</summary>
    STEAL,
}

/// <summary>Talent d'une unité : mécanique, sort (P, Q, W, E, R), nom localisé et icône du sort.</summary>
public sealed record Talent(TalentEffect Effect, char Slot, string Spell, string? Icon, string Description);

/// <summary>
/// Talents des champions, écrits à la main d'après leur kit : un sort emblématique et une mécanique qui le reflète.
/// Les noms des sorts viennent de Data Dragon (localisés) ; <c>Name</c> force un nom quand le sort en a plusieurs (formes).
/// </summary>
public static class Talents
{
    private const string Slots = "PQWER";

    private sealed record Entry(TalentEffect Effect, char Slot, string? Name = null);

    private static readonly Dictionary<string, Entry> ByAlias = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Aatrox"] = new(TalentEffect.SUSTAIN, 'R'),
        ["Ahri"] = new(TalentEffect.PICK, 'E'),
        ["Akali"] = new(TalentEffect.EXECUTE, 'R'),
        ["Akshan"] = new(TalentEffect.REVIVE, 'W'),
        ["Alistar"] = new(TalentEffect.ENGAGE, 'Q'),
        ["Ambessa"] = new(TalentEffect.EXECUTE, 'R'),
        ["Amumu"] = new(TalentEffect.ENGAGE, 'R'),
        ["Anivia"] = new(TalentEffect.REVIVE, 'P'),
        ["Annie"] = new(TalentEffect.ENGAGE, 'R'),
        ["Aphelios"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Ashe"] = new(TalentEffect.PICK, 'R'),
        ["AurelionSol"] = new(TalentEffect.SCALING, 'E'),
        ["Aurora"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Azir"] = new(TalentEffect.PICK, 'R'),
        ["Bard"] = new(TalentEffect.GLOBAL, 'E'),
        ["Belveth"] = new(TalentEffect.OBJECTIVE, 'R'),
        ["Blitzcrank"] = new(TalentEffect.PICK, 'Q'),
        ["Brand"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Braum"] = new(TalentEffect.PROTECT, 'E'),
        ["Briar"] = new(TalentEffect.GANK, 'R'),
        ["Caitlyn"] = new(TalentEffect.LANE_DOMINANCE, 'P'),
        ["Camille"] = new(TalentEffect.PICK, 'R'),
        ["Cassiopeia"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Chogath"] = new(TalentEffect.OBJECTIVE, 'R'),
        ["Corki"] = new(TalentEffect.POKE, 'R'),
        ["Darius"] = new(TalentEffect.EXECUTE, 'R'),
        ["Diana"] = new(TalentEffect.ENGAGE, 'R'),
        ["DrMundo"] = new(TalentEffect.SUSTAIN, 'R'),
        ["Draven"] = new(TalentEffect.LANE_DOMINANCE, 'Q'),
        ["Ekko"] = new(TalentEffect.REVIVE, 'R'),
        ["Elise"] = new(TalentEffect.GANK, 'E', "Cocon"),
        ["Evelynn"] = new(TalentEffect.GANK, 'P'),
        ["Ezreal"] = new(TalentEffect.POKE, 'Q'),
        ["Fiddlesticks"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Fiora"] = new(TalentEffect.SPLITPUSH, 'P'),
        ["Fizz"] = new(TalentEffect.PICK, 'R'),
        ["Galio"] = new(TalentEffect.GLOBAL, 'R'),
        ["Gangplank"] = new(TalentEffect.GLOBAL, 'R'),
        ["Garen"] = new(TalentEffect.EXECUTE, 'R'),
        ["Gnar"] = new(TalentEffect.ENGAGE, 'R'),
        ["Gragas"] = new(TalentEffect.ENGAGE, 'R'),
        ["Graves"] = new(TalentEffect.LANE_DOMINANCE, 'P'),
        ["Gwen"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Hecarim"] = new(TalentEffect.ENGAGE, 'R'),
        ["Heimerdinger"] = new(TalentEffect.POKE, 'Q'),
        ["Hwei"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Illaoi"] = new(TalentEffect.LANE_DOMINANCE, 'E'),
        ["Irelia"] = new(TalentEffect.HYPERCARRY, 'Q'),
        ["Ivern"] = new(TalentEffect.PROTECT, 'E'),
        ["Janna"] = new(TalentEffect.PROTECT, 'R'),
        ["JarvanIV"] = new(TalentEffect.ENGAGE, 'R'),
        ["Jax"] = new(TalentEffect.SPLITPUSH, 'E'),
        ["Jayce"] = new(TalentEffect.POKE, 'Q', "Orbe électrique"),
        ["Jhin"] = new(TalentEffect.EXECUTE, 'R'),
        ["Jinx"] = new(TalentEffect.HYPERCARRY, 'P'),
        ["KSante"] = new(TalentEffect.PICK, 'R'),
        ["Kaisa"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Kalista"] = new(TalentEffect.OBJECTIVE, 'E'),
        ["Karma"] = new(TalentEffect.PROTECT, 'E'),
        ["Karthus"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Kassadin"] = new(TalentEffect.SCALING, 'R'),
        ["Katarina"] = new(TalentEffect.HYPERCARRY, 'P'),
        ["Kayle"] = new(TalentEffect.SCALING, 'P'),
        ["Kayn"] = new(TalentEffect.GANK, 'E'),
        ["Kennen"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Khazix"] = new(TalentEffect.PICK, 'Q'),
        ["Kindred"] = new(TalentEffect.REVIVE, 'R'),
        ["Kled"] = new(TalentEffect.ENGAGE, 'R'),
        ["KogMaw"] = new(TalentEffect.HYPERCARRY, 'W'),
        ["Leblanc"] = new(TalentEffect.PICK, 'E'),
        ["LeeSin"] = new(TalentEffect.GANK, 'Q', "Onde sonore"),
        ["Leona"] = new(TalentEffect.ENGAGE, 'R'),
        ["Lillia"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Lissandra"] = new(TalentEffect.ENGAGE, 'R'),
        ["Lucian"] = new(TalentEffect.LANE_DOMINANCE, 'P'),
        ["Lulu"] = new(TalentEffect.PROTECT, 'R'),
        ["Lux"] = new(TalentEffect.PICK, 'Q'),
        ["Malphite"] = new(TalentEffect.ENGAGE, 'R'),
        ["Malzahar"] = new(TalentEffect.PICK, 'R'),
        ["Maokai"] = new(TalentEffect.ENGAGE, 'R'),
        ["MasterYi"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Mel"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Milio"] = new(TalentEffect.PROTECT, 'R'),
        ["MissFortune"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["MonkeyKing"] = new(TalentEffect.ENGAGE, 'R'),
        ["Mordekaiser"] = new(TalentEffect.PICK, 'R'),
        ["Morgana"] = new(TalentEffect.PROTECT, 'E'),
        ["Naafiri"] = new(TalentEffect.GANK, 'R'),
        ["Nami"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Nasus"] = new(TalentEffect.SCALING, 'Q'),
        ["Nautilus"] = new(TalentEffect.PICK, 'Q'),
        ["Neeko"] = new(TalentEffect.ENGAGE, 'R'),
        ["Nidalee"] = new(TalentEffect.POKE, 'Q', "Javelot"),
        ["Nilah"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Nocturne"] = new(TalentEffect.GLOBAL, 'R'),
        ["Nunu"] = new(TalentEffect.OBJECTIVE, 'Q'),
        ["Olaf"] = new(TalentEffect.LANE_DOMINANCE, 'P'),
        ["Orianna"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Ornn"] = new(TalentEffect.ENGAGE, 'R'),
        ["Pantheon"] = new(TalentEffect.GLOBAL, 'R'),
        ["Poppy"] = new(TalentEffect.PROTECT, 'W'),
        ["Pyke"] = new(TalentEffect.EXECUTE, 'R'),
        ["Qiyana"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Quinn"] = new(TalentEffect.GLOBAL, 'R'),
        ["Rakan"] = new(TalentEffect.ENGAGE, 'W'),
        ["Rammus"] = new(TalentEffect.GANK, 'Q'),
        ["RekSai"] = new(TalentEffect.GANK, 'R'),
        ["Rell"] = new(TalentEffect.ENGAGE, 'W', "Descendre en piqué"),
        ["Renata"] = new(TalentEffect.REVIVE, 'W'),
        ["Renekton"] = new(TalentEffect.LANE_DOMINANCE, 'Q'),
        ["Rengar"] = new(TalentEffect.GANK, 'P'),
        ["Riven"] = new(TalentEffect.EXECUTE, 'R'),
        ["Rumble"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Ryze"] = new(TalentEffect.GLOBAL, 'R'),
        ["Samira"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Sejuani"] = new(TalentEffect.ENGAGE, 'R'),
        ["Senna"] = new(TalentEffect.SCALING, 'P'),
        ["Seraphine"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Sett"] = new(TalentEffect.PICK, 'R'),
        ["Shaco"] = new(TalentEffect.GANK, 'Q'),
        ["Shen"] = new(TalentEffect.GLOBAL, 'R'),
        ["Shyvana"] = new(TalentEffect.OBJECTIVE, 'R'),
        ["Singed"] = new(TalentEffect.SPLITPUSH, 'Q'),
        ["Sion"] = new(TalentEffect.ENGAGE, 'R'),
        ["Sivir"] = new(TalentEffect.ENGAGE, 'R'),
        ["Skarner"] = new(TalentEffect.PICK, 'R'),
        ["Smolder"] = new(TalentEffect.SCALING, 'P'),
        ["Sona"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Soraka"] = new(TalentEffect.SUSTAIN, 'R'),
        ["Swain"] = new(TalentEffect.SUSTAIN, 'R'),
        ["Sylas"] = new(TalentEffect.STEAL, 'R'),
        ["Syndra"] = new(TalentEffect.EXECUTE, 'R'),
        ["TahmKench"] = new(TalentEffect.PROTECT, 'R'),
        ["Taliyah"] = new(TalentEffect.GLOBAL, 'R'),
        ["Talon"] = new(TalentEffect.GLOBAL, 'E'),
        ["Taric"] = new(TalentEffect.PROTECT, 'R'),
        ["Teemo"] = new(TalentEffect.LANE_DOMINANCE, 'E'),
        ["Thresh"] = new(TalentEffect.PICK, 'Q'),
        ["Tristana"] = new(TalentEffect.POKE, 'E'),
        ["Trundle"] = new(TalentEffect.LANE_DOMINANCE, 'R'),
        ["Tryndamere"] = new(TalentEffect.SPLITPUSH, 'R'),
        ["TwistedFate"] = new(TalentEffect.GLOBAL, 'R'),
        ["Twitch"] = new(TalentEffect.GANK, 'Q'),
        ["Udyr"] = new(TalentEffect.GANK, 'E'),
        ["Urgot"] = new(TalentEffect.EXECUTE, 'R'),
        ["Varus"] = new(TalentEffect.POKE, 'Q'),
        ["Vayne"] = new(TalentEffect.SCALING, 'W'),
        ["Veigar"] = new(TalentEffect.SCALING, 'P'),
        ["Velkoz"] = new(TalentEffect.POKE, 'Q'),
        ["Vex"] = new(TalentEffect.PICK, 'R'),
        ["Vi"] = new(TalentEffect.PICK, 'R'),
        ["Viego"] = new(TalentEffect.HYPERCARRY, 'P'),
        ["Viktor"] = new(TalentEffect.SCALING, 'P'),
        ["Vladimir"] = new(TalentEffect.SUSTAIN, 'Q'),
        ["Volibear"] = new(TalentEffect.SPLITPUSH, 'R'),
        ["Warwick"] = new(TalentEffect.GANK, 'W'),
        ["Xayah"] = new(TalentEffect.HYPERCARRY, 'E'),
        ["Xerath"] = new(TalentEffect.POKE, 'R'),
        ["XinZhao"] = new(TalentEffect.GANK, 'E'),
        ["Yasuo"] = new(TalentEffect.TEAMFIGHT, 'R'),
        ["Yone"] = new(TalentEffect.ENGAGE, 'R'),
        ["Yorick"] = new(TalentEffect.SPLITPUSH, 'R'),
        ["Yunara"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Yuumi"] = new(TalentEffect.PROTECT, 'W'),
        ["Zaahen"] = new(TalentEffect.REVIVE, 'P'),
        ["Zac"] = new(TalentEffect.REVIVE, 'P'),
        ["Zed"] = new(TalentEffect.EXECUTE, 'R'),
        ["Zeri"] = new(TalentEffect.HYPERCARRY, 'R'),
        ["Ziggs"] = new(TalentEffect.POKE, 'W'),
        ["Zilean"] = new(TalentEffect.REVIVE, 'R'),
        ["Zoe"] = new(TalentEffect.PICK, 'E'),
        ["Zyra"] = new(TalentEffect.TEAMFIGHT, 'R'),
    };

    public static string Describe(TalentEffect effect) => effect switch
    {
        TalentEffect.LANE_DOMINANCE => "Domine sa lane : +12 % en duel",
        TalentEffect.GANK => "Ganks plus fréquents et plus forts",
        TalentEffect.GLOBAL => "Rejoint une autre lane pendant la phase de lanes",
        TalentEffect.OBJECTIVE => "+30 % pour sécuriser les dragons",
        TalentEffect.ENGAGE => "Lance le premier teamfight : +10 %",
        TalentEffect.TEAMFIGHT => "Ravage chaque teamfight : +6 %",
        TalentEffect.PICK => "Peut attraper un adversaire avant chaque teamfight",
        TalentEffect.PROTECT => "Sauve un allié à chaque teamfight",
        TalentEffect.REVIVE => "Une fois par partie, peut renverser un teamfight perdu",
        TalentEffect.SCALING => "Faible en lane (−8 %), de plus en plus fort ensuite",
        TalentEffect.EXECUTE => "Achève un adversaire de plus à chaque teamfight gagné",
        TalentEffect.SPLITPUSH => "Fait tomber une tour en side lane à chaque teamfight",
        TalentEffect.POKE => "Assiège : une tour de plus après la phase de lanes",
        TalentEffect.SUSTAIN => "Soigne l'équipe : divise par deux le retard d'or",
        TalentEffect.HYPERCARRY => "Enchaîne les éliminations et prend de l'élan",
        TalentEffect.STEAL => "Vole le talent du meilleur adversaire",
        _ => "",
    };

    /// <summary>Talent par défaut selon la classe principale (champion absent de la table).</summary>
    private static Entry Fallback(ChampionClass[] classes) => (classes.Length > 0 ? classes[0] : (ChampionClass?)null) switch
    {
        ChampionClass.ASSASSIN => new(TalentEffect.EXECUTE, 'R'),
        ChampionClass.MAGE => new(TalentEffect.TEAMFIGHT, 'R'),
        ChampionClass.MARKSMAN => new(TalentEffect.HYPERCARRY, 'R'),
        ChampionClass.TANK => new(TalentEffect.ENGAGE, 'R'),
        ChampionClass.SUPPORT => new(TalentEffect.PROTECT, 'R'),
        _ => new(TalentEffect.LANE_DOMINANCE, 'R'),
    };

    public static bool IsMapped(string alias) => ByAlias.ContainsKey(alias);

    public static IEnumerable<string> Aliases => ByAlias.Keys;

    /// <summary>
    /// Talent d'un champion. <paramref name="spells"/> = passif, Q, W, E, R (noms localisés et icônes) ; absent, le nom reste générique.
    /// </summary>
    public static Talent For(string alias, ChampionClass[] classes, IReadOnlyList<(string Name, string? Icon)>? spells)
    {
        var e = ByAlias.GetValueOrDefault(alias) ?? Fallback(classes);
        var index = Slots.IndexOf(e.Slot);
        var spell = spells is { Count: 5 } ? spells[index] : default;
        var name = e.Name ?? (string.IsNullOrWhiteSpace(spell.Name) ? (e.Slot == 'P' ? "Passif" : e.Slot == 'R' ? "Ultime" : $"Sort {e.Slot}") : spell.Name.Split('/')[0].Trim());
        return new Talent(e.Effect, e.Slot, name, spell.Icon, Describe(e.Effect));
    }
}
