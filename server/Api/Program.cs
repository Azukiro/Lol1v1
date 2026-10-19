using System.Text;
using System.Text.Json.Serialization;
using Api.Data;
using Api.Hubs;
using Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Render fournit le port d'écoute dans PORT.
if (Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } port)
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (jwt.Key.Length < 32) throw new InvalidOperationException("Jwt:Key doit contenir au moins 32 caractères (variable Jwt__Key).");
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));

// Database:Provider=InMemory : mode démo sans PostgreSQL (données perdues à l'arrêt).
if (builder.Configuration["Database:Provider"] == "InMemory")
    builder.Services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("duelyst"));
else
    builder.Services.AddDbContext<AppDbContext>(o =>
        o.UseNpgsql(builder.Configuration.GetConnectionString("Default")).UseSnakeCaseNamingConvention());

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            NameClaimType = "name",
        };
        // SignalR (WebSocket) transmet le jeton en query string.
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
// Client Electron : jeton Bearer, pas de cookie → toute origine acceptée.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddHttpClient("ddragon", c => c.Timeout = TimeSpan.FromSeconds(20));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<SeriesLocks>();
builder.Services.AddSingleton<ReferenceDataService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<LauncherReleaseService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<ISeriesNotifier, SeriesNotifier>();
builder.Services.AddScoped<SeriesService>();
builder.Services.Configure<CapsuleOptions>(builder.Configuration.GetSection("Capsules"));
builder.Services.Configure<VapidOptions>(builder.Configuration.GetSection("Capsules:Vapid"));
builder.Services.AddSingleton<CapsuleCatalogService>();
builder.Services.AddSingleton<CapsuleLocks>();
builder.Services.AddSingleton<PushService>();
builder.Services.AddScoped<CapsuleService>();
builder.Services.AddHostedService<ReferenceDataLoader>();
if (builder.Configuration.GetValue("Capsules:LoadCatalog", true))
    builder.Services.AddHostedService<CapsuleCatalogLoader>();
builder.Services.AddHostedService<CapsuleNotifier>();
if (builder.Configuration.GetValue("Game:EnableTicker", true))
    builder.Services.AddHostedService<ArbitrationTicker>();

var app = builder.Build();

// V1 : migrations appliquées au démarrage (pas de tâche dédiée sur le plan gratuit).
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (db.Database.IsRelational()) db.Database.Migrate();
    else db.Database.EnsureCreated();
}

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (AppException e)
    {
        ctx.Response.StatusCode = e.Status;
        await ctx.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

// Ancien chemin public des reliques (ex-capsules) : liens et PWA déjà installées.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/capsules", out var rest))
    {
        ctx.Response.Redirect($"/reliques{(rest.HasValue ? rest.Value : "/")}{ctx.Request.QueryString}", permanent: true);
        return;
    }
    await next();
});

// Page vitrine (wwwroot/index.html) servie à la racine.
app.UseDefaultFiles();
app.UseStaticFiles();
// Flux de mise à jour du launcher (latest.yml, installeur, blockmap) embarqué dans l'image.
var launcher = app.Services.GetRequiredService<LauncherReleaseService>();
if (Directory.Exists(launcher.UpdatesPath))
{
    var types = new FileExtensionContentTypeProvider();
    types.Mappings[".yml"] = "text/yaml";
    types.Mappings[".blockmap"] = "application/octet-stream";
    app.UseStaticFiles(new StaticFileOptions
    {
        RequestPath = "/updates",
        FileProvider = new PhysicalFileProvider(launcher.UpdatesPath),
        ContentTypeProvider = types,
        // latest.yml change à chaque version : jamais servi depuis un cache.
        OnPrepareResponse = ctx => { if (ctx.File.Name == "latest.yml") ctx.Context.Response.Headers.CacheControl = "no-cache"; },
    });
}
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }));
// Téléchargement du launcher depuis la page vitrine.
app.MapGet("/download", (LauncherReleaseService releases) =>
    releases.GetLatest() is { } l ? Results.Redirect($"/updates/{Uri.EscapeDataString(l.FileName)}") : Results.NotFound(new { error = "Aucun installeur disponible." }));
app.MapGet("/download/latest", (LauncherReleaseService releases) =>
    releases.GetLatest() is { } l ? Results.Ok(new { l.Version, l.Size, l.PublishedAt }) : Results.NotFound());
app.MapControllers();
app.MapHub<SeriesHub>("/hubs/series");

app.Run();

public partial class Program;
