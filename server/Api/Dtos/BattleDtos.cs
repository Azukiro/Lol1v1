using Api.Domain.Battle;

namespace Api.Dtos;

public sealed record AttackRequest(Guid OpponentId);

/// <summary>Adversaire proposé : AvailableAt non nul = déjà attaqué, en attente de sa riposte ou du délai.</summary>
public sealed record ArenaOpponentDto(PlayerCardDto Player, int Rating, bool Friend, bool Revenge, DateTimeOffset? AvailableAt);

/// <summary>Arène : cote, récompenses du jour, analyse de son roster et adversaires.</summary>
public sealed record ArenaDto(
    int Rating, int Wins, int Losses, int? Rank, int RewardedToday, int RewardedPerDay, int WinEssence, DateTimeOffset ResetAt,
    int RematchHours, bool RosterReady, TeamReport? Team, List<ArenaOpponentDto> Opponents, SeasonDto Season, SeasonResultDto? LastSeason);

/// <summary>Saison en cours : palier de la cote, plancher du palier et seuil du suivant (null au sommet).</summary>
public sealed record SeasonDto(string Id, int Number, DateTimeOffset EndsAt, Tier Tier, int TierFloor, int? NextTierAt, int PeakRating);

/// <summary>Bilan d'une saison terminée, avec les reliques versées.</summary>
public sealed record SeasonResultDto(
    string Id, int Number, int Rating, int PeakRating, int Wins, int Losses, int Rank, Tier Tier, int RewardStandard, int RewardPremium);

public sealed record ShareDto(string Code);

/// <summary>Aperçu avant l'attaque : vis-à-vis, contres et synergies des deux rosters.</summary>
public sealed record BattlePreviewDto(PlayerCardDto Opponent, int Rating, TeamReport Mine, TeamReport Theirs, DateTimeOffset? AvailableAt);

public sealed record BattlePlayerDto(Guid UserId, string DisplayName, int? ProfileIconId, int RatingBefore, int RatingAfter);

/// <summary>Combat complet (rejouable) ; A = attaquant, B = défenseur.</summary>
public sealed record BattleDto(
    Guid Id, DateTimeOffset CreatedAt, BattlePlayerDto Attacker, BattlePlayerDto Defender, bool AttackerWon, int Essence,
    int Minutes, TeamReport A, TeamReport B, List<BattleEvent> Events);

public sealed record BattleSummaryDto(
    Guid Id, DateTimeOffset CreatedAt, bool Attacked, Guid OpponentId, string OpponentName, int? OpponentIcon, bool Won, int RatingDelta, int Essence);

public sealed record LadderEntryDto(int Rank, Guid UserId, string DisplayName, int? ProfileIconId, int Rating, int Wins, int Losses);
public sealed record LadderDto(List<LadderEntryDto> Top, LadderEntryDto? Me);
