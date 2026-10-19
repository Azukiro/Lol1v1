using System.Net;
using System.Text.Json;
using Api.Data;
using Microsoft.EntityFrameworkCore;
using WebPush;

namespace Api.Services;

/// <summary>Clés VAPID (Capsules__Vapid__*). Sans clés, les notifications push sont désactivées.</summary>
public sealed class VapidOptions
{
    public string PublicKey { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    public string Subject { get; set; } = "mailto:admin@duelyst.fr";

    public bool Enabled => PublicKey.Length > 0 && PrivateKey.Length > 0;
}

public sealed class PushService(Microsoft.Extensions.Options.IOptions<VapidOptions> options, ILogger<PushService> logger)
{
    private readonly WebPushClient _client = new();
    public VapidOptions Options => options.Value;

    /// <summary>Envoie à tous les navigateurs du joueur ; les abonnements expirés sont supprimés.</summary>
    public async Task SendAsync(AppDbContext db, Guid userId, object payload, CancellationToken ct = default)
    {
        if (!Options.Enabled) return;
        var vapid = new VapidDetails(Options.Subject, Options.PublicKey, Options.PrivateKey);
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach (var sub in await db.PushSubscriptions.Where(s => s.UserId == userId).ToListAsync(ct))
        {
            try
            {
                await _client.SendNotificationAsync(new PushSubscription(sub.Endpoint, sub.P256dh, sub.Auth), json, vapid, ct);
            }
            catch (WebPushException e) when (e.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
            {
                db.PushSubscriptions.Remove(sub);
            }
            catch (Exception e)
            {
                logger.LogWarning(e, "Échec de notification push pour {UserId}", userId);
            }
        }
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>Toutes les 5 minutes : prévient les joueurs abonnés dont le stock de capsules atteint le seuil.</summary>
public sealed class CapsuleNotifier(IServiceScopeFactory scopes, PushService push, ILogger<CapsuleNotifier> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!push.Options.Enabled)
        {
            logger.LogInformation("Clés VAPID absentes : notifications des capsules désactivées");
            return;
        }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try { await TickAsync(stoppingToken); }
            catch (Exception e) when (e is not OperationCanceledException) { logger.LogWarning(e, "Tour du notificateur de capsules en échec"); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task TickAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var capsules = scope.ServiceProvider.GetRequiredService<CapsuleService>();
        var notifyAt = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<CapsuleOptions>>().Value.NotifyAt;

        var subscribed = db.PushSubscriptions.Select(s => s.UserId);
        var wallets = await db.CapsuleWallets.Where(w => !w.FullNotified && subscribed.Contains(w.UserId)).ToListAsync(ct);
        foreach (var wallet in wallets)
        {
            var available = capsules.AvailableNow(wallet);
            if (available < notifyAt) continue;
            wallet.FullNotified = true;
            await push.SendAsync(db, wallet.UserId, new
            {
                title = $"{available} capsules t'attendent",
                body = "Ton stock est plein : ouvre-les avant de perdre les prochaines.",
                url = "/capsules/",
                tag = "capsules-full",
            }, ct);
        }
        await db.SaveChangesAsync(ct);
    }
}
