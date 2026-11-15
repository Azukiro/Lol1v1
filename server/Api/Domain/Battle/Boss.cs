namespace Api.Domain.Battle;

/// <summary>
/// Boss de la semaine : un roster piégé (un champion par poste, rareté maximale, gros bonus de puissance) que tout le monde attaque.
/// Score = dégâts infligés (kills, tours, victoire) ; le meilleur score de la semaine compte. Récompenses versées à la fin de la semaine.
/// </summary>
public static class Boss
{
    public const int AttemptsPerDay = 3;
    public const double PowerBonus = 0.35;
    public const int KillPoints = 100, TowerPoints = 250, WinPoints = 3000;

    private static readonly string[] Names =
        ["Le Colosse du Néant", "La Reine des Abysses", "Le Baron Corrompu", "L'Ancien Dragon", "Le Héraut Fou", "La Hydre de Zaun", "Le Roi Déchu"];

    public static string NameOf(string weekId) => Names[(int)((uint)Meta.StableSeed(weekId + ":boss") % Names.Length)];

    /// <summary>Dégâts d'une tentative : éliminations et tours du camp A (le joueur), plus la victoire.</summary>
    public static int Score(BattleOutcome o)
    {
        var last = o.Events.LastOrDefault();
        return (last?.KillsA ?? 0) * KillPoints + (last?.TowersA ?? 0) * TowerPoints + (o.Winner == BattleSide.A ? WinPoints : 0);
    }

    /// <summary>Récompense de fin de semaine selon le rang (reliques standard, prestige).</summary>
    public static (int Standard, int Premium) Reward(int rank) => rank switch
    {
        1 => (0, 3),
        2 => (0, 2),
        3 => (0, 1),
        _ => (1, 0),
    };
}
