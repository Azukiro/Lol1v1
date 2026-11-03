using Api.Domain.Battle;
using Api.Domain.Capsules;

namespace Api.Dtos;

public sealed record AttackRequest(Guid OpponentId);

/// <summary>Adversaire proposé : AvailableAt non nul = déjà attaqué, en attente de sa riposte ou du délai.</summary>
public sealed record ArenaOpponentDto(PlayerCardDto Player, int Rating, bool Friend, bool Revenge, DateTimeOffset? AvailableAt);

/// <summary>Arène : cote, récompenses du jour, analyse de son roster et adversaires.</summary>
public sealed record ArenaDto(
    int Rating, int Wins, int Losses, int? Rank, int RewardedToday, int RewardedPerDay, int WinEssence, DateTimeOffset ResetAt,
    int RematchHours, bool RosterReady, TeamReport? Team, List<ArenaOpponentDto> Opponents, SeasonDto Season, SeasonResultDto? LastSeason,
    Tier? Frame = null);

/// <summary>Saison en cours : palier de la cote, plancher du palier et seuil du suivant (null au sommet).</summary>
public sealed record SeasonDto(string Id, int Number, DateTimeOffset EndsAt, Tier Tier, int TierFloor, int? NextTierAt, int PeakRating);

/// <summary>Patch de méta de la semaine : buffs et nerfs de champions et de classes, en vigueur de StartsAt à EndsAt.</summary>
public sealed record MetaDto(string Id, int Number, DateTimeOffset StartsAt, DateTimeOffset EndsAt, List<MetaChange> Changes);

/// <summary>Bilan d'une saison terminée, avec les reliques versées.</summary>
public sealed record SeasonResultDto(
    string Id, int Number, int Rating, int PeakRating, int Wins, int Losses, int Rank, Tier Tier, int RewardStandard, int RewardPremium);

public sealed record ShareDto(string Code);

/// <summary>Aperçu avant l'attaque : vis-à-vis, contres et synergies des deux rosters.</summary>
public sealed record BattlePreviewDto(PlayerCardDto Opponent, int Rating, TeamReport Mine, TeamReport Theirs, DateTimeOffset? AvailableAt);

/// <summary>Frame = palier de la semaine passée (cadre de l'icône), null si pas classé.</summary>
public sealed record BattlePlayerDto(
    Guid UserId, string DisplayName, int? ProfileIconId, int RatingBefore, int RatingAfter, int? AvatarChampionId = null, Tier? Frame = null);

/// <summary>Combat complet (rejouable) ; A = attaquant, B = défenseur.</summary>
public sealed record BattleDto(
    Guid Id, DateTimeOffset CreatedAt, BattlePlayerDto Attacker, BattlePlayerDto Defender, bool AttackerWon, int Essence,
    int Minutes, TeamReport A, TeamReport B, List<BattleEvent> Events);

public sealed record BattleSummaryDto(
    Guid Id, DateTimeOffset CreatedAt, bool Attacked, Guid OpponentId, string OpponentName, int? OpponentIcon, bool Won, int RatingDelta, int Essence);

public sealed record LadderEntryDto(
    int Rank, Guid UserId, string DisplayName, int? ProfileIconId, int Rating, int Wins, int Losses, int? AvatarChampionId = null, Tier? Frame = null);
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
    Tier? BestTier, int SeasonsPlayed, int Podiums, int Titles, DateTimeOffset? FirstBattleAt);
