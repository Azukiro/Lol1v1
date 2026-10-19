using System.Security.Cryptography;

namespace Api.Services;

/// <summary>
/// Random adossé au générateur cryptographique de l'OS : les tirages des reliques ne peuvent pas être prédits
/// à partir des résultats déjà observés (contrairement à Random.Shared).
/// </summary>
public sealed class CryptoRandom : Random
{
    public static readonly CryptoRandom Instance = new();

    public override int Next() => RandomNumberGenerator.GetInt32(int.MaxValue);
    public override int Next(int maxValue) => maxValue <= 0 ? 0 : RandomNumberGenerator.GetInt32(maxValue);
    public override int Next(int minValue, int maxValue) => minValue >= maxValue ? minValue : RandomNumberGenerator.GetInt32(minValue, maxValue);
    public override double NextDouble() => RandomNumberGenerator.GetInt32(1 << 30) / (double)(1 << 30);
    protected override double Sample() => NextDouble();
}

/// <summary>
/// Services Web Push acceptés : le serveur envoie des requêtes vers l'adresse d'abonnement, qui ne doit donc
/// jamais viser un hôte arbitraire (réseau interne, métadonnées du cloud…).
/// </summary>
public static class PushEndpoints
{
    private static readonly string[] Hosts =
    [
        "fcm.googleapis.com",                 // Chrome, Edge (Android), Opera…
        "updates.push.services.mozilla.com",  // Firefox
        "web.push.apple.com",                 // Safari
    ];
    private static readonly string[] Suffixes = [".notify.windows.com", ".push.apple.com"];

    public static bool IsAllowed(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort
        && (Hosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase) || Suffixes.Any(s => uri.Host.EndsWith(s, StringComparison.OrdinalIgnoreCase)));
}

public static class RateLimits
{
    public const string Auth = "auth";
    public const string RelicWrite = "relic-write";
}
