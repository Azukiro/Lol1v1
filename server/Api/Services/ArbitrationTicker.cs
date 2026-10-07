using Api.Data;
using Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

/// <summary>
/// Réévalue toutes les 2 s les manches en jeu : une observation vue par un seul client
/// est validée « source unique » une fois le délai de confirmation écoulé.
/// </summary>
public sealed class ArbitrationTicker(IServiceScopeFactory scopes, ILogger<ArbitrationTicker> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var seriesIds = await db.Rounds.Where(r => r.Status == RoundStatus.IN_GAME && r.Observations.Any())
                    .Select(r => r.SeriesId).Distinct().ToListAsync(stoppingToken);
                foreach (var id in seriesIds)
                {
                    using var inner = scopes.CreateScope();
                    await inner.ServiceProvider.GetRequiredService<SeriesService>().TickAsync(id);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Échec de la réévaluation des manches");
            }
        }
    }
}
