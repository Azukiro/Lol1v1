using System.Text.Json;
using Api.Controllers;
using Api.Data;
using Api.Domain.Capsules;
using Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

/// <summary>
/// Côté social des reliques : roster mis en avant (5 postes), amis suivis et collection d'un autre joueur.
/// Les collections sont visibles par tout joueur connecté ; la liste d'amis (réciproque) sert de raccourci.
/// </summary>
public sealed class RelicSocialService(AppDbContext db)
{
    public const int RosterSize = 5;
    public const int MaxFriends = 100;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };

    public static List<RosterSlotDto?> ParseRoster(string? json)
    {
        var slots = string.IsNullOrEmpty(json) ? [] : JsonSerializer.Deserialize<List<RosterSlotDto?>>(json, Json) ?? [];
        return Enumerable.Range(0, RosterSize).Select(i => i < slots.Count ? slots[i] : null).ToList();
    }

    public async Task<List<RosterSlotDto?>> GetRosterAsync(Guid userId) =>
        ParseRoster(await db.CapsuleWallets.Where(w => w.UserId == userId).Select(w => w.Roster).FirstOrDefaultAsync());

    /// <summary>Place 5 objets possédés (ou null) aux postes TOP, JUNGLE, MID, BOT, SUPPORT.</summary>
    public async Task<List<RosterSlotDto?>> SetRosterAsync(Guid userId, List<RosterSlotDto?>? slots)
    {
        if (slots is null || slots.Count != RosterSize) throw new AppException($"Le roster compte {RosterSize} postes.");
        var picked = slots.Where(s => s is not null).Select(s => (s!.Kind, s.ItemId)).ToList();
        if (picked.Distinct().Count() != picked.Count) throw new AppException("Un même objet ne peut occuper deux postes.");
        var owned = (await db.CollectionItems.Where(c => c.UserId == userId).Select(c => new { c.Kind, c.ItemId }).ToListAsync())
            .Select(c => (c.Kind, c.ItemId)).ToHashSet();
        if (picked.Any(p => !owned.Contains(p))) throw new AppException("Seuls les objets de ta collection peuvent aller dans ton roster.");

        var wallet = await db.CapsuleWallets.FirstOrDefaultAsync(w => w.UserId == userId)
            ?? throw new AppException("Ouvre d'abord une relique.", 409);
        wallet.Roster = JsonSerializer.Serialize(slots, Json);
        await db.SaveChangesAsync();
        return ParseRoster(wallet.Roster);
    }

    /// <summary>Amis ajoutés, puis joueurs déjà croisés en série (suggestions).</summary>
    public async Task<List<PlayerCardDto>> GetFriendsAsync(Guid userId)
    {
        var added = await db.RelicFriends.Where(f => f.UserId == userId).OrderBy(f => f.CreatedAt).Select(f => f.FriendId).ToListAsync();
        var seriesIds = db.SeriesPlayers.Where(p => p.UserId == userId).Select(p => p.SeriesId);
        var met = await db.SeriesPlayers.Where(p => seriesIds.Contains(p.SeriesId) && p.UserId != userId)
            .Select(p => p.UserId).Distinct().Take(50).ToListAsync();
        var ids = added.Concat(met.Except(added)).ToList();
        var cards = await CardsAsync(ids, added.ToHashSet());
        return ids.Where(cards.ContainsKey).Select(id => cards[id]).ToList();
    }

    /// <summary>Ajout par identifiant, par Riot ID (Pseudo#TAG) ou par pseudo exact de l'app.</summary>
    public async Task<PlayerCardDto> AddFriendAsync(Guid userId, string? query, Guid? playerId = null)
    {
        var q = query?.Trim() ?? "";
        Guid friendId;
        if (playerId is { } id)
        {
            if (!await db.Users.AnyAsync(u => u.Id == id)) throw new AppException("Joueur introuvable.", 404);
            friendId = id;
        }
        else if (q.Length < 2) throw new AppException("Indique un Riot ID (Pseudo#TAG) ou un pseudo.");
        else if (q.Contains('#'))
        {
            var parts = q.Split('#', 2);
            var key = Mapping.NormalizeRiotId(parts[0], parts[1]);
            friendId = await db.RiotAccounts.Where(r => r.RiotIdNormalized == key).Select(r => r.UserId).FirstOrDefaultAsync();
            if (friendId == Guid.Empty) throw new AppException("Aucun joueur avec ce Riot ID.", 404);
        }
        else
        {
            var lower = q.ToLower();
            var matches = await db.Users.Where(u => u.DisplayName.ToLower() == lower).Select(u => u.Id).Take(2).ToListAsync();
            if (matches.Count == 0) throw new AppException("Aucun joueur avec ce pseudo.", 404);
            if (matches.Count > 1) throw new AppException("Plusieurs joueurs portent ce pseudo : utilise son Riot ID (Pseudo#TAG).", 409);
            friendId = matches[0];
        }
        if (friendId == userId) throw new AppException("C'est toi !");
        // Amitié réciproque : le lien est créé dans les deux sens.
        var links = await db.RelicFriends
            .Where(f => (f.UserId == userId && f.FriendId == friendId) || (f.UserId == friendId && f.FriendId == userId)).ToListAsync();
        var mine = links.Any(f => f.UserId == userId);
        var theirs = links.Any(f => f.UserId == friendId);
        if (!mine && await db.RelicFriends.CountAsync(f => f.UserId == userId) >= MaxFriends) throw new AppException($"{MaxFriends} amis maximum.", 409);
        if (!theirs && await db.RelicFriends.CountAsync(f => f.UserId == friendId) >= MaxFriends)
            throw new AppException("Sa liste d'amis est pleine.", 409);
        if (!mine) db.RelicFriends.Add(new RelicFriend { UserId = userId, FriendId = friendId });
        if (!theirs) db.RelicFriends.Add(new RelicFriend { UserId = friendId, FriendId = userId });
        await db.SaveChangesAsync();
        return (await CardsAsync([friendId], [friendId]))[friendId];
    }

    /// <summary>Retire l'amitié des deux côtés.</summary>
    public async Task RemoveFriendAsync(Guid userId, Guid friendId)
    {
        db.RelicFriends.RemoveRange(await db.RelicFriends
            .Where(f => (f.UserId == userId && f.FriendId == friendId) || (f.UserId == friendId && f.FriendId == userId)).ToListAsync());
        await db.SaveChangesAsync();
    }

    public async Task<PlayerCollectionDto> GetPlayerAsync(Guid viewerId, Guid playerId)
    {
        var isFriend = await db.RelicFriends.AnyAsync(f => f.UserId == viewerId && f.FriendId == playerId);
        var cards = await CardsAsync([playerId], isFriend ? [playerId] : []);
        if (!cards.TryGetValue(playerId, out var card)) throw new AppException("Joueur introuvable.", 404);
        var items = await db.CollectionItems.Where(c => c.UserId == playerId).ToListAsync();
        return new PlayerCollectionDto(card, items.Select(i => new OwnedItemDto(i.Kind, i.ItemId, i.Count, i.FirstObtainedAt)).ToList());
    }

    public async Task<Dictionary<Guid, PlayerCardDto>> CardsAsync(List<Guid> ids, HashSet<Guid> added)
    {
        if (ids.Count == 0) return [];
        var users = await db.Users.Include(u => u.RiotAccount).Where(u => ids.Contains(u.Id)).ToListAsync();
        var wallets = await db.CapsuleWallets.Where(w => ids.Contains(w.UserId)).ToDictionaryAsync(w => w.UserId);
        var owned = await db.CollectionItems.Where(c => ids.Contains(c.UserId)).GroupBy(c => c.UserId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return users.ToDictionary(u => u.Id, u =>
        {
            wallets.TryGetValue(u.Id, out var w);
            return new PlayerCardDto(u.Id, u.DisplayName, u.RiotAccount?.RiotId, u.RiotAccount?.ProfileIconId,
                owned.GetValueOrDefault(u.Id), w?.TotalOpened ?? 0, ParseRoster(w?.Roster), added.Contains(u.Id));
        });
    }
}
