using Api.Domain;

namespace Api.Dtos;

// ---- Comptes ----
public sealed record RegisterRequest(string Email, string Password, string DisplayName);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string Token, UserDto User);
public sealed record UserDto(Guid Id, string Email, string DisplayName, RiotAccountDto? RiotAccount);
public sealed record RiotAccountDto(string Puuid, string GameName, string TagLine, string Region, string RiotId);
public sealed record LinkRiotRequest(string Puuid, string GameName, string TagLine, string Region);
public sealed record PlayerSearchResult(Guid UserId, string DisplayName, string RiotId);
public sealed record LookupRequest(string[] Puuids);
public sealed record RegisteredPlayer(string Puuid, Guid UserId, string DisplayName, string RiotId);

// ---- Pré-configurations ----
public sealed record PresetDto(string Id, string Name, string Description, SeriesConfig Config, bool BuiltIn);
public sealed record PresetsResponse(List<PresetDto> Server, List<PresetDto> Mine);
public sealed record CreatePresetRequest(string Name, SeriesConfig Config);

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
    string MySlot, string OpponentName, string OpponentRiotId, int MyWins, int OpponentWins,
    string? WinnerSlot, DateTimeOffset CreatedAt, DateTimeOffset? FinishedAt);

public sealed record SeriesStateDto
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public int BestOf { get; init; }
    public int WinsNeeded { get; init; }
    public string ChampionMode { get; init; } = "";
    public string SpellMode { get; init; } = "";
    public WinNode WinExpression { get; init; } = null!;
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
}

public sealed record RulesDto(int MinDeckSize, int BansPerPlayer, int SpellBudget, int SpellCap, IReadOnlyList<int> AllowedSpellIds);

public sealed record PlayerDto(
    string Slot, Guid UserId, string DisplayName, string RiotId, string Puuid, int RoundsWon,
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

// ---- Hub ----
public sealed record ObservationReport(string Type, string EventId, double EventTime, ObservationPayload? Payload);
public sealed record ObservationPayload(string? Subject, int? Value, string? Raw);
