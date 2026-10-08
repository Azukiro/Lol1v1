using Api.Domain;

namespace Api.Data;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public RiotAccount? RiotAccount { get; set; }
}

public class RiotAccount
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Puuid { get; set; } = "";
    public string GameName { get; set; } = "";
    public string TagLine { get; set; } = "";
    /// <summary>Riot ID normalisé en minuscules ("pseudo#euw") pour la recherche.</summary>
    public string RiotIdNormalized { get; set; } = "";
    public string Region { get; set; } = "";
    /// <summary>Icône d'invocateur (Data Dragon img/profileicon/{id}.png), rafraîchie à chaque liaison.</summary>
    public int? ProfileIconId { get; set; }
    public DateTimeOffset LinkedAt { get; set; } = DateTimeOffset.UtcNow;

    public string RiotId => $"{GameName}#{TagLine}";
}

/// <summary>Configuration de série enregistrée par un joueur pour la réutiliser.</summary>
public class UserPreset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Configuration de série (jsonb).</summary>
    public string Config { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Invitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid FromUserId { get; set; }
    public User FromUser { get; set; } = null!;
    public Guid ToUserId { get; set; }
    public User ToUser { get; set; } = null!;
    /// <summary>Configuration de série (jsonb).</summary>
    public string Config { get; set; } = "{}";
    public InvitationStatus Status { get; set; } = InvitationStatus.PENDING;
    public Guid? SeriesId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Series
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int BestOf { get; set; }
    public ChampionMode ChampionMode { get; set; }
    public SpellMode SpellMode { get; set; }
    /// <summary>Arbre ET/OU (jsonb).</summary>
    public string WinExpression { get; set; } = "{}";
    /// <summary>Mode expérimental du labo (jsonb), null pour une série standard.</summary>
    public string? LabConfig { get; set; }
    public SeriesStatus Status { get; set; } = SeriesStatus.SETUP;
    public Guid? WinnerPlayerId { get; set; }
    public string DrawSeed { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }

    public List<SeriesPlayer> Players { get; set; } = [];
    public List<Round> Rounds { get; set; } = [];
    public List<Ban> Bans { get; set; } = [];
}

public class SeriesPlayer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeriesId { get; set; }
    public Series Series { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;
    public Slot Slot { get; set; }
    public int RoundsWon { get; set; }
    /// <summary>{ "owned": [ids], "free": [ids] } (jsonb).</summary>
    public string? PoolSnapshot { get; set; }
    public DateTimeOffset? PoolUpdatedAt { get; set; }
    public DateTimeOffset? DeckLockedAt { get; set; }
    public DateTimeOffset? SpellBudgetLockedAt { get; set; }

    public List<DeckChampion> Deck { get; set; } = [];
    public List<SpellToken> SpellTokens { get; set; } = [];
}

public class DeckChampion
{
    public Guid SeriesPlayerId { get; set; }
    public int ChampionId { get; set; }
    public bool Banned { get; set; }
    public Guid? ConsumedInRoundId { get; set; }
}

public class Ban
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeriesId { get; set; }
    public Guid ByPlayerId { get; set; }
    public Guid TargetPlayerId { get; set; }
    public int ChampionId { get; set; }
    public DateTimeOffset SubmittedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SpellToken
{
    public Guid SeriesPlayerId { get; set; }
    public int SpellId { get; set; }
    public int QuantityInitial { get; set; }
    public int QuantityLeft { get; set; }
}

public class Round
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeriesId { get; set; }
    public Series Series { get; set; } = null!;
    public int Number { get; set; }
    public int Attempt { get; set; } = 1;
    public RoundStatus Status { get; set; } = RoundStatus.ASSIGNMENT;
    public string? VoidReason { get; set; }
    public long? LolGameId { get; set; }
    public Guid? WinnerPlayerId { get; set; }
    /// <summary>{ condition, threshold, eventTime, singleSource, label } (jsonb).</summary>
    public string? WinningCondition { get; set; }
    /// <summary>Labo : objectifs secrets tirés pour la manche (jsonb).</summary>
    public string? LabState { get; set; }
    /// <summary>Joueur ayant demandé l'annulation, en attente de l'accord de l'autre.</summary>
    public Guid? VoidRequestedBy { get; set; }
    /// <summary>Votes de résolution de litige : slot du vainqueur désigné, ou "VOID".</summary>
    public string? DisputeVoteA { get; set; }
    public string? DisputeVoteB { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public List<RoundAssignment> Assignments { get; set; } = [];
    public List<Observation> Observations { get; set; } = [];
}

public class RoundAssignment
{
    public Guid RoundId { get; set; }
    public Guid PlayerId { get; set; }
    /// <summary>Null tant que le joueur n'a pas choisi (mode deck).</summary>
    public int? ChampionId { get; set; }
    public int? Spell1Id { get; set; }
    public int? Spell2Id { get; set; }
    public DateTimeOffset? SubmittedAt { get; set; }
    public DateTimeOffset? RevealedAt { get; set; }
    /// <summary>Dernier état de sélection remonté par le client (contrôle du pick).</summary>
    public int? ReportedChampionId { get; set; }
    public int? ReportedSpell1Id { get; set; }
    public int? ReportedSpell2Id { get; set; }
    public bool ReportedLocked { get; set; }
    public bool GameStartedReported { get; set; }
}

public class Observation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoundId { get; set; }
    public Guid ReportedByPlayerId { get; set; }
    public ObservationType Type { get; set; }
    public string EventId { get; set; } = "";
    public double EventTime { get; set; }
    /// <summary>{ subject: "SELF"|"OPPONENT", value?: n, ... } (jsonb).</summary>
    public string Payload { get; set; } = "{}";
    /// <summary>Bénéficiaire résolu en joueur absolu.</summary>
    public Guid? SubjectPlayerId { get; set; }
    public int? Value { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}
