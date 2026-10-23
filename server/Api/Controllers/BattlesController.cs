using Api.Dtos;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Api.Controllers;

/// <summary>Arène des reliques : combats asynchrones roster contre roster et ladder global.</summary>
[ApiController]
[Authorize]
[Route("api/v1/capsules")]
public sealed class BattlesController(BattleService battles) : ControllerBase
{
    [HttpGet("arena")]
    public Task<ArenaDto> Arena() => battles.GetArenaAsync(User.UserId());

    [HttpGet("battles/preview/{opponentId:guid}")]
    public Task<BattlePreviewDto> Preview(Guid opponentId) => battles.PreviewAsync(User.UserId(), opponentId);

    [HttpPost("battles")]
    [EnableRateLimiting(RateLimits.RelicWrite)]
    public Task<BattleDto> Attack(AttackRequest req) => battles.AttackAsync(User.UserId(), req.OpponentId);

    [HttpGet("battles")]
    public Task<List<BattleSummaryDto>> History() => battles.HistoryAsync(User.UserId());

    [HttpGet("battles/{battleId:guid}")]
    public Task<BattleDto> Battle(Guid battleId) => battles.GetAsync(User.UserId(), battleId);

    [HttpPost("battles/{battleId:guid}/share")]
    [EnableRateLimiting(RateLimits.RelicWrite)]
    public Task<ShareDto> Share(Guid battleId) => battles.ShareAsync(User.UserId(), battleId);

    [HttpPost("seasons/{seasonId}/seen")]
    [EnableRateLimiting(RateLimits.RelicWrite)]
    public async Task<IActionResult> SeasonSeen(string seasonId)
    {
        await battles.MarkSeasonSeenAsync(User.UserId(), seasonId);
        return NoContent();
    }

    [HttpGet("ladder")]
    public Task<LadderDto> Ladder() => battles.LadderAsync(User.UserId());
}

/// <summary>Rejeux partagés : lisibles sans compte, via le code du lien.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/v1/replays")]
public sealed class ReplaysController(BattleService battles) : ControllerBase
{
    [HttpGet("{code}")]
    public Task<BattleDto> Get(string code) => battles.GetSharedAsync(code);
}
