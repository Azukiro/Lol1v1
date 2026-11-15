namespace Api.Domain.Battle;

/// <summary>Récompense d'un niveau du pass : essence, reliques standard et prestige ; Legend = cadre animé et titre « Légende ».</summary>
public sealed record PassReward(int Level, int Essence, int Standard, int Premium, bool Legend = false);

/// <summary>
/// Pass de saison : chaque combat rapporte de l'XP (plus en victoire, un peu en défense réussie et contre le boss),
/// chaque niveau verse sa récompense tout de suite. Le dernier niveau donne le cadre animé « Légende » jusqu'à la fin
/// de la saison suivante et le titre « Légende S#». Remis à zéro à chaque saison.
/// </summary>
public static class SeasonPass
{
    public const int XpPerLevel = 80, MaxLevel = 15;
    public const int AttackWinXp = 30, AttackLossXp = 15, DefenseWinXp = 10, BossXp = 20;

    public static readonly IReadOnlyList<PassReward> Rewards =
    [
        new(1, 50, 0, 0), new(2, 0, 1, 0), new(3, 100, 0, 0), new(4, 0, 1, 0), new(5, 0, 0, 1),
        new(6, 150, 0, 0), new(7, 0, 2, 0), new(8, 150, 0, 0), new(9, 0, 2, 0), new(10, 0, 0, 1),
        new(11, 200, 0, 0), new(12, 0, 2, 0), new(13, 200, 0, 0), new(14, 0, 3, 0), new(15, 0, 0, 2, true),
    ];

    public static int LevelOf(int xp) => Math.Min(MaxLevel, Math.Max(0, xp) / XpPerLevel);
}
