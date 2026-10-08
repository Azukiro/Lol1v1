using System.Text.Json;
using Api.Data;
using Api.Domain;
using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(AppDbContext db, IPasswordHasher<User> hasher, TokenService tokens) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (!email.Contains('@') || email.Length > 256) throw new AppException("Email invalide.");
        if (req.Password is null || req.Password.Length < 8) throw new AppException("Mot de passe : 8 caractères minimum.");
        var name = req.DisplayName?.Trim() ?? "";
        if (name.Length is < 2 or > 32) throw new AppException("Pseudo : entre 2 et 32 caractères.");
        if (await db.Users.AnyAsync(u => u.Email == email)) throw new AppException("Un compte existe déjà avec cet email.", 409);

        var user = new User { Email = email, DisplayName = name };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return new AuthResponse(tokens.Create(user), Mapping.ToDto(user));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Include(u => u.RiotAccount).FirstOrDefaultAsync(u => u.Email == email);
        if (user is null || hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
            throw new AppException("Email ou mot de passe incorrect.", 401);
        return new AuthResponse(tokens.Create(user), Mapping.ToDto(user));
    }
}

[ApiController]
[Authorize]
[Route("api/v1")]
public sealed class UsersController(AppDbContext db) : ControllerBase
{
    [HttpGet("me")]
    public async Task<UserDto> Me()
    {
        var user = await db.Users.Include(u => u.RiotAccount).FirstOrDefaultAsync(u => u.Id == User.UserId())
            ?? throw new AppException("Compte introuvable.", 401);
        return Mapping.ToDto(user);
    }

    /// <summary>Liaison du compte Riot à partir des informations lues via la LCU.</summary>
    [HttpPost("riot-accounts/link")]
    public async Task<RiotAccountDto> Link(LinkRiotRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Puuid) || string.IsNullOrWhiteSpace(req.GameName) || string.IsNullOrWhiteSpace(req.TagLine))
            throw new AppException("Informations Riot incomplètes.");
        var userId = User.UserId();
        var taken = await db.RiotAccounts.FirstOrDefaultAsync(r => r.Puuid == req.Puuid);
        if (taken is not null && taken.UserId != userId) throw new AppException("Ce compte Riot est déjà lié à un autre compte.", 409);

        var account = await db.RiotAccounts.FirstOrDefaultAsync(r => r.UserId == userId);
        if (account is null)
        {
            account = new RiotAccount { UserId = userId };
            db.RiotAccounts.Add(account);
        }
        account.Puuid = req.Puuid;
        account.GameName = req.GameName.Trim();
        account.TagLine = req.TagLine.Trim();
        account.RiotIdNormalized = Mapping.NormalizeRiotId(account.GameName, account.TagLine);
        account.Region = req.Region?.Trim() ?? "";
        if (req.ProfileIconId is > 0) account.ProfileIconId = req.ProfileIconId;
        account.LinkedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return Mapping.ToDto(account);
    }

    [HttpGet("users/search")]
    public async Task<ActionResult<PlayerSearchResult>> Search([FromQuery] string riotId)
    {
        var parts = riotId.Split('#', 2);
        if (parts.Length != 2) throw new AppException("Format attendu : Pseudo#TAG.");
        var key = Mapping.NormalizeRiotId(parts[0], parts[1]);
        var account = await db.RiotAccounts.Include(r => r.User).FirstOrDefaultAsync(r => r.RiotIdNormalized == key);
        if (account is null) return NotFound(new { error = "Aucun joueur lié avec ce Riot ID." });
        return new PlayerSearchResult(account.UserId, account.User.DisplayName, account.RiotId, account.ProfileIconId);
    }

    /// <summary>Parmi ces PUUID (amis LoL lus via la LCU), lesquels ont un compte sur l'app.</summary>
    [HttpPost("users/lookup")]
    public async Task<List<RegisteredPlayer>> Lookup(LookupRequest req)
    {
        var puuids = (req.Puuids ?? []).Where(p => !string.IsNullOrWhiteSpace(p)).Distinct().Take(500).ToList();
        if (puuids.Count == 0) return [];
        var accounts = await db.RiotAccounts.Include(r => r.User).Where(r => puuids.Contains(r.Puuid)).ToListAsync();
        return accounts.Select(a => new RegisteredPlayer(a.Puuid, a.UserId, a.User.DisplayName, a.RiotId, a.ProfileIconId)).ToList();
    }

    /// <summary>Adversaires récents (pour l'écran « Nouveau défi »).</summary>
    [HttpGet("users/recent-opponents")]
    public async Task<List<PlayerSearchResult>> Recent()
    {
        var userId = User.UserId();
        var seriesIds = db.SeriesPlayers.Where(p => p.UserId == userId).Select(p => p.SeriesId);
        var opponents = await db.SeriesPlayers.Include(p => p.User).Include(p => p.RiotAccount).Include(p => p.Series)
            .Where(p => seriesIds.Contains(p.SeriesId) && p.UserId != userId)
            .OrderByDescending(p => p.Series.CreatedAt).Take(50).ToListAsync();
        return opponents.DistinctBy(p => p.UserId).Take(5)
            .Select(p => new PlayerSearchResult(p.UserId, p.User.DisplayName, p.RiotAccount.RiotId, p.RiotAccount.ProfileIconId)).ToList();
    }
}

[ApiController]
[Authorize]
[Route("api/v1/presets")]
public sealed class PresetsController(AppDbContext db) : ControllerBase
{
    public const int MaxPerUser = 12;

    [HttpGet]
    public async Task<PresetsResponse> List()
    {
        var userId = User.UserId();
        var mine = await db.UserPresets.Where(p => p.UserId == userId).OrderBy(p => p.CreatedAt).ToListAsync();
        return new PresetsResponse(BuiltInPresets.All.ToList(), mine.Select(ToDto).ToList());
    }

    [HttpPost]
    public async Task<PresetDto> Create(CreatePresetRequest req)
    {
        var userId = User.UserId();
        var name = req.Name?.Trim() ?? "";
        if (name.Length is < 1 or > 40) throw new AppException("Nom : entre 1 et 40 caractères.");
        try { req.Config.Validate(); } catch (DomainException e) { throw new AppException(e.Message); }
        if (await db.UserPresets.CountAsync(p => p.UserId == userId) >= MaxPerUser)
            throw new AppException($"Maximum {MaxPerUser} pré-configurations.");
        var preset = new UserPreset { UserId = userId, Name = name, Config = JsonSerializer.Serialize(req.Config, Mapping.Json) };
        db.UserPresets.Add(preset);
        await db.SaveChangesAsync();
        return ToDto(preset);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var preset = await db.UserPresets.FirstOrDefaultAsync(p => p.Id == id && p.UserId == User.UserId())
            ?? throw new AppException("Pré-configuration introuvable.", 404);
        db.UserPresets.Remove(preset);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static PresetDto ToDto(UserPreset p)
    {
        var config = JsonSerializer.Deserialize<SeriesConfig>(p.Config, Mapping.Json)!;
        return new PresetDto(p.Id.ToString(), p.Name, Mapping.ConfigLabel(config), config, false);
    }
}

[ApiController]
[Authorize]
[Route("api/v1/invitations")]
public sealed class InvitationsController(AppDbContext db, SeriesService seriesService, ISeriesNotifier notifier, TimeProvider clock) : ControllerBase
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    [HttpGet]
    public async Task<List<InvitationDto>> List()
    {
        var userId = User.UserId();
        await ExpireAsync();
        var list = await Query().Where(i => (i.ToUserId == userId || i.FromUserId == userId) && i.Status == InvitationStatus.PENDING)
            .OrderByDescending(i => i.CreatedAt).ToListAsync();
        return list.Select(ToDto).ToList();
    }

    [HttpPost]
    public async Task<InvitationDto> Create(CreateInvitationRequest req)
    {
        var userId = User.UserId();
        try { req.Config.Validate(); } catch (DomainException e) { throw new AppException(e.Message); }
        var me = await db.Users.Include(u => u.RiotAccount).FirstAsync(u => u.Id == userId);
        if (me.RiotAccount is null) throw new AppException("Lie d'abord ton compte Riot.");

        var parts = (req.ToRiotId ?? "").Split('#', 2);
        if (parts.Length != 2) throw new AppException("Format attendu : Pseudo#TAG.");
        var key = Mapping.NormalizeRiotId(parts[0], parts[1]);
        var target = await db.RiotAccounts.Include(r => r.User).FirstOrDefaultAsync(r => r.RiotIdNormalized == key)
            ?? throw new AppException("Aucun joueur n'a lié ce Riot ID.", 404);
        if (target.UserId == userId) throw new AppException("Tu ne peux pas te défier toi-même.");

        var invitation = new Invitation
        {
            FromUserId = userId,
            ToUserId = target.UserId,
            Config = JsonSerializer.Serialize(req.Config, Mapping.Json),
            CreatedAt = clock.GetUtcNow(),
            ExpiresAt = clock.GetUtcNow() + Lifetime,
        };
        db.Invitations.Add(invitation);
        await db.SaveChangesAsync();
        var dto = ToDto(await Query().FirstAsync(i => i.Id == invitation.Id));
        await notifier.SendToUserAsync(target.UserId, "InvitationReceived", dto);
        return dto;
    }

    [HttpPost("{id:guid}/accept")]
    public async Task<InvitationDto> Accept(Guid id)
    {
        var invitation = await Pending(id);
        var from = await db.Users.Include(u => u.RiotAccount).FirstAsync(u => u.Id == invitation.FromUserId);
        var to = await db.Users.Include(u => u.RiotAccount).FirstAsync(u => u.Id == invitation.ToUserId);
        if (from.RiotAccount is null || to.RiotAccount is null) throw new AppException("Les deux joueurs doivent avoir lié leur compte Riot.");

        var config = JsonSerializer.Deserialize<SeriesConfig>(invitation.Config, Mapping.Json)!;
        var series = seriesService.Create(config, from, from.RiotAccount, to, to.RiotAccount);
        invitation.Status = InvitationStatus.ACCEPTED;
        invitation.SeriesId = series.Id;
        await db.SaveChangesAsync();
        var dto = ToDto(await Query().FirstAsync(i => i.Id == id));
        await notifier.SendToUserAsync(invitation.FromUserId, "InvitationUpdated", dto);
        return dto;
    }

    [HttpPost("{id:guid}/decline")]
    public async Task<InvitationDto> Decline(Guid id)
    {
        var invitation = await Pending(id);
        invitation.Status = InvitationStatus.DECLINED;
        await db.SaveChangesAsync();
        var dto = ToDto(await Query().FirstAsync(i => i.Id == id));
        await notifier.SendToUserAsync(invitation.FromUserId, "InvitationUpdated", dto);
        return dto;
    }

    private async Task<Invitation> Pending(Guid id)
    {
        await ExpireAsync();
        var invitation = await db.Invitations.FirstOrDefaultAsync(i => i.Id == id) ?? throw new AppException("Invitation introuvable.", 404);
        if (invitation.ToUserId != User.UserId()) throw new AppException("Cette invitation ne t'est pas destinée.", 403);
        if (invitation.Status != InvitationStatus.PENDING) throw new AppException($"Invitation déjà traitée ({invitation.Status}).", 409);
        return invitation;
    }

    private async Task ExpireAsync()
    {
        var now = clock.GetUtcNow();
        var expired = await db.Invitations.Where(i => i.Status == InvitationStatus.PENDING && i.ExpiresAt < now).ToListAsync();
        foreach (var i in expired) i.Status = InvitationStatus.EXPIRED;
        if (expired.Count > 0) await db.SaveChangesAsync();
    }

    private IQueryable<Invitation> Query() => db.Invitations
        .Include(i => i.FromUser).ThenInclude(u => u.RiotAccount)
        .Include(i => i.ToUser).ThenInclude(u => u.RiotAccount);

    private static InvitationDto ToDto(Invitation i)
    {
        var config = JsonSerializer.Deserialize<SeriesConfig>(i.Config, Mapping.Json)!;
        return new InvitationDto(i.Id, i.Status.ToString(), config, Mapping.ConfigLabel(config),
            new PlayerSearchResult(i.FromUserId, i.FromUser.DisplayName, i.FromUser.RiotAccount?.RiotId ?? "", i.FromUser.RiotAccount?.ProfileIconId),
            new PlayerSearchResult(i.ToUserId, i.ToUser.DisplayName, i.ToUser.RiotAccount?.RiotId ?? "", i.ToUser.RiotAccount?.ProfileIconId),
            i.CreatedAt, i.ExpiresAt, i.SeriesId);
    }
}

[ApiController]
[Authorize]
[Route("api/v1/series")]
public sealed class SeriesController(SeriesService series) : ControllerBase
{
    [HttpGet]
    public Task<List<SeriesSummaryDto>> List([FromQuery] SeriesStatus? status) => series.ListAsync(User.UserId(), status);

    [HttpGet("history")]
    public Task<List<HistoryEntryDto>> History() => series.HistoryAsync(User.UserId(), finishedOnly: true, take: 50);

    /// <summary>Données brutes des statistiques : toutes les séries du joueur, agrégées côté client.</summary>
    [HttpGet("stats")]
    public Task<List<HistoryEntryDto>> Stats() => series.HistoryAsync(User.UserId(), finishedOnly: false, take: 500);

    [HttpGet("{id:guid}")]
    public Task<SeriesStateDto> Get(Guid id) => series.GetStateAsync(id, User.UserId());

    [HttpPut("{id:guid}/pool")]
    public async Task<SeriesStateDto> Pool(Guid id, PoolRequest req)
    {
        await series.UpdatePoolAsync(id, User.UserId(), req.ChampionIds ?? [], req.FreeChampionIds);
        return await series.GetStateAsync(id, User.UserId());
    }

    [HttpPut("{id:guid}/deck")]
    public async Task<SeriesStateDto> Deck(Guid id, DeckRequest req)
    {
        await series.SetDeckAsync(id, User.UserId(), req.ChampionIds ?? []);
        return await series.GetStateAsync(id, User.UserId());
    }

    [HttpPut("{id:guid}/spell-budget")]
    public async Task<SeriesStateDto> SpellBudget(Guid id, SpellBudgetRequest req)
    {
        await series.SetSpellBudgetAsync(id, User.UserId(), req.Tokens ?? []);
        return await series.GetStateAsync(id, User.UserId());
    }
}

[ApiController]
[Route("api/v1/reference")]
public sealed class ReferenceController(ReferenceDataService reference) : ControllerBase
{
    /// <summary>Champions et sorts (Data Dragon) ; sorts filtrés sur l'Abîme hurlant.</summary>
    [HttpGet]
    public object Get() => new
    {
        reference.Current.Version,
        reference.Current.Champions,
        Spells = reference.Current.Spells.Where(s => reference.AllowedSpellIds.Contains(s.Id)).ToList(),
    };
}

public static class Mapping
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    public static string NormalizeRiotId(string gameName, string tagLine) => $"{gameName.Trim()}#{tagLine.Trim()}".ToLowerInvariant();

    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.DisplayName, u.RiotAccount is null ? null : ToDto(u.RiotAccount));

    public static RiotAccountDto ToDto(RiotAccount r) => new(r.Puuid, r.GameName, r.TagLine, r.Region, r.RiotId, r.ProfileIconId);

    public static string ConfigLabel(SeriesConfig c)
    {
        var mode = c.ChampionMode switch { ChampionMode.MIRROR => "Miroir", ChampionMode.RANDOM => "Aléatoire", _ => "Deck" };
        var spells = c.SpellMode switch { SpellMode.FREE => "Sorts libres", SpellMode.DECK_COMPOSED => "Deck de sorts composé", _ => "Deck de sorts aléatoire" };
        return $"BO{c.BestOf} · {mode} · {spells} · {WinExpression.Describe(c.WinExpression)}";
    }
}
