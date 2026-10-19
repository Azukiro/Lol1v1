using System.Text.Json;
using Api.Domain.Capsules;

namespace Api.Services;

public sealed record CatalogChampion(int Id, string Name, string Alias);
/// <summary>Skin tirable ; LoadPath = image d'écran de chargement côté CommunityDragon (secours si Data Dragon n'a pas l'image).</summary>
public sealed record CatalogSkin(int Id, int ChampionId, int Num, string Name, Rarity Rarity, int[] Lines, bool Legacy, string? LoadPath);
public sealed record CatalogLine(int Id, string Name);

public sealed class CapsuleCatalog
{
    public IReadOnlyList<CatalogChampion> Champions { get; init; } = [];
    public IReadOnlyList<CatalogSkin> Skins { get; init; } = [];
    public IReadOnlyList<CatalogLine> Lines { get; init; } = [];
    public DateTimeOffset LoadedAt { get; init; }

    private ILookup<Rarity, CatalogSkin>? _byRarity;
    public ILookup<Rarity, CatalogSkin> SkinsByRarity => _byRarity ??= Skins.ToLookup(s => s.Rarity);

    public bool IsEmpty => Champions.Count == 0;
}

/// <summary>
/// Catalogue des capsules (champions, skins, gammes) depuis CommunityDragon, chargé au démarrage puis à la demande
/// si le premier chargement a échoué. Capsules:LoadCatalog=false le désactive (tests).
/// </summary>
public sealed class CapsuleCatalogService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<CapsuleCatalogService> logger)
{
    private const string Cdn = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global";
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _lastAttempt = DateTimeOffset.MinValue;

    public CapsuleCatalog Current { get; private set; } = new();

    /// <summary>Remplace le catalogue (tests).</summary>
    public void Set(CapsuleCatalog catalog) => Current = catalog;

    public async Task<CapsuleCatalog> GetAsync(CancellationToken ct = default)
    {
        if (!Current.IsEmpty || !config.GetValue("Capsules:LoadCatalog", true)) return Current;
        await _gate.WaitAsync(ct);
        try
        {
            // Une tentative par minute au plus quand CommunityDragon est injoignable.
            if (Current.IsEmpty && DateTimeOffset.UtcNow - _lastAttempt > TimeSpan.FromMinutes(1)) await LoadAsync(ct);
        }
        finally { _gate.Release(); }
        if (Current.IsEmpty) throw new AppException("Catalogue des capsules indisponible, réessaie dans une minute.", 503);
        return Current;
    }

    private async Task LoadAsync(CancellationToken ct)
    {
        _lastAttempt = DateTimeOffset.UtcNow;
        try
        {
            var http = httpFactory.CreateClient("ddragon");
            var locale = (config["Game:Locale"] ?? "fr_FR").ToLowerInvariant();
            var baseUrl = $"{Cdn}/{locale}/v1";

            using var champDoc = JsonDocument.Parse(await http.GetStringAsync($"{baseUrl}/champion-summary.json", ct));
            var champions = champDoc.RootElement.EnumerateArray()
                .Select(c => new CatalogChampion(c.GetProperty("id").GetInt32(), c.GetProperty("name").GetString()!, c.GetProperty("alias").GetString()!))
                // Ids ≥ 10 000 : variantes de modes temporaires (ex. Jade_*), pas de vrais champions.
                .Where(c => c.Id is > 0 and < 10_000).OrderBy(c => c.Name).ToList();
            var known = champions.Select(c => c.Id).ToHashSet();

            using var lineDoc = JsonDocument.Parse(await http.GetStringAsync($"{baseUrl}/skinlines.json", ct));
            var lines = lineDoc.RootElement.EnumerateArray()
                .Select(l => new CatalogLine(l.GetProperty("id").GetInt32(), l.GetProperty("name").GetString() ?? ""))
                .Where(l => l.Id > 0 && l.Name.Length > 0).ToList();

            using var skinDoc = JsonDocument.Parse(await http.GetStringAsync($"{baseUrl}/skins.json", ct));
            var skins = new List<CatalogSkin>();
            foreach (var p in skinDoc.RootElement.EnumerateObject())
            {
                var s = p.Value;
                var id = s.GetProperty("id").GetInt32();
                if (s.GetProperty("isBase").GetBoolean() || !known.Contains(id / 1000)) continue;
                var skinLines = s.TryGetProperty("skinLines", out var sl) && sl.ValueKind == JsonValueKind.Array
                    ? sl.EnumerateArray().Select(x => x.GetProperty("id").GetInt32()).Where(x => x > 0).ToArray() : [];
                skins.Add(new CatalogSkin(id, id / 1000, id % 1000, s.GetProperty("name").GetString()!,
                    CapsuleRules.FromGameRarity(s.TryGetProperty("rarity", out var r) ? r.GetString() : null),
                    skinLines,
                    s.TryGetProperty("isLegacy", out var lg) && lg.ValueKind == JsonValueKind.True,
                    AssetPath(s.TryGetProperty("loadScreenPath", out var lp) ? lp.GetString() : null)));
            }
            var usedLines = skins.SelectMany(s => s.Lines).ToHashSet();

            Current = new CapsuleCatalog
            {
                Champions = champions,
                Skins = skins.OrderBy(s => s.Id).ToList(),
                Lines = lines.Where(l => usedLines.Contains(l.Id)).OrderBy(l => l.Name).ToList(),
                LoadedAt = DateTimeOffset.UtcNow,
            };
            logger.LogInformation("Catalogue capsules : {Champions} champions, {Skins} skins, {Lines} gammes", champions.Count, skins.Count, Current.Lines.Count);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "CommunityDragon injoignable, catalogue des capsules non chargé");
        }
    }

    /// <summary>"/lol-game-data/assets/ASSETS/..." → "assets/..." (chemin servi par CommunityDragon, en minuscules).</summary>
    private static string? AssetPath(string? path)
    {
        const string prefix = "/lol-game-data/assets/";
        return path is not null && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? path[prefix.Length..].ToLowerInvariant() : null;
    }
}

public sealed class CapsuleCatalogLoader(CapsuleCatalogService service) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await service.GetAsync(stoppingToken); }
        catch (AppException) { /* nouvelle tentative à la première demande */ }
    }
}
