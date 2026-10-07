using Api.Data;
using Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Api.Services;

public sealed record NotifierEvent(string Name, object? Payload, Guid? UserId, bool IsStateChange = false)
{
    public static NotifierEvent All(string name, object payload) => new(name, payload, null);
    public static NotifierEvent To(Guid userId, string name, object payload) => new(name, payload, userId);
    public static readonly NotifierEvent StateChanged = new("SeriesUpdated", null, null, true);
}

public interface ISeriesNotifier
{
    void Enqueue(Series series, NotifierEvent evt);
    void Discard(Series series);
    Task FlushAsync(SeriesService service, Series series);
    Task SendToUserAsync(Guid userId, string name, object payload);
}

/// <summary>
/// File d'événements SignalR envoyés seulement après la sauvegarde en base.
/// Chaque joueur reçoit un état projeté pour lui (choix adverses masqués).
/// </summary>
public sealed class SeriesNotifier(IHubContext<SeriesHub> hub) : ISeriesNotifier
{
    private readonly Dictionary<Guid, List<NotifierEvent>> _pending = new();

    public static string UserGroup(Guid userId) => $"user:{userId}";

    public void Enqueue(Series series, NotifierEvent evt)
    {
        if (!_pending.TryGetValue(series.Id, out var list)) _pending[series.Id] = list = [];
        list.Add(evt);
    }

    public void Discard(Series series) => _pending.Remove(series.Id);

    public async Task FlushAsync(SeriesService service, Series series)
    {
        if (!_pending.Remove(series.Id, out var events)) return;
        foreach (var evt in events.Where(e => !e.IsStateChange))
        {
            var targets = evt.UserId is { } uid ? [uid] : series.Players.Select(p => p.UserId).ToArray();
            foreach (var userId in targets)
                await hub.Clients.Group(UserGroup(userId)).SendAsync(evt.Name, series.Id, evt.Payload);
        }
        // L'état complet part en dernier : le client a déjà reçu les événements ponctuels.
        foreach (var player in series.Players)
            await hub.Clients.Group(UserGroup(player.UserId)).SendAsync("SeriesUpdated", series.Id, service.BuildState(series, player));
    }

    public Task SendToUserAsync(Guid userId, string name, object payload) =>
        hub.Clients.Group(UserGroup(userId)).SendAsync(name, payload);
}
