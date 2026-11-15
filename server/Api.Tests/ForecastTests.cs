using Api.Domain.Battle;
using Api.Domain.Capsules;

namespace Api.Tests;

public class ForecastTests
{
    private static readonly Dictionary<int, string> NoLines = [];
    private static int _nextId = 1;

    private static BattleUnit U(string alias, Rarity rarity, params ChampionClass[] classes) =>
        new(CapsuleItemKind.CHAMPION, _nextId, alias, _nextId++, rarity, classes, [], Talents.For(alias, classes, null),
            Profiles.For(alias, classes));

    private static List<BattleUnit> Team(Rarity rarity = Rarity.EPIC) =>
    [
        U("Darius", rarity, ChampionClass.FIGHTER, ChampionClass.TANK),
        U("LeeSin", rarity, ChampionClass.FIGHTER, ChampionClass.ASSASSIN),
        U("Ahri", rarity, ChampionClass.MAGE, ChampionClass.ASSASSIN),
        U("Jinx", rarity, ChampionClass.MARKSMAN),
        U("Thresh", rarity, ChampionClass.SUPPORT, ChampionClass.TANK),
    ];

    [Fact]
    public void Mirror_match_is_close()
    {
        var f = BattleRules.Forecast(Team(), Team(), NoLines);
        Assert.Equal(0, f.Tendency);
    }

    [Fact]
    public void Stronger_team_is_favoured_and_the_view_is_symmetric()
    {
        var (strong, weak) = (Team(Rarity.EXALTED), Team(Rarity.COMMON));
        Assert.True(BattleRules.Forecast(strong, weak, NoLines).Tendency >= 1);
        Assert.True(BattleRules.Forecast(weak, strong, NoLines).Tendency <= -1);
    }

    [Fact]
    public void Forecast_is_stable_between_calls()
    {
        var (a, b) = (Team(), Team(Rarity.RARE));
        var (x, y) = (BattleRules.Forecast(a, b, NoLines), BattleRules.Forecast(a, b, NoLines));
        Assert.Equal((x.Tendency, x.Lanes, x.Objectives, x.EarlyFight, x.LateFight), (y.Tendency, y.Lanes, y.Objectives, y.EarlyFight, y.LateFight));
        Assert.Equal(x.KeysA, y.KeysA);
    }

    [Theory]
    [InlineData(0.10, -2)]
    [InlineData(0.40, -1)]
    [InlineData(0.50, 0)]
    [InlineData(0.60, 1)]
    [InlineData(0.90, 2)]
    public void Shares_map_to_coarse_buckets(double share, int bucket) => Assert.Equal(bucket, BattleRules.Bucket(share));

    [Fact]
    public void Gamble_talents_raise_the_risk()
    {
        // Ahri et Thresh attrapent, Jinx hypercarry : trois coups de poker.
        Assert.Equal(3, BattleRules.Analyze(Team(), NoLines).Risk);
        List<BattleUnit> poker =
        [
            U("Kayle", Rarity.EPIC, ChampionClass.FIGHTER),
            U("Kindred", Rarity.EPIC, ChampionClass.MARKSMAN),
            U("Ahri", Rarity.EPIC, ChampionClass.MAGE),
            U("Jinx", Rarity.EPIC, ChampionClass.MARKSMAN),
            U("Thresh", Rarity.EPIC, ChampionClass.SUPPORT, ChampionClass.TANK),
        ];
        Assert.Equal(5, BattleRules.Analyze(poker, NoLines).Risk);
    }

    [Fact]
    public void Keys_name_the_hidden_levers()
    {
        List<BattleUnit> late =
        [
            U("Kayle", Rarity.EPIC, ChampionClass.FIGHTER),
            U("Amumu", Rarity.EPIC, ChampionClass.TANK),
            U("Kassadin", Rarity.EPIC, ChampionClass.ASSASSIN),
            U("Vayne", Rarity.EPIC, ChampionClass.MARKSMAN),
            U("Senna", Rarity.EPIC, ChampionClass.SUPPORT),
        ];
        var f = BattleRules.Forecast(late, Team(), NoLines);
        Assert.InRange(f.KeysA.Count, 1, 3);
        Assert.Contains(f.KeysA, k => k.StartsWith("Scaling"));
    }
}
