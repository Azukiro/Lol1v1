using Api.Domain.Capsules;

namespace Api.Domain.Battle;

/// <summary>Champion du catalogue vu par l'accueil des nouveaux : identifiant, alias et classes.</summary>
public sealed record NewcomerChampion(int Id, string Alias, ChampionClass[] Classes);

/// <summary>Skin du catalogue vu par l'équipe de départ : identifiant, champion et rareté.</summary>
public sealed record NewcomerSkin(int Id, int ChampionId, Rarity Rarity);

/// <summary>
/// Accueil des nouveaux joueurs, pour qu'ils puissent combattre sans un mois de reliques derrière eux :
/// <list type="bullet">
/// <item>une équipe de départ offerte à la création du portefeuille : un skin COMMON par poste, champion à son poste principal
/// (le malus hors poste pèse bien plus que la rareté) ;</item>
/// <item>une rotation hebdomadaire de champions prêtés : jouables par tous en arène sans les posséder, à la rareté COMMON
/// (sans bonus de rareté), ce qui laisse l'avantage de la collection aux vétérans tout en donnant des options aux nouveaux.</item>
/// </list>
/// </summary>
public static class Newcomers
{
    public const int RotationPerRole = 3;
    public const Rarity StarterRarity = Rarity.COMMON;
    public const Rarity LoanRarity = Rarity.COMMON;

    /// <summary>
    /// Équipe de départ : pour chaque poste, un skin <see cref="StarterRarity"/> d'un champion dont c'est le poste principal
    /// (à défaut le poste secondaire), champions tous différents. Null au poste si aucun skin ne convient.
    /// </summary>
    public static List<NewcomerSkin?> StarterTeam(IReadOnlyList<NewcomerChampion> champions, IReadOnlyList<NewcomerSkin> skins, Random rng)
    {
        var profiles = champions.ToDictionary(c => c.Id, c => Profiles.For(c.Alias, c.Classes));
        var pool = skins.Where(s => s.Rarity == StarterRarity && profiles.ContainsKey(s.ChampionId)).OrderBy(s => s.Id)
            .Select(s => (Skin: s, Key: rng.Next())).OrderBy(s => s.Key).Select(s => s.Skin).ToList();
        var team = new List<NewcomerSkin?>();
        var used = new HashSet<int>();
        for (var role = 0; role < BattleRules.TeamSize; role++)
        {
            var r = role;
            var pick = pool.FirstOrDefault(s => !used.Contains(s.ChampionId) && profiles[s.ChampionId]?.Main == r)
                ?? pool.FirstOrDefault(s => !used.Contains(s.ChampionId) && profiles[s.ChampionId]?.Secondary == r);
            if (pick is not null) used.Add(pick.ChampionId);
            team.Add(pick);
        }
        return team;
    }

    /// <summary>
    /// Rotation de la semaine : <see cref="RotationPerRole"/> champions par poste principal, tirés au sort avec le seed de la semaine
    /// (identique pour tous les joueurs et figée toute la semaine). Triée par poste puis par identifiant.
    /// </summary>
    public static List<int> Rotation(IReadOnlyList<NewcomerChampion> champions, int seed)
    {
        var rng = new Random(seed);
        var pool = champions.OrderBy(c => c.Id).Select(c => (Champ: c, Main: Profiles.For(c.Alias, c.Classes)?.Main, Key: rng.Next()))
            .OrderBy(c => c.Key).ToList();
        return Enumerable.Range(0, BattleRules.TeamSize)
            .SelectMany(role => pool.Where(c => c.Main == role).Take(RotationPerRole).Select(c => (Role: role, c.Champ.Id)))
            .OrderBy(c => c.Role).ThenBy(c => c.Id).Select(c => c.Id).ToList();
    }

    public static int Seed(string weekId) => Meta.StableSeed(weekId + ":rotation");

    /// <summary>
    /// Recrue : compte créé depuis moins de <paramref name="days"/> jours et moins de <paramref name="battles"/> attaques lancées.
    /// Une recrue n'affronte que des collections proches de la sienne, et les vétérans ne la voient pas dans leurs suggestions.
    /// </summary>
    public static bool IsRookie(DateTimeOffset createdAt, int attacks, DateTimeOffset now, int days, int battles) =>
        now - createdAt < TimeSpan.FromDays(days) && attacks < battles;

    /// <summary>Adversaire à la portée d'une recrue : collection au plus <paramref name="gap"/> objets au-dessus de la sienne.</summary>
    public static bool RookieMatch(int myOwned, int theirOwned, int gap) => theirOwned <= myOwned + gap;

    /// <summary>
    /// Rattrapage d'essence : multiplicateur des gains de victoire selon la part du catalogue possédée.
    /// Sous <paramref name="lowShare"/> : <paramref name="lowMult"/> ; sous <paramref name="midShare"/> : <paramref name="midMult"/> ; sinon 1.
    /// L'écart avec les vétérans se referme sans disparaître (le plafond de victoires payées par jour reste le même).
    /// </summary>
    public static double CatchUp(int owned, int catalogSize, double lowShare, double lowMult, double midShare, double midMult)
    {
        if (catalogSize <= 0) return 1;
        var share = (double)owned / catalogSize;
        return share < lowShare ? lowMult : share < midShare ? midMult : 1;
    }
}
