using Api.Data;
using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Api.Controllers;

/// <summary>Capsules : une par heure, à ouvrir pour collectionner champions et skins (page web /reliques).</summary>
[ApiController]
[Authorize]
[Route("api/v1/capsules")]
public sealed class CapsulesController(
    CapsuleService capsules, CapsuleCatalogService catalogs, PushService push, RelicSocialService social, AppDbContext db, IWebHostEnvironment env)
    : ControllerBase
{
    /// <summary>Mode debug réservé au poste de développement (ASPNETCORE_ENVIRONMENT=Development), jamais en production.</summary>
    private bool DebugEnabled => env.IsDevelopment();

    [HttpGet("state")]
    public async Task<CapsuleStateDto> State() => WithDebug(await capsules.GetStateAsync(User.UserId()));

    [HttpPost("open")]
    public async Task<OpenCapsulesResponse> Open(OpenCapsulesRequest req)
    {
        var res = await capsules.OpenAsync(User.UserId(), req.Count, req.Type);
        return res with { State = WithDebug(res.State) };
    }

    [HttpPost("buy")]
    public async Task<CapsuleStateDto> Buy([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] BuyCapsuleRequest? req) =>
        WithDebug(await capsules.BuyAsync(User.UserId(), req?.Type ?? Api.Domain.Capsules.CapsuleType.STANDARD));

    [HttpPost("debug/grant")]
    public async Task<ActionResult<CapsuleStateDto>> DebugGrant(DebugGrantRequest req) =>
        DebugEnabled ? WithDebug(await capsules.DebugGrantAsync(User.UserId(), req.Count, req.Essence, req.Premium)) : NotFound();

    [HttpPost("debug/reset")]
    public async Task<ActionResult<CapsuleStateDto>> DebugReset() =>
        DebugEnabled ? WithDebug(await capsules.DebugResetAsync(User.UserId())) : NotFound();

    private CapsuleStateDto WithDebug(CapsuleStateDto state) => state with { Debug = DebugEnabled };

    [HttpGet("collection")]
    public Task<CollectionResponse> Collection() => capsules.GetCollectionAsync(User.UserId());

    [HttpPut("roster")]
    public Task<List<RosterSlotDto?>> Roster(RosterRequest req) => social.SetRosterAsync(User.UserId(), req.Slots);

    [HttpGet("friends")]
    public Task<List<PlayerCardDto>> Friends() => social.GetFriendsAsync(User.UserId());

    [HttpPost("friends")]
    public Task<PlayerCardDto> AddFriend(AddFriendRequest req) => social.AddFriendAsync(User.UserId(), req.Query, req.UserId);

    [HttpDelete("friends/{friendId:guid}")]
    public async Task<IActionResult> RemoveFriend(Guid friendId)
    {
        await social.RemoveFriendAsync(User.UserId(), friendId);
        return NoContent();
    }

    /// <summary>Collection et roster d'un autre joueur.</summary>
    [HttpGet("players/{playerId:guid}")]
    public Task<PlayerCollectionDto> Player(Guid playerId) => social.GetPlayerAsync(User.UserId(), playerId);

    /// <summary>Catalogue complet (identique pour tous), mis en cache par le navigateur.</summary>
    [HttpGet("catalog")]
    public async Task<CapsuleCatalogDto> Catalog()
    {
        var catalog = await catalogs.GetAsync(HttpContext.RequestAborted);
        Response.Headers.CacheControl = "private, max-age=21600";
        return capsules.ToCatalogDto(catalog);
    }

    [HttpGet("push/key")]
    public PushKeyDto PushKey() => new(push.Options.Enabled ? push.Options.PublicKey : null);

    [HttpPost("push/subscribe")]
    public async Task<IActionResult> Subscribe(PushSubscribeRequest req)
    {
        if (!push.Options.Enabled) throw new AppException("Notifications non configurées sur le serveur.", 503);
        if (!Uri.TryCreate(req.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" || req.Endpoint.Length > 1024
            || string.IsNullOrWhiteSpace(req.P256dh) || string.IsNullOrWhiteSpace(req.Auth) || req.P256dh.Length > 256 || req.Auth.Length > 128)
            throw new AppException("Abonnement invalide.");
        var userId = User.UserId();
        var sub = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
        if (sub is null) db.PushSubscriptions.Add(sub = new PushSubscriptionEntity { Endpoint = req.Endpoint });
        sub.UserId = userId;
        sub.P256dh = req.P256dh;
        sub.Auth = req.Auth;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("push/unsubscribe")]
    public async Task<IActionResult> Unsubscribe(PushUnsubscribeRequest req)
    {
        var userId = User.UserId();
        db.PushSubscriptions.RemoveRange(await db.PushSubscriptions.Where(s => s.UserId == userId && s.Endpoint == req.Endpoint).ToListAsync());
        await db.SaveChangesAsync();
        return NoContent();
    }
}
