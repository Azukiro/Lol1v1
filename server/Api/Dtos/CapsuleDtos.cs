using Api.Domain.Capsules;

namespace Api.Dtos;

public sealed record CapsuleStateDto(
    int Available, int MaxStock, int NotifyAt, DateTimeOffset? NextAt, int IntervalSeconds,
    int Essence, int EssencePerCapsule, int PityIn, int TotalOpened, DateTimeOffset ServerTime, bool Debug = false);

public sealed record CapsuleDropDto(CapsuleItemKind Kind, int ItemId, Rarity Rarity, bool IsNew, int Count, int Essence, bool Guaranteed);

public sealed record OpenCapsulesRequest(int Count);
public sealed record OpenCapsulesResponse(List<CapsuleDropDto> Drops, CapsuleStateDto State);

public sealed record OwnedItemDto(CapsuleItemKind Kind, int ItemId, int Count, DateTimeOffset FirstObtainedAt);
public sealed record CapsuleHistoryDto(CapsuleItemKind Kind, int ItemId, Rarity Rarity, bool IsNew, DateTimeOffset OpenedAt);
public sealed record CollectionResponse(List<OwnedItemDto> Items, List<CapsuleHistoryDto> Recent);

public sealed record CatalogChampionDto(int Id, string Name, string Alias);
public sealed record CatalogSkinDto(int Id, int ChampionId, int Num, string Name, Rarity Rarity, int[] Lines, bool Legacy, string? Load);
public sealed record CatalogLineDto(int Id, string Name);
public sealed record RarityOddsDto(Rarity Rarity, double Percent, int DuplicateEssence);
public sealed record CapsuleCatalogDto(
    List<CatalogChampionDto> Champions, List<CatalogSkinDto> Skins, List<CatalogLineDto> Lines, List<RarityOddsDto> Odds, int PityThreshold);

public sealed record DebugGrantRequest(int Count, int Essence = 0);

public sealed record PushKeyDto(string? PublicKey);
public sealed record PushSubscribeRequest(string Endpoint, string P256dh, string Auth);
public sealed record PushUnsubscribeRequest(string Endpoint);
