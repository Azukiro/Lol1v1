using Api.Domain;
using Api.Dtos;

namespace Api.Services;

/// <summary>Pré-configurations proposées par le serveur sur l'écran d'accueil.</summary>
public static class BuiltInPresets
{
    private static WinNode Kills(int n) => WinNode.Leaf(Conditions.Kills, n);
    private static WinNode Cs(int n) => WinNode.Leaf(Conditions.Cs, n);
    private static readonly WinNode FirstTower = WinNode.Leaf(Conditions.FirstTower);

    public static readonly IReadOnlyList<PresetDto> All =
    [
        new("server:first-blood", "Premier sang", "BO1 miroir : le premier kill gagne.",
            new SeriesConfig { BestOf = 1, ChampionMode = ChampionMode.MIRROR, SpellMode = SpellMode.FREE, WinExpression = Kills(1) }, true),
        new("server:classique", "Classique", "BO3 aléatoire : 2 kills ou la première tour.",
            new SeriesConfig { BestOf = 3, ChampionMode = ChampionMode.RANDOM, SpellMode = SpellMode.FREE, WinExpression = WinNode.Or(Kills(2), FirstTower) }, true),
        new("server:farm", "Farm", "BO3 miroir : 100 CS ou le premier kill.",
            new SeriesConfig { BestOf = 3, ChampionMode = ChampionMode.MIRROR, SpellMode = SpellMode.FREE, WinExpression = WinNode.Or(Cs(100), Kills(1)) }, true),
        new("server:deck", "Duel de deck", "BO5 deck, 3 bans, sorts composés : 2 kills ou la première tour.",
            new SeriesConfig { BestOf = 5, ChampionMode = ChampionMode.DECK, SpellMode = SpellMode.DECK_COMPOSED, WinExpression = WinNode.Or(Kills(2), FirstTower) }, true),
        new("server:marathon", "Marathon", "BO7 aléatoire, sorts tirés au sort : 3 kills ou la première tour.",
            new SeriesConfig { BestOf = 7, ChampionMode = ChampionMode.RANDOM, SpellMode = SpellMode.DECK_RANDOM, WinExpression = WinNode.Or(Kills(3), FirstTower) }, true),
    ];
}
