using System.Text.Json;

namespace Api.Services;

public sealed record ChampionRef(int Id, string Key, string Name, string[] Tags);
public sealed record SpellRef(int Id, string Key, string Name);

public sealed class ReferenceData
{
    public string Version { get; init; } = "";
    public IReadOnlyList<ChampionRef> Champions { get; init; } = [];
    public IReadOnlyList<SpellRef> Spells { get; init; } = [];
}

/// <summary>
/// Champions et sorts depuis Data Dragon (CDN public Riot), chargés au démarrage, sans table maître.
/// Sorts proposés = ceux dont Data Dragon indique le mode ARAM (Abîme hurlant), ou la liste
/// de secours de la configuration si Data Dragon est injoignable.
/// </summary>
public sealed class ReferenceDataService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<ReferenceDataService> logger)
{
    private const string Cdn = "https://ddragon.leagueoflegends.com";

    // Sorts disponibles sur l'Abîme hurlant (P9, à confirmer) : Cleanse, Exhaust, Flash, Ghost, Heal, Clarity, Ignite, Barrier, Mark.
    private static readonly SpellRef[] FallbackSpells =
    [
        new(1, "SummonerBoost", "Purge"), new(3, "SummonerExhaust", "Fatigue"), new(4, "SummonerFlash", "Saut éclair"),
        new(6, "SummonerHaste", "Fantôme"), new(7, "SummonerHeal", "Soins"), new(13, "SummonerMana", "Clarté"),
        new(14, "SummonerDot", "Embrasement"), new(21, "SummonerBarrier", "Barrière"), new(32, "SummonerSnowball", "Marque"),
    ];

    public ReferenceData Current { get; private set; } = new() { Spells = FallbackSpells };

    public IReadOnlyList<int> AllowedSpellIds
    {
        get
        {
            var configured = config.GetSection("Game:AllowedSpellIds").Get<int[]>();
            return configured is { Length: > 0 } ? configured : Current.Spells.Select(s => s.Id).ToList();
        }
    }

    public async Task LoadAsync(CancellationToken ct)
    {
        if (!config.GetValue("Game:LoadDataDragon", true)) return;
        try
        {
            var http = httpFactory.CreateClient("ddragon");
            var locale = config["Game:Locale"] ?? "fr_FR";
            var versions = await http.GetFromJsonAsync<string[]>($"{Cdn}/api/versions.json", ct);
            var version = versions![0];

            using var champDoc = JsonDocument.Parse(await http.GetStringAsync($"{Cdn}/cdn/{version}/data/{locale}/champion.json", ct));
            var champions = champDoc.RootElement.GetProperty("data").EnumerateObject().Select(p => new ChampionRef(
                int.Parse(p.Value.GetProperty("key").GetString()!),
                p.Value.GetProperty("id").GetString()!,
                p.Value.GetProperty("name").GetString()!,
                p.Value.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!).ToArray()))
                .OrderBy(c => c.Name).ToList();

            using var spellDoc = JsonDocument.Parse(await http.GetStringAsync($"{Cdn}/cdn/{version}/data/{locale}/summoner.json", ct));
            var spells = spellDoc.RootElement.GetProperty("data").EnumerateObject()
                .Where(p => p.Value.GetProperty("modes").EnumerateArray().Any(m => m.GetString() == "ARAM"))
                .Select(p => new SpellRef(int.Parse(p.Value.GetProperty("key").GetString()!), p.Value.GetProperty("id").GetString()!, p.Value.GetProperty("name").GetString()!))
                .OrderBy(s => s.Id).ToList();

            Current = new ReferenceData { Version = version, Champions = champions, Spells = spells.Count > 0 ? spells : FallbackSpells };
            logger.LogInformation("Data Dragon {Version} : {Champions} champions, {Spells} sorts ARAM", version, champions.Count, spells.Count);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Data Dragon injoignable, sorts de secours utilisés");
        }
    }
}

public sealed class ReferenceDataLoader(ReferenceDataService service) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => service.LoadAsync(stoppingToken);
}
