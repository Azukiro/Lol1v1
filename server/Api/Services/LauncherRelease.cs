using System.Globalization;
using System.Text.RegularExpressions;

namespace Api.Services;

/// <summary>
/// Installeur Windows embarqué dans l'image Docker (dossier updates/, copié depuis l'image
/// ghcr.io/…-launcher publiée par la CI client). Sert la page vitrine (/download) et le flux
/// de mise à jour d'electron-updater (/updates/latest.yml).
/// </summary>
public sealed partial class LauncherReleaseService(IConfiguration config, IWebHostEnvironment env)
{
    public sealed record Launcher(string Version, string FileName, long Size, DateTimeOffset? PublishedAt);

    public string UpdatesPath { get; } = Path.GetFullPath(config["Launcher:UpdatesPath"] ?? Path.Combine(env.ContentRootPath, "updates"));

    /// <summary>Lu à chaque appel : quelques lignes, et le dossier ne change qu'au redéploiement.</summary>
    public Launcher? GetLatest()
    {
        var manifest = Path.Combine(UpdatesPath, "latest.yml");
        if (!File.Exists(manifest)) return null;
        var yml = File.ReadAllText(manifest);
        var version = Field(yml, "version");
        var path = Field(yml, "path");
        if (version is null || path is null || !File.Exists(Path.Combine(UpdatesPath, path))) return null;
        var size = new FileInfo(Path.Combine(UpdatesPath, path)).Length;
        var published = DateTimeOffset.TryParse(Field(yml, "releaseDate"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : (DateTimeOffset?)null;
        return new Launcher(version, path, size, published);
    }

    // Champs de premier niveau de latest.yml (« clé: valeur », valeur éventuellement entre quotes).
    private static string? Field(string yml, string key)
    {
        var m = TopLevelField().Matches(yml).FirstOrDefault(m => m.Groups[1].Value == key);
        return m?.Groups[2].Value.Trim().Trim('\'', '"');
    }

    [GeneratedRegex(@"^([A-Za-z]+):[ \t]*(.+?)[ \t]*$", RegexOptions.Multiline)]
    private static partial Regex TopLevelField();
}
