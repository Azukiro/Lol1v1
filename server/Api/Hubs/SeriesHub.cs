using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Api.Hubs;

/// <summary>
/// Hub /hubs/series : phases aveugles, révélations, observations en jeu, résultats.
/// Chaque connexion rejoint le groupe de son utilisateur ; les événements de série y sont envoyés
/// avec l'identifiant de série en premier argument.
/// </summary>
[Authorize]
public sealed class SeriesHub(SeriesService series, ILogger<SeriesHub> logger) : Hub
{
    private Guid UserId => Context.User!.UserId();

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, SeriesNotifier.UserGroup(UserId));
        await base.OnConnectedAsync();
    }

    /// <summary>Rejoint une série : renvoie l'état complet (aussi utilisé à la reconnexion).</summary>
    public Task<SeriesStateDto> JoinSeries(Guid seriesId) => Run(() => series.GetStateAsync(seriesId, UserId));

    public Task SubmitBans(Guid seriesId, int[] championIds) => Run(() => series.SubmitBansAsync(seriesId, UserId, championIds));

    public Task SubmitPick(Guid seriesId, int? championId, int[]? spells) => Run(() => series.SubmitPickAsync(seriesId, UserId, championId, spells));

    public Task RequestLaunch(Guid seriesId) => Run(() => series.RequestLaunchAsync(seriesId, UserId));

    public Task ReportChampSelect(Guid seriesId, int championId, bool locked, int[]? spells) =>
        Run(() => series.ReportChampSelectAsync(seriesId, UserId, championId, locked, spells));

    public Task ReportGameStarted(Guid seriesId, long lolGameId, int? championId, int[]? spells) =>
        Run(() => series.ReportGameStartedAsync(seriesId, UserId, lolGameId, championId, spells));

    public Task ReportObservation(Guid seriesId, ObservationReport observation) =>
        Run(() => series.ReportObservationAsync(seriesId, UserId, observation));

    public Task RequestVoidRound(Guid seriesId, string? reason) => Run(() => series.RequestVoidRoundAsync(seriesId, UserId, reason));

    public Task VoteDispute(Guid seriesId, string vote) => Run(() => series.VoteDisputeAsync(seriesId, UserId, vote));

    private async Task Run(Func<Task> action)
    {
        try { await action(); }
        catch (AppException e) { throw new HubException(e.Message); }
        catch (Exception e) when (e is not HubException) { logger.LogError(e, "Erreur hub"); throw new HubException("Erreur serveur."); }
    }

    private async Task<T> Run<T>(Func<Task<T>> action)
    {
        try { return await action(); }
        catch (AppException e) { throw new HubException(e.Message); }
        catch (Exception e) when (e is not HubException) { logger.LogError(e, "Erreur hub"); throw new HubException("Erreur serveur."); }
    }
}
