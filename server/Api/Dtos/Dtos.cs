using Api.Domain;
using Api.Domain.Lab;

namespace Api.Dtos;

// ---- Comptes ----
public sealed record RegisterRequest(string Email, string Password, string DisplayName);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string Token, UserDto User);
public sealed record UserDto(Guid Id, string Email, string DisplayName, RiotAccountDto? RiotAccount);
public sealed record RiotAccountDto(string Puuid, string GameName, string TagLine, string Region, string RiotId, int? ProfileIconId);
public sealed record LinkRiotRequest(string Puuid, string GameName, string TagLine, string Region, int? ProfileIconId = null);
public sealed record PlayerSearchResult(Guid UserId, string DisplayName, string RiotId, int? ProfileIconId = null);
public sealed record LookupRequest(string[] Puuids);
public sealed record RegisteredPlayer(string Puuid, Guid UserId, string DisplayName, string RiotId, int? ProfileIconId);

// ---- Pré-configurations ----
public sealed record PresetDto(string Id, string Name, string Description, PresetConfig Config, bool BuiltIn);
public sealed record PresetsResponse(List<PresetDto> Server, List<PresetDto> Mine);
public sealed record CreatePresetRequest(string Name, PresetConfig Config);

// ---- Invitations ----
public sealed record CreateInvitationRequest(string ToRiotId, SeriesConfig Config);
public sealed record InvitationDto(
    Guid Id, string Status, SeriesConfig Config, string ConfigLabel,
    PlayerSearchResult From, PlayerSearchResult To,
    DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, Guid? SeriesId);

// ---- Séries ----
public sealed record PoolRequest(int[] ChampionIds, int[]? FreeChampionIds);
public sealed record DeckRequest(int[] ChampionIds);
public sealed record SpellBudgetRequest(Dictionary<int, int> Tokens);

public sealed record SeriesSummaryDto(
    Guid Id, string Status, int BestOf, string ChampionMode, string SpellMode, string WinExpressionLabel,
    string MySlot, string OpponentName, string OpponentRiotId, int? OpponentProfileIconId, int MyWins, int OpponentWins,
    string? WinnerSlot, DateTimeOffset CreatedAt, DateTimeOffset? FinishedAt);

/// <summary>Série de l'historique, avec le récapitulatif de chaque manche jouée.</summary>
/// <summary>MyBans : champions que j'ai bannis ; OpponentBans : ceux que l'adversaire m'a bannis (visibles une fois révélés).</summary>
public sealed record HistoryEntryDto(SeriesSummaryDto Series, List<HistoryRoundDto> Rounds, List<int> MyBans, List<int> OpponentBans);

/// <summary>Manche jouée (tentatives annulées exclues), vue du joueur courant.</summary>
public sealed record HistoryRoundDto(
    int Number, string? WinnerSlot, string? WinningLabel, string? WinningCondition, double? WinningTime,
    DateTimeOffset? StartedAt, DateTimeOffset? EndedAt, HistoryPlayerRoundDto Me, HistoryPlayerRoundDto Opponent);

public sealed record HistoryPlayerRoundDto(int? ChampionId, int? Spell1Id, int? Spell2Id, int Kills, int Cs, bool FirstBlood, bool FirstTower);

public sealed record SeriesStateDto
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public int BestOf { get; init; }
    public int WinsNeeded { get; init; }
    public string ChampionMode { get; init; } = "";
    public string SpellMode { get; init; } = "";
    /// <summary>Null en mode labo « objectifs secrets » : voir <see cref="Lab"/>.</summary>
    public WinNode? WinExpression { get; init; }
    public string WinExpressionLabel { get; init; } = "";
    public string? WinnerSlot { get; init; }
    public string MySlot { get; init; } = "";
    public string CreatorSlot { get; init; } = "A";
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? FinishedAt { get; init; }
    public RulesDto Rules { get; init; } = null!;
    public List<PlayerDto> Players { get; init; } = [];
    public MyDataDto Me { get; init; } = null!;
    public OpponentDataDto Opponent { get; init; } = null!;
    public List<RoundDto> Rounds { get; init; } = [];
    public Guid? CurrentRoundId { get; init; }
    public LiveDto? Live { get; init; }
    /// <summary>Mode expérimental du labo, null pour une série standard.</summary>
    public LabStateDto? Lab { get; init; }
}

public sealed record RulesDto(int MinDeckSize, int BansPerPlayer, int SpellBudget, int SpellCap, IReadOnlyList<int> AllowedSpellIds);

public sealed record PlayerDto(
    string Slot, Guid UserId, string DisplayName, string RiotId, string Puuid, int? ProfileIconId, int RoundsWon,
    int PoolSize, int FreeCount, DateTimeOffset? PoolUpdatedAt, bool DeckLocked, int DeckSize,
    bool SpellBudgetLocked, bool BansSubmitted);

public sealed record DeckEntryDto(int ChampionId, bool Banned, bool Consumed);
public sealed record SpellTokenDto(int SpellId, int Initial, int Left);

public sealed record MyDataDto(
    int[] Pool, int[] Free, List<DeckEntryDto> Deck, List<SpellTokenDto> SpellTokens,
    int[] MyBans, int[] DeckChampionsNotInPool);

public sealed record OpponentDataDto(
    /// <summary>Visible quand les deux decks sont validés (phase de bans).</summary>
    List<DeckEntryDto>? Deck,
    /// <summary>Bans de l'adversaire sur mon deck, révélés quand les deux ont banni.</summary>
    int[]? BansOnMe,
    List<SpellTokenDto>? SpellTokens);

public sealed record AssignmentDto(string Slot, int? ChampionId, int? Spell1Id, int? Spell2Id, bool Submitted, bool Revealed, bool Conform);

public sealed record RoundDto(
    Guid Id, int Number, int Attempt, string Status, string? VoidReason, long? LolGameId,
    string? WinnerSlot, WinningConditionDto? WinningCondition,
    DateTimeOffset? StartedAt, DateTimeOffset? EndedAt,
    List<AssignmentDto> Assignments, string? VoidRequestedBySlot, string? MyDisputeVote);

public sealed record WinningConditionDto(string Label, string? Condition, int? Threshold, double? EventTime, bool SingleSource);

public sealed record LiveDto(
    Dictionary<string, PlayerProgressDto> Progress,
    List<ValidatedEventDto> Events,
    bool Pending,
    List<string> Contradictions);

public sealed record PlayerProgressDto(int Kills, bool FirstBlood, bool FirstTower, int Cs, double? SatisfiedAt);
public sealed record ValidatedEventDto(string Type, string Slot, double EventTime, int? Value, bool SingleSource);

// ---- Labo ----
public sealed record LabStateDto(string Mode, string? Tier, LabRoundDto? Current, List<LabRevealDto> History);
/// <summary>Manche en cours : Mine reste null tant que la partie n'a pas commencé.</summary>
public sealed record LabRoundDto(Guid RoundId, string Tier, double TimeLimit, LabObjectiveDto? Mine, double? MyProgress, double GameClock);
public sealed record LabObjectiveDto(string Id, string Label, WinNode Expression, string Tier, double EstimatedMinutes);
public sealed record LabRevealDto(Guid RoundId, int Number, int Attempt, LabObjectiveDto Mine, LabObjectiveDto Opponent);
public sealed record LabTierDto(string Tier, string Label, double TimeLimit, List<LabObjectiveDto> Objectives);
public sealed record LabDrawDto(string Tier, LabObjectiveDto A, LabObjectiveDto B);

public static class LabMapping
{
    public static LabObjectiveDto ToDto(SecretObjective o) => new(o.Id, o.Label, o.Expression, o.Tier.ToString(), o.EstimatedMinutes);
}

// ---- Hub ----
public sealed record ObservationReport(string Type, string EventId, double EventTime, ObservationPayload? Payload);
public sealed record ObservationPayload(string? Subject, int? Value, string? Raw);
