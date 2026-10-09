namespace Api.Domain;

/// <summary>MIRROR_DECK : chacun compose un petit deck, chaque manche tire un champion du deck commun, joué par les deux.</summary>
public enum ChampionMode { MIRROR, RANDOM, DECK, MIRROR_DECK }

public enum SpellMode { FREE, DECK_COMPOSED, DECK_RANDOM }

public enum SeriesStatus { SETUP, BANS, IN_PROGRESS, FINISHED, ABORTED }

public enum RoundStatus { ASSIGNMENT, LOBBY, CHAMP_SELECT, IN_GAME, VOIDED, DISPUTED, VALIDATED }

public enum InvitationStatus { PENDING, ACCEPTED, DECLINED, EXPIRED }

public enum ObservationType { KILL, FIRST_BLOOD, TURRET, CS, CHAMP_LOCK, SPELLS, CLOCK }

public enum Slot { A, B }

public static class SlotExtensions
{
    public static Slot Other(this Slot slot) => slot == Slot.A ? Slot.B : Slot.A;
}
