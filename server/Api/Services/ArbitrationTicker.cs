using System.Collections.Concurrent;
using Api.Data;
using Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

/// <summary>
/// Séries dont la manche en jeu a des observations à arbitrer, tenues en mémoire (une seule instance d'API en V1).
/// Le ticker ne lit la base que pour elles : sans partie en cours, la base n'est plus interrogée et peut s'endormir
/// (Neon facture le temps où le calcul est éveillé, et s'endort après 5 min sans requête).
/// </summary>
public sealed class ActiveSeries
{
    private readonly ConcurrentDictionary<Guid, byte> _ids = new();
    public void Add(Guid seriesId) => _ids.TryAdd(seriesId, 0);
    public void Remove(Guid seriesId) => _ids.TryRemove(seriesId, out _);
    public IReadOnlyList<Guid> Snapshot() => [.. _ids.Keys];
    public bool IsEmpty => _ids.IsEmpty;
}

/// <summary>
/// Réévalue toutes les 2 s les manches en jeu : une observation que l'équipe adverse n'a pas confirmée
/// une fois le délai de confirmation écoulé met la manche en litige. Une seule lecture de la base au démarrage
/// (manches restées en jeu avant un redémarrage), puis uniquement les séries signalées par <see cref="ActiveSeries"/>.
/// </summary>
public sealed class ArbitrationTicker(IServiceScopeFactory scopes, ActiveSeries active, ILogger<ArbitrationTicker> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await SeedAsync(stoppingToken);
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            if (active.IsEmpty) continue;
            foreach (var id in active.Snapshot())
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    if (!await scope.ServiceProvider.GetRequiredService<SeriesService>().TickAsync(id)) active.Remove(id);
                }
                catch (AppException)
                {
                    active.Remove(id); // série introuvable : plus rien à arbitrer
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "Échec de la réévaluation de la série {SeriesId}", id);
                }
            }
        }
    }

    /// <summary>Manches déjà en jeu au démarrage (redémarrage pendant une partie).</summary>
    private async Task SeedAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ids = await db.Rounds.Where(r => r.Status == RoundStatus.IN_GAME && r.Observations.Any())
                .Select(r => r.SeriesId).Distinct().ToListAsync(ct);
            ids.ForEach(active.Add);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Lecture des manches en jeu au démarrage en échec");
        }
    }
}
