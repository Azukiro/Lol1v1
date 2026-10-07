using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Api.Data;
using Microsoft.IdentityModel.Tokens;

namespace Api.Services;

/// <summary>
/// Verrou par série : sérialise les actions concurrentes des deux joueurs (ex. bans soumis
/// au même instant) pour que la révélation n'ait lieu qu'une fois. Une seule instance d'API en V1.
/// </summary>
public sealed class SeriesLocks
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> AcquireAsync(Guid seriesId)
    {
        var sem = _locks.GetOrAdd(seriesId, _ => new SemaphoreSlim(1, 1));
        await sem.WaitAsync();
        return new Releaser(sem);
    }

    private sealed class Releaser(SemaphoreSlim sem) : IDisposable
    {
        public void Dispose() => sem.Release();
    }
}

public sealed class JwtOptions
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "lol1v1";
    public string Audience { get; set; } = "lol1v1-client";
    public int LifetimeDays { get; set; } = 30;
}

public sealed class TokenService(Microsoft.Extensions.Options.IOptions<JwtOptions> options)
{
    public string Create(User user)
    {
        var o = options.Value;
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            o.Issuer, o.Audience,
            [new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()), new Claim(JwtRegisteredClaimNames.Email, user.Email), new Claim("name", user.DisplayName)],
            expires: DateTime.UtcNow.AddDays(o.LifetimeDays),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public static class ClaimsExtensions
{
    public static Guid UserId(this ClaimsPrincipal principal) =>
        Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? throw new UnauthorizedAccessException());
}

/// <summary>Erreur métier renvoyée telle quelle au client (400 en REST, HubException en SignalR).</summary>
public sealed class AppException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
