using System.Net;
using System.Net.Http.Json;
using Api.Data;
using Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests;

public class RelicSecurityTests
{
    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/abc", true)]
    [InlineData("https://wns2-par02p.notify.windows.com/w/?token=abc", true)]
    [InlineData("https://web.push.apple.com/abc", true)]
    [InlineData("http://fcm.googleapis.com/fcm/send/abc", false)]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/abc", false)]
    [InlineData("https://169.254.169.254/latest/meta-data", false)]
    [InlineData("https://localhost/admin", false)]
    [InlineData("https://notify.windows.com.evil.example/x", false)]
    [InlineData("https://evilfcm.googleapis.com.example/x", false)]
    public void Push_endpoints_are_restricted_to_known_push_services(string endpoint, bool allowed) =>
        Assert.Equal(allowed, PushEndpoints.IsAllowed(endpoint));

    [Fact]
    public void Crypto_random_stays_in_range()
    {
        for (var i = 0; i < 2000; i++)
        {
            Assert.InRange(CryptoRandom.Instance.Next(7), 0, 6);
            Assert.InRange(CryptoRandom.Instance.Next(3, 5), 3, 4);
        }
        Assert.Equal(0, CryptoRandom.Instance.Next(0));
    }

    [Fact]
    public async Task Concurrent_wallet_writes_are_rejected_instead_of_double_spending()
    {
        await using var factory = new ApiFactory();
        var http = factory.CreateClient();
        (await http.PostAsJsonAsync("/api/v1/auth/register", new { email = "race@test.fr", password = "password123", displayName = "race" })).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CapsuleWallets.Add(new CapsuleWallet { UserId = db.Users.Single().Id, Stored = 1, AccrualAnchor = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        // Deux requêtes lisent le même portefeuille puis dépensent la même relique.
        using var s1 = factory.Services.CreateScope();
        using var s2 = factory.Services.CreateScope();
        var db1 = s1.ServiceProvider.GetRequiredService<AppDbContext>();
        var db2 = s2.ServiceProvider.GetRequiredService<AppDbContext>();
        var w1 = await db1.CapsuleWallets.SingleAsync();
        var w2 = await db2.CapsuleWallets.SingleAsync();
        w1.Stored--;
        await db1.SaveChangesAsync();
        w2.Stored--;
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db2.SaveChangesAsync());
    }

    [Fact]
    public async Task Login_is_rate_limited()
    {
        await using var factory = new ApiFactory();
        using var limited = factory.WithWebHostBuilder(b => b.UseSetting("RateLimit:Enabled", "true"));
        var http = limited.CreateClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 12; i++)
            statuses.Add((await http.PostAsJsonAsync("/api/v1/auth/login", new { email = "x@test.fr", password = "wrong-password" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, statuses[0]);
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[^1]);
    }

    [Fact]
    public async Task Reliques_page_sends_a_strict_content_security_policy()
    {
        await using var factory = new ApiFactory();
        var res = await factory.CreateClient().GetAsync("/reliques/");
        var csp = string.Join(" ", res.Headers.GetValues("Content-Security-Policy").Concat(res.Content.Headers.TryGetValues("Content-Security-Policy", out var c) ? c : []));
        Assert.Contains("script-src 'self'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
    }
}
