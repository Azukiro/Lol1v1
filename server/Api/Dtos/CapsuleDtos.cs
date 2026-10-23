using Api.Domain.Capsules;

namespace Api.Dtos;

public sealed record CapsuleStateDto(
    int Available, int MaxStock, int NotifyAt, DateTimeOffset? NextAt, int IntervalSeconds,
    int Essence, int EssencePerCapsule, int PityIn, int TotalOpened, DateTimeOffset ServerTime,
    int PremiumAvailable, int EssencePerPremium, bool Debug = false);

public sealed record CapsuleDropDto(CapsuleItemKind Kind, int ItemId, Rarity Rarity, bool IsNew, int Count, int Essence, bool Guaranteed);

public sealed record OpenCapsulesRequest(int Count, CapsuleType Type = CapsuleType.STANDARD);
public sealed record BuyCapsuleRequest(CapsuleType Type = CapsuleType.STANDARD);
public sealed record OpenCapsulesResponse(List<CapsuleDropDto> Drops, CapsuleStateDto State);

public sealed record OwnedItemDto(CapsuleItemKind Kind, int ItemId, int Count, DateTimeOffset FirstObtainedAt);
public sealed record CapsuleHistoryDto(CapsuleItemKind Kind, int ItemId, Rarity Rarity, bool IsNew, DateTimeOffset OpenedAt);
public sealed record CollectionResponse(List<OwnedItemDto> Items, List<CapsuleHistoryDto> Recent, List<RosterSlotDto?> Roster);

/// <summary>Objet placé à un poste du roster (TOP, JUNGLE, MID, BOT, SUPPORT dans cet ordre).</summary>
public sealed record RosterSlotDto(CapsuleItemKind Kind, int ItemId);
public sealed record RosterRequest(List<RosterSlotDto?> Slots);
public sealed record PlayerCardDto(
    Guid UserId, string DisplayName, string? RiotId, int? ProfileIconId, int Owned, int TotalOpened, List<RosterSlotDto?> Roster, bool Added);
public sealed record PlayerCollectionDto(PlayerCardDto Player, List<OwnedItemDto> Items);
/// <summary>Riot ID / pseudo saisi, ou identifiant d'un joueur déjà affiché (suggestion).</summary>
public sealed record AddFriendRequest(string? Query, Guid? UserId = null);

public sealed record CatalogChampionDto(int Id, string Name, string Alias, string[] Roles, Api.Domain.Battle.Talent Talent);
public sealed record CatalogSkinDto(int Id, int ChampionId, int Num, string Name, Rarity Rarity, int[] Lines, bool Legacy, string? Load);
public sealed record CatalogLineDto(int Id, string Name);
public sealed record RarityOddsDto(Rarity Rarity, double Percent, int DuplicateEssence);
/// <summary>Taux d'un type de capsule et son prix en essence.</summary>
public sealed record CapsuleOddsDto(CapsuleType Type, int EssenceCost, List<RarityOddsDto> Rates);
public sealed record CapsuleCatalogDto(
    List<CatalogChampionDto> Champions, List<CatalogSkinDto> Skins, List<CatalogLineDto> Lines, List<CapsuleOddsDto> Odds, int PityThreshold);

public sealed record DebugGrantRequest(int Count, int Essence = 0, int Premium = 0);

public sealed record PushKeyDto(string? PublicKey);
public sealed record PushSubscribeRequest(string Endpoint, string P256dh, string Auth);
public sealed record PushUnsubscribeRequest(string Endpoint);
