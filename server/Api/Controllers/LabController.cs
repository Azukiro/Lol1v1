using Api.Domain;
using Api.Domain.Lab;
using Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>Labo : modes de jeu expérimentaux, testables sans toucher aux séries standards.</summary>
[ApiController]
[Authorize]
[Route("api/v1/lab")]
public sealed class LabController : ControllerBase
{
    /// <summary>Pool des objectifs secrets, par palier.</summary>
    [HttpGet("secret-objectives")]
    public List<LabTierDto> Catalog() =>
        Enum.GetValues<ObjectiveTier>().Select(t => new LabTierDto(t.ToString(), SecretObjectives.TierLabel(t), SecretObjectives.TimeLimitSeconds(t),
            SecretObjectives.Pool.Where(o => o.Tier == t).Select(LabMapping.ToDto).ToList())).ToList();

    /// <summary>Tirage d'essai (seed aléatoire), pour visualiser ce que donnerait une manche.</summary>
    [HttpGet("secret-objectives/draw")]
    public LabDrawDto Draw([FromQuery] ObjectiveTier? tier)
    {
        var draw = SecretObjectives.Draw(DrawService.NewSeed(), 1, 1, tier);
        return new LabDrawDto(draw.Tier.ToString(), LabMapping.ToDto(SecretObjectives.Get(draw.A)), LabMapping.ToDto(SecretObjectives.Get(draw.B)));
    }
}
