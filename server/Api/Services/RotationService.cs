using Api.Domain.Battle;
using Api.Dtos;
using Microsoft.Extensions.Options;

namespace Api.Services;

/// <summary>Rotation hebdomadaire des champions prêtés (<see cref="Newcomers.Rotation"/>), calculée à la demande et mise en cache par semaine.</summary>
public sealed class RotationService(CapsuleCatalogService catalogs, IOptions<BattleOptions> options, TimeProvider clock)
{
    private sealed record Snapshot(string WeekId, DateTimeOffset LoadedAt, RotationDto Dto, HashSet<int> Ids);

    // Référence remplacée en bloc : lecture et écriture atomiques entre requêtes.
    private volatile Snapshot? _cache;

    private TimeZoneInfo Zone
    {
        get
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone); }
            catch (Exception) { return TimeZoneInfo.Utc; }
        }
    }

    public static List<NewcomerChampion> Champions(CapsuleCatalog catalog) =>
        catalog.Champions.Select(c => new NewcomerChampion(c.Id, c.Alias, (c.Roles ?? []).Select(BattleRules.ParseClass).OfType<ChampionClass>().ToArray()))
            .ToList();

    /// <summary>Champions prêtés cette semaine (vide si le catalogue n'est pas chargé).</summary>
    public IReadOnlySet<int> CurrentIds() => Current().Ids;

    public RotationDto CurrentDto() => Current().Dto;

    private (RotationDto Dto, HashSet<int> Ids) Current()
    {
        var tz = Zone;
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), tz).DateTime;
        var weekId = Meta.IdOf(local);
        var catalog = catalogs.Current;
        if (_cache is { } c && c.WeekId == weekId && c.LoadedAt == catalog.LoadedAt) return (c.Dto, c.Ids);
        var ids = catalog.IsEmpty ? [] : Newcomers.Rotation(Champions(catalog), Newcomers.Seed(weekId));
        var end = Meta.WeekStart(local).AddDays(7);
        var dto = new RotationDto(weekId, new DateTimeOffset(end, tz.GetUtcOffset(end)).ToUniversalTime(), ids, Newcomers.LoanRarity);
        var set = ids.ToHashSet();
        if (!catalog.IsEmpty) _cache = new Snapshot(weekId, catalog.LoadedAt, dto, set);
        return (dto, set);
    }
}
