using System.Collections.Concurrent;
using Api.Data;
using Api.Domain.Capsules;
using Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

public sealed class CapsuleOptions
{
    public int IntervalMinutes { get; set; } = 60;
    public int MaxStock { get; set; } = 10;
    /// <summary>Stock à partir duquel une notification push est envoyée.</summary>
    public int NotifyAt { get; set; } = 10;
    /// <summary>Capsules offertes à la première visite.</summary>
    public int WelcomeCapsules { get; set; } = 3;
    public int EssencePerCapsule { get; set; } = 150;
    public int EssencePerPremium { get; set; } = 600;
    public int MaxOpenAtOnce { get; set; } = 10;

    public TimeSpan Interval => TimeSpan.FromMinutes(IntervalMinutes);
}

/// <summary>Verrou par joueur : deux ouvertures simultanées ne dépensent pas la même capsule. Une seule instance d'API en V1.</summary>
public sealed class CapsuleLocks
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> AcquireAsync(Guid userId)
    {
        var sem = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await sem.WaitAsync();
        return new Releaser(sem);
    }

    private sealed class Releaser(SemaphoreSlim sem) : IDisposable
    {
        public void Dispose() => sem.Release();
    }
}

public sealed class CapsuleService(
    AppDbContext db, CapsuleCatalogService catalogs, CapsuleLocks locks, TimeProvider clock,
    Microsoft.Extensions.Options.IOptions<CapsuleOptions> options)
{
    private readonly CapsuleOptions _o = options.Value;

    public async Task<CapsuleStateDto> GetStateAsync(Guid userId)
    {
        var wallet = await GetOrCreateWalletAsync(userId);
        Normalize(wallet);
        await db.SaveChangesAsync();
        return ToDto(wallet);
    }

    public async Task<OpenCapsulesResponse> OpenAsync(Guid userId, int count, CapsuleType type = CapsuleType.STANDARD)
    {
        if (count < 1 || count > _o.MaxOpenAtOnce) throw new AppException($"Entre 1 et {_o.MaxOpenAtOnce} reliques à la fois.");
        var catalog = await catalogs.GetAsync();
        using var _ = await locks.AcquireAsync(userId);

        var wallet = await GetOrCreateWalletAsync(userId);
        Normalize(wallet);
        var premium = type == CapsuleType.PREMIUM;
        var stock = premium ? wallet.PremiumStored : wallet.Stored;
        if (stock < count) throw new AppException(stock == 0 ? $"Aucune relique{(premium ? " prestige" : "")} disponible." : $"Seulement {stock} relique(s) disponible(s).", 409);

        var owned = await db.CollectionItems.Where(c => c.UserId == userId).ToDictionaryAsync(c => (c.Kind, c.ItemId));
        var available = Enum.GetValues<Rarity>().Where(r => r == CapsuleRules.ChampionRarity ? catalog.Champions.Count > 0 : catalog.SkinsByRarity[r].Any()).ToHashSet();
        var now = clock.GetUtcNow();
        var drops = new List<CapsuleDropDto>();

        for (var i = 0; i < count; i++)
        {
            var guaranteed = wallet.SinceEpic >= CapsuleRules.PityThreshold - 1;
            var rarity = CapsuleRules.RollRarity(CryptoRandom.Instance, type, guaranteed, available);
            var (kind, itemId) = Pick(catalog, rarity, owned);

            owned.TryGetValue((kind, itemId), out var item);
            var isNew = item is null;
            var essence = 0;
            if (item is null)
            {
                item = new CollectionItem { UserId = userId, Kind = kind, ItemId = itemId, FirstObtainedAt = now };
                db.CollectionItems.Add(item);
                owned[(kind, itemId)] = item;
            }
            else
            {
                essence = CapsuleRules.DuplicateEssence(rarity);
                wallet.Essence += essence;
            }
            item.Count++;

            wallet.SinceEpic = rarity >= Rarity.EPIC ? 0 : wallet.SinceEpic + 1;
            wallet.TotalOpened++;
            if (premium) wallet.PremiumStored--; else wallet.Stored--;
            db.CapsuleDrops.Add(new CapsuleDrop { UserId = userId, Kind = kind, ItemId = itemId, Rarity = rarity, IsNew = isNew, OpenedAt = now });
            drops.Add(new CapsuleDropDto(kind, itemId, rarity, isNew, item.Count, essence, guaranteed && !premium && rarity >= Rarity.EPIC));
        }
        if (wallet.Stored < _o.NotifyAt) wallet.FullNotified = false;
        await db.SaveChangesAsync();
        return new OpenCapsulesResponse(drops, ToDto(wallet));
    }

    /// <summary>Échange de l'essence des doublons contre une capsule (standard ou prestige).</summary>
    public async Task<CapsuleStateDto> BuyAsync(Guid userId, CapsuleType type = CapsuleType.STANDARD)
    {
        using var _ = await locks.AcquireAsync(userId);
        var wallet = await GetOrCreateWalletAsync(userId);
        var cost = EssenceCost(type);
        if (wallet.Essence < cost) throw new AppException($"Il faut {cost} essences pour une relique{(type == CapsuleType.PREMIUM ? " prestige" : "")}.", 409);
        Normalize(wallet);
        wallet.Essence -= cost;
        if (type == CapsuleType.PREMIUM) wallet.PremiumStored++; else wallet.Stored++;
        await db.SaveChangesAsync();
        return ToDto(wallet);
    }

    /// <summary>Mode debug (environnement Development uniquement) : ajoute des capsules et de l'essence sans limite.</summary>
    public async Task<CapsuleStateDto> DebugGrantAsync(Guid userId, int count, int essence, int premium)
    {
        using var _ = await locks.AcquireAsync(userId);
        var wallet = await GetOrCreateWalletAsync(userId);
        Normalize(wallet);
        wallet.Stored = Math.Clamp(wallet.Stored + count, 0, 999);
        wallet.Essence = Math.Max(0, wallet.Essence + essence);
        wallet.PremiumStored = Math.Clamp(wallet.PremiumStored + premium, 0, 999);
        await db.SaveChangesAsync();
        return ToDto(wallet);
    }

    /// <summary>Mode debug : vide la collection, l'historique et le portefeuille.</summary>
    public async Task<CapsuleStateDto> DebugResetAsync(Guid userId)
    {
        using var _ = await locks.AcquireAsync(userId);
        db.CollectionItems.RemoveRange(await db.CollectionItems.Where(c => c.UserId == userId).ToListAsync());
        db.CapsuleDrops.RemoveRange(await db.CapsuleDrops.Where(d => d.UserId == userId).ToListAsync());
        db.CapsuleWallets.RemoveRange(await db.CapsuleWallets.Where(w => w.UserId == userId).ToListAsync());
        await db.SaveChangesAsync();
        return await GetStateAsync(userId);
    }

    public async Task<CollectionResponse> GetCollectionAsync(Guid userId)
    {
        var items = await db.CollectionItems.Where(c => c.UserId == userId).ToListAsync();
        var recent = await db.CapsuleDrops.Where(d => d.UserId == userId).OrderByDescending(d => d.OpenedAt).Take(30).ToListAsync();
        var roster = await db.CapsuleWallets.Where(w => w.UserId == userId).Select(w => w.Roster).FirstOrDefaultAsync();
        return new CollectionResponse(
            items.Select(i => new OwnedItemDto(i.Kind, i.ItemId, i.Count, i.FirstObtainedAt)).ToList(),
            recent.Select(d => new CapsuleHistoryDto(d.Kind, d.ItemId, d.Rarity, d.IsNew, d.OpenedAt)).ToList(),
            RelicSocialService.ParseRoster(roster));
    }

    public CapsuleCatalogDto ToCatalogDto(CapsuleCatalog c)
    {
        return new CapsuleCatalogDto(
            c.Champions.Select(x => new CatalogChampionDto(x.Id, x.Name, x.Alias)).ToList(),
            c.Skins.Select(x => new CatalogSkinDto(x.Id, x.ChampionId, x.Num, x.Name, x.Rarity, x.Lines, x.Legacy, x.LoadPath)).ToList(),
            c.Lines.Select(x => new CatalogLineDto(x.Id, x.Name)).ToList(),
            Enum.GetValues<CapsuleType>().Select(t =>
            {
                var weights = CapsuleRules.WeightsFor(t);
                var total = (double)weights.Values.Sum();
                return new CapsuleOddsDto(t, EssenceCost(t),
                    weights.Select(w => new RarityOddsDto(w.Key, Math.Round(w.Value / total * 100, 2), CapsuleRules.DuplicateEssence(w.Key))).ToList());
            }).ToList(),
            CapsuleRules.PityThreshold);
    }

    public int EssenceCost(CapsuleType type) => type == CapsuleType.PREMIUM ? _o.EssencePerPremium : _o.EssencePerCapsule;

    /// <summary>Stock courant d'un portefeuille (sans l'enregistrer), pour le notificateur.</summary>
    public int AvailableNow(CapsuleWallet wallet) =>
        CapsuleRules.Accrue(wallet.Stored, wallet.AccrualAnchor, clock.GetUtcNow(), _o.MaxStock, _o.Interval).Available;

    /// <summary>Champion ou skin de la rareté tirée ; un doublon est retiré une fois pour favoriser les nouveautés.</summary>
    private static (CapsuleItemKind Kind, int Id) Pick(CapsuleCatalog catalog, Rarity rarity, Dictionary<(CapsuleItemKind, int), CollectionItem> owned)
    {
        (CapsuleItemKind, int) Draw() => rarity == CapsuleRules.ChampionRarity
            ? (CapsuleItemKind.CHAMPION, catalog.Champions[CryptoRandom.Instance.Next(catalog.Champions.Count)].Id)
            : (CapsuleItemKind.SKIN, catalog.SkinsByRarity[rarity].ElementAt(CryptoRandom.Instance.Next(catalog.SkinsByRarity[rarity].Count())).Id);
        var first = Draw();
        return owned.ContainsKey(first) ? Draw() : first;
    }

    private async Task<CapsuleWallet> GetOrCreateWalletAsync(Guid userId)
    {
        var wallet = await db.CapsuleWallets.FirstOrDefaultAsync(w => w.UserId == userId);
        if (wallet is not null) return wallet;
        if (!await db.Users.AnyAsync(u => u.Id == userId)) throw new AppException("Compte introuvable.", 401);
        wallet = new CapsuleWallet { UserId = userId, Stored = _o.WelcomeCapsules, AccrualAnchor = clock.GetUtcNow() };
        db.CapsuleWallets.Add(wallet);
        return wallet;
    }

    private void Normalize(CapsuleWallet wallet)
    {
        var (available, anchor) = CapsuleRules.Accrue(wallet.Stored, wallet.AccrualAnchor, clock.GetUtcNow(), _o.MaxStock, _o.Interval);
        wallet.Stored = available;
        wallet.AccrualAnchor = anchor;
    }

    private CapsuleStateDto ToDto(CapsuleWallet w)
    {
        var now = clock.GetUtcNow();
        var nextAt = w.Stored >= _o.MaxStock ? (DateTimeOffset?)null : w.AccrualAnchor + _o.Interval;
        return new CapsuleStateDto(w.Stored, _o.MaxStock, _o.NotifyAt, nextAt, (int)_o.Interval.TotalSeconds,
            w.Essence, _o.EssencePerCapsule, CapsuleRules.PityThreshold - w.SinceEpic, w.TotalOpened, now,
            w.PremiumStored, _o.EssencePerPremium);
    }
}
