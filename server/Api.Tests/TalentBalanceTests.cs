using Api.Domain.Battle;
using Api.Domain.Capsules;
using Xunit.Abstractions;

namespace Api.Tests;

/// <summary>Chaque mécanique de talent, seule dans une équipe autrement identique, doit aider sans décider à elle seule.</summary>
public class TalentBalanceTests(ITestOutputHelper output)
{
    [Fact]
    public void Each_talent_helps_without_deciding_alone()
    {
        ChampionClass[][] classes = [[ChampionClass.FIGHTER], [ChampionClass.FIGHTER], [ChampionClass.MAGE], [ChampionClass.MARKSMAN], [ChampionClass.SUPPORT]];
        List<BattleUnit> Team(Talent? t, int role) => Enumerable.Range(0, 5)
            .Select(i => new BattleUnit(CapsuleItemKind.CHAMPION, i + 1, $"U{i}", i + 1, Rarity.EPIC, classes[i], [], i == role ? t : null)).ToList();
        foreach (var e in Enum.GetValues<TalentEffect>().Where(e => e != TalentEffect.STEAL))
        {
            var role = e is TalentEffect.GANK or TalentEffect.OBJECTIVE ? 1 : e is TalentEffect.PROTECT ? 4 : e is TalentEffect.HYPERCARRY or TalentEffect.SCALING ? 3 : 2;
            var a = Team(new Talent(e, 'R', "X", null, ""), role);
            var b = Team(null, role);
            var wins = Enumerable.Range(0, 6000).Count(s => BattleRules.Simulate(a, b, s, new Dictionary<int, string>()).Winner == BattleSide.A) / 6000.0;
            output.WriteLine($"{e,-15} {wins:P1}");
            Assert.InRange(wins, 0.52, 0.63);
        }
    }
}
