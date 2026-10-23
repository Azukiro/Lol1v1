namespace Api.Services;

/// <summary>
/// Garde l'instance Render (plan gratuit) éveillée : sans trafic entrant pendant 15 min, elle s'endort et
/// le premier appel subit un démarrage à froid. Toutes les 10 min, l'API appelle son propre /health via son
/// URL publique (RENDER_EXTERNAL_URL, fournie par Render) : la requête repasse par le proxy Render et compte
/// comme trafic entrant. Les tâches planifiées GitHub ne suffisent pas, GitHub les décale de plusieurs heures.
/// Inactif hors Render (variable absente).
/// </summary>
public sealed class KeepAwake(IHttpClientFactory http, IConfiguration config, ILogger<KeepAwake> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var baseUrl = config["RENDER_EXTERNAL_URL"];
        if (string.IsNullOrWhiteSpace(baseUrl)) return;
        var url = baseUrl.TrimEnd('/') + "/health";

        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var response = await http.CreateClient("keepawake").GetAsync(url, stoppingToken);
                if (!response.IsSuccessStatusCode)
                    logger.LogWarning("Ping de maintien en éveil : {Status}", (int)response.StatusCode);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Échec du ping de maintien en éveil");
            }
        }
    }
}
