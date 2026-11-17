using Api.Domain.Battle;
using Api.Domain.Capsules;

namespace Api.Dtos;

public sealed record AttackRequest(Guid OpponentId);

/// <summary>Adversaire proposé : AvailableAt non nul = déjà attaqué, en attente de sa riposte ou du délai.</summary>
public sealed record ArenaOpponentDto(PlayerCardDto Player, int Rating, bool Friend, bool Revenge, DateTimeOffset? AvailableAt, bool Rookie = false);

/// <summary>Arène : cote, récompenses du jour, analyse de son roster et adversaires.</summary>
public sealed record ArenaDto(
    int Rating, int Wins, int Losses, int? Rank, int RewardedToday, int RewardedPerDay, int WinEssence, DateTimeOffset ResetAt,
    int RematchHours, bool RosterReady, TeamReport? Team, List<ArenaOpponentDto> Opponents, SeasonDto Season, SeasonResultDto? LastSeason,
    Tier? Frame = null, PassDto? Pass = null, ArenaEventDto? Event = null, bool Legend = false, BossResultDto? LastBoss = null,
    RookieDto? Rookie = null, int CatchUpPercent = 0);

/// <summary>Arène des recrues : jusqu'à EndsAt au plus tard ou BattlesLeft attaques ; adversaires à au plus CollectionGap objets de plus.</summary>
public sealed record RookieDto(DateTimeOffset EndsAt, int BattlesLeft, int CollectionGap);

/// <summary>Pass de saison : XP, niveau atteint et récompenses de chaque niveau.</summary>
public sealed record PassDto(int Xp, int Level, int XpPerLevel, int MaxLevel, IReadOnlyList<PassReward> Rewards,
    int AttackWinXp, int AttackLossXp, int DefenseWinXp, int BossXp);

/// <summary>Événement du week-end ; Active = en cours, sinon à venir.</summary>
public sealed record ArenaEventDto(string Id, ArenaEventKind Kind, string Title, string Text, DateTimeOffset StartsAt, DateTimeOffset EndsAt, bool Active);

/// <summary>Boss de la semaine : son équipe, mes tentatives et le classement des dégâts.</summary>
public sealed record BossDto(
    string WeekId, string Name, DateTimeOffset EndsAt, TeamReport Team, TeamReport? Mine, int AttemptsLeft, int AttemptsPerDay, DateTimeOffset ResetAt,
    int? MyBest, int? MyRank, List<BossEntryDto> Top, int KillPoints, int TowerPoints, int WinPoints, Guid? OpenRun = null, int ReadPoints = 0);
/// <summary>
/// Étape d'une partie contre le boss : événements depuis le début, décision attendue (null à la fin), décisions résolues,
/// et le combat complet (score, XP) une fois terminé.
/// </summary>
public sealed record BossStepDto(
    Guid RunId, BattlePlayerDto Me, BattlePlayerDto Boss, TeamReport A, TeamReport B, List<BattleEvent> Events,
    TacticDecision? Decision, List<TacticResult> Results, BattleDto? Battle, int ReadPoints);
public sealed record TacticChoiceRequest(int Choice);
public sealed record BossEntryDto(int Rank, Guid UserId, string DisplayName, int? ProfileIconId, int? AvatarChampionId, int Best, int Attempts);
/// <summary>Résultat de fin de semaine contre le boss, avec les reliques versées.</summary>
public sealed record BossResultDto(string WeekId, string Name, int Rank, int Players, int Best, int RewardStandard, int RewardPremium);

/// <summary>Saison en cours : palier de la cote, plancher du palier et seuil du suivant (null au sommet).</summary>
public sealed record SeasonDto(string Id, int Number, DateTimeOffset EndsAt, Tier Tier, int TierFloor, int? NextTierAt, int PeakRating);

/// <summary>Patch de méta de la semaine : buffs et nerfs de champions et de classes, en vigueur de StartsAt à EndsAt.</summary>
public sealed record MetaDto(string Id, int Number, DateTimeOffset StartsAt, DateTimeOffset EndsAt, List<MetaChange> Changes, ArenaEventDto? Event = null);

/// <summary>Bilan d'une saison terminée, avec les reliques versées.</summary>
public sealed record SeasonResultDto(
    string Id, int Number, int Rating, int PeakRating, int Wins, int Losses, int Rank, Tier Tier, int RewardStandard, int RewardPremium,
    int PassLevel = 0, int Players = 0, string? PlayerName = null);

public sealed record ShareDto(string Code);

/// <summary>Aperçu avant l'attaque : vis-à-vis, contres et synergies des deux rosters, et tendance du match en crans (vue de Mine).</summary>
public sealed record BattlePreviewDto(
    PlayerCardDto Opponent, int Rating, TeamReport Mine, TeamReport Theirs, DateTimeOffset? AvailableAt, MatchForecast? Forecast = null);

/// <summary>Frame = palier final de la saison précédente (cadre de l'icône), null si pas classé.</summary>
public sealed record BattlePlayerDto(
    Guid UserId, string DisplayName, int? ProfileIconId, int RatingBefore, int RatingAfter, int? AvatarChampionId = null, Tier? Frame = null,
    bool Legend = false);

/// <summary>Combat complet (rejouable) ; A = attaquant, B = défenseur.</summary>
public sealed record BattleDto(
    Guid Id, DateTimeOffset CreatedAt, BattlePlayerDto Attacker, BattlePlayerDto Defender, bool AttackerWon, int Essence,
    int Minutes, TeamReport A, TeamReport B, List<BattleEvent> Events,
    int PassXp = 0, List<PassReward>? PassRewards = null, bool Boss = false, int? BossScore = null, int? BossBest = null);

public sealed record BattleSummaryDto(
    Guid Id, DateTimeOffset CreatedAt, bool Attacked, Guid OpponentId, string OpponentName, int? OpponentIcon, bool Won, int RatingDelta, int Essence);

/// <summary>Titles = numéros des saisons terminées à la 1re place (étiquettes « Champion S2 ») ; Shamed = battu par le compte de test cette saison (prolongé d'une saison pour les exceptions de BattleOptions.ShameCarryOvers).</summary>
public sealed record LadderEntryDto(
    int Rank, Guid UserId, string DisplayName, int? ProfileIconId, int Rating, int Wins, int Losses, int? AvatarChampionId = null, Tier? Frame = null,
    List<int>? Titles = null, bool Shamed = false, bool Legend = false);
public sealed record LadderDto(List<LadderEntryDto> Top, LadderEntryDto? Me);

/// <summary>Adversaire marquant d'un joueur (victime préférée, bête noire, plus bel exploit).</summary>
public sealed record RivalDto(Guid UserId, string DisplayName, int Count, int? Gap = null);

/// <summary>Champion du roster d'un joueur sur l'ensemble de ses combats.</summary>
public sealed record ChampionStatDto(CapsuleItemKind Kind, int ItemId, string Champion, int Games, int Wins, int Kills);

/// <summary>
/// Profil public d'arène : visible par tous, calculé sur tous les combats du joueur (toutes saisons).
/// Form = derniers résultats, du plus récent au plus ancien (true = victoire).
/// </summary>
public sealed record PlayerStatsDto(
    PlayerCardDto Player, int Rating, Tier Tier, int? Rank, int Ranked, int SeasonWins, int SeasonLosses, int SeasonPeak, int BestRating,
    int Wins, int Losses, int AttackWins, int AttackLosses, int DefenseWins, int DefenseLosses,
    int BestStreak, int Streak, List<bool> Form,
    int Kills, int Deaths, int Aces, int FirstBloods, int Flawless, int? FastestWin, int BestGain, int Essence,
    RivalDto? BestUpset, RivalDto? Victim, RivalDto? Nemesis, ChampionStatDto? Signature, ChampionStatDto? Killer,
    Tier? BestTier, int SeasonsPlayed, int Podiums, int Titles, DateTimeOffset? FirstBattleAt,
    List<int>? TitleSeasons = null, int ShameLosses = 0, string? ShameAccount = null, List<int>? LegendSeasons = null, int PassLevel = 0,
    /// <summary>Joueur à affronter pour prendre sa revanche (dernier duel perdu, défiable maintenant) ; seulement sur son propre profil.</summary>
    RivalDto? Revenge = null);
