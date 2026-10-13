/**
 * Traduction des données de la Live Client Data API (https://127.0.0.1:2999/liveclientdata/allgamedata)
 * en observations brutes pour le serveur. Les bénéficiaires sont relatifs à l'équipe du joueur local (SELF / OPPONENT) :
 * le serveur les convertit en équipe absolue et croise les remontées des clients. En 1v1, l'équipe se réduit au joueur ;
 * en 2v2, kills, first blood et tours de chaque membre comptent pour son équipe, et les CS sont cumulés.
 */
import { CS_STEP, emptyFacts, Facts } from './rules-engine';

/**
 * CLOCK : temps de jeu, envoyé seulement en mode labo (temps limite).
 * DENIAL : démenti d'un événement adverse introuvable dans nos données (payload.raw = type démenti).
 */
export type ObservationType = 'KILL' | 'FIRST_BLOOD' | 'TURRET' | 'CS' | 'CLOCK' | 'DENIAL';
export type Subject = 'SELF' | 'OPPONENT';

export interface Observation {
  type: ObservationType;
  eventId: string;
  eventTime: number;
  payload: { subject: Subject; value?: number; raw?: string };
}

export interface LivePlayer {
  riotId?: string;
  riotIdGameName?: string;
  summonerName?: string;
  team?: string; // ORDER | CHAOS
  championName?: string;
  scores?: { kills?: number; deaths?: number; creepScore?: number };
}

export interface LiveEvent {
  EventID: number;
  EventName: string;
  EventTime: number;
  KillerName?: string;
  VictimName?: string;
  Recipient?: string;
  TurretKilled?: string;
}

export interface LiveGameData {
  activePlayer?: { riotId?: string; riotIdGameName?: string; summonerName?: string };
  allPlayers?: LivePlayer[];
  events?: { Events?: LiveEvent[] };
  gameData?: { gameTime?: number; gameMode?: string; mapNumber?: number };
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Un nom d'événement correspond-il à ce joueur ? (Riot ID complet, nom de jeu, ou ancien nom d'invocateur) */
export function nameMatches(name: string | undefined, player: LivePlayer | undefined): boolean {
  if (!name || !player) return false;
  const n = norm(name);
  return [player.riotId, player.riotIdGameName, player.summonerName, player.riotId?.split('#')[0]]
    .filter(Boolean)
    .some((candidate) => norm(candidate) === n);
}

export interface Teams {
  self?: LivePlayer;
  /** Mon équipe, moi compris. */
  allies: LivePlayer[];
  enemies: LivePlayer[];
}

export function findTeams(data: LiveGameData): Teams {
  const players = data.allPlayers ?? [];
  const active = data.activePlayer ?? {};
  const self = players.find(
    (p) =>
      (active.riotId && nameMatches(active.riotId, p)) ||
      (active.riotIdGameName && nameMatches(active.riotIdGameName, p)) ||
      (active.summonerName && nameMatches(active.summonerName, p)),
  );
  if (!self) return { allies: [], enemies: [] };
  return {
    self,
    allies: players.filter((p) => p === self || (p.team && p.team === self.team)),
    enemies: players.filter((p) => p !== self && p.team !== self.team),
  };
}

/** CS cumulés d'une équipe. */
function teamCs(team: LivePlayer[]): number {
  return team.reduce((sum, p) => sum + (p.scores?.creepScore ?? 0), 0);
}

/**
 * Équipe propriétaire d'une tour d'après son nom.
 * Ancien format : Turret_T1_… (ORDER) / Turret_T2_… (CHAOS) ; format actuel : Turret_TOrder_… / Turret_TChaos_….
 */
export function turretOwner(turret: string | undefined): 'ORDER' | 'CHAOS' | null {
  if (!turret) return null;
  if (/_T(1|Order)_/i.test(turret)) return 'ORDER';
  if (/_T(2|Chaos)_/i.test(turret)) return 'CHAOS';
  return null;
}

/**
 * Convertit les données de jeu en observations nouvelles. Déduplication par EventID (et par palier de CS)
 * via l'ensemble `seen`, conservé par l'appelant pendant toute la manche.
 */
export function extractObservations(data: LiveGameData, seen: Set<string>): Observation[] {
  const out: Observation[] = [];
  const { self, allies, enemies } = findTeams(data);
  if (!self) return out;

  const subjectOf = (name: string | undefined): Subject | null =>
    allies.some((p) => nameMatches(name, p)) ? 'SELF' : enemies.some((p) => nameMatches(name, p)) ? 'OPPONENT' : null;

  const push = (o: Observation) => {
    const key = `${o.type}:${o.eventId}:${o.payload.subject}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(o);
  };

  for (const e of data.events?.Events ?? []) {
    // L'EventID n'est pas stable entre les deux PC ni après une reconnexion : on identifie par l'horodatage de jeu.
    const id = `t${Math.round(e.EventTime * 1000)}`;
    switch (e.EventName) {
      case 'ChampionKill': {
        // Compte si le jeu attribue le kill à un joueur de l'équipe (y compris coup final d'une tour ou d'un minion).
        const subject = subjectOf(e.KillerName);
        if (subject) push({ type: 'KILL', eventId: `${id}-${subject}`, eventTime: e.EventTime, payload: { subject, raw: e.KillerName } });
        break;
      }
      case 'FirstBlood': {
        const subject = subjectOf(e.Recipient);
        if (subject) push({ type: 'FIRST_BLOOD', eventId: id, eventTime: e.EventTime, payload: { subject, raw: e.Recipient } });
        break;
      }
      case 'TurretKilled': {
        const owner = turretOwner(e.TurretKilled);
        if (!owner || !self.team) break;
        // La tour compte pour l'équipe qui la détruit, c'est-à-dire l'équipe adverse de son propriétaire.
        const subject: Subject = owner === self.team ? 'OPPONENT' : 'SELF';
        push({ type: 'TURRET', eventId: id, eventTime: e.EventTime, payload: { subject, raw: e.TurretKilled } });
        break;
      }
    }
  }

  // CS : toujours remontés (conditions de victoire et récapitulatif), par paliers de 10, cumulés par équipe.
  // Les seuils de CS d'une règle sont des multiples du palier : chacun tombe sur un palier déclaré.
  const time = data.gameData?.gameTime ?? 0;
  const selfCs = teamCs(allies);
  // Auto-déclaration : tous les paliers atteints, même si un relevé en a sauté.
  for (let t = CS_STEP; t <= selfCs; t += CS_STEP) {
    push({ type: 'CS', eventId: `self-${t}`, eventTime: time, payload: { subject: 'SELF', value: selfCs } });
  }
  // Vue de l'équipe adverse, pour le contrôle de plausibilité côté serveur.
  const oppCs = teamCs(enemies);
  const step = Math.floor(oppCs / CS_STEP) * CS_STEP;
  if (enemies.length && step > 0) push({ type: 'CS', eventId: `view-${step}`, eventTime: time, payload: { subject: 'OPPONENT', value: oppCs } });
  return out;
}

/** Faits locaux (non arbitrés) par équipe, pour l'affichage immédiat de la progression. */
export function localFacts(data: LiveGameData): { self: Facts; opponent: Facts } {
  const result = { self: emptyFacts(), opponent: emptyFacts() };
  const { self, allies, enemies } = findTeams(data);
  if (!self) return result;
  const inTeam = (name: string | undefined, team: LivePlayer[]) => team.some((p) => nameMatches(name, p));
  let firstTowerDone = false;
  for (const e of data.events?.Events ?? []) {
    if (e.EventName === 'ChampionKill') {
      if (inTeam(e.KillerName, allies)) result.self.killTimes.push(e.EventTime);
      else if (inTeam(e.KillerName, enemies)) result.opponent.killTimes.push(e.EventTime);
    } else if (e.EventName === 'FirstBlood') {
      if (inTeam(e.Recipient, allies)) result.self.firstBloodTime = e.EventTime;
      else if (inTeam(e.Recipient, enemies)) result.opponent.firstBloodTime = e.EventTime;
    } else if (e.EventName === 'TurretKilled') {
      const owner = turretOwner(e.TurretKilled);
      if (owner && self.team) {
        const by = owner === self.team ? result.opponent : result.self;
        by.towerTimes.push(e.EventTime);
        if (!firstTowerDone) by.firstTowerTime = e.EventTime;
        firstTowerDone = true;
      }
    }
  }
  const time = data.gameData?.gameTime ?? 0;
  result.self.csSamples.push({ value: teamCs(allies), time });
  result.opponent.csSamples.push({ value: teamCs(enemies), time });
  return result;
}

/** Demande de vérification du serveur : événement déclaré par l'équipe adverse seule. Subject relatif à ce client. */
export interface VerifyClaim {
  type: 'KILL' | 'FIRST_BLOOD' | 'TURRET' | 'CS';
  eventTime: number;
  subject: Subject;
  value?: number | null;
}

/** Écart maximal d'horodatage avec l'événement déclaré (même tolérance que le serveur). */
const SAME_EVENT_TOLERANCE = 0.3;

/**
 * Cherche dans nos propres données de jeu l'événement que l'autre équipe déclare.
 * Renvoie l'observation qui le confirme (même format que extractObservations), ou null s'il est introuvable pour l'instant.
 * CS : on renvoie toujours notre vue actuelle des CS de l'équipe concernée, le serveur juge l'écart.
 */
export function verifyClaim(data: LiveGameData, claim: VerifyClaim): Observation | null {
  const { self, allies, enemies } = findTeams(data);
  if (!self) return null;
  const team = claim.subject === 'SELF' ? allies : enemies;
  const time = data.gameData?.gameTime ?? 0;
  if (claim.type === 'CS') {
    const value = teamCs(team);
    return { type: 'CS', eventId: `check-${Math.round(time * 1000)}`, eventTime: time, payload: { subject: claim.subject, value } };
  }
  const inTeam = (name: string | undefined) => team.some((p) => nameMatches(name, p));
  const match = (data.events?.Events ?? []).find((e) => {
    if (Math.abs(e.EventTime - claim.eventTime) > SAME_EVENT_TOLERANCE) return false;
    switch (claim.type) {
      case 'KILL':
        return e.EventName === 'ChampionKill' && inTeam(e.KillerName);
      case 'FIRST_BLOOD':
        return e.EventName === 'FirstBlood' && inTeam(e.Recipient);
      case 'TURRET': {
        const owner = turretOwner(e.TurretKilled);
        if (e.EventName !== 'TurretKilled' || !owner || !self.team) return false;
        return (owner === self.team ? 'OPPONENT' : 'SELF') === claim.subject;
      }
      default:
        return false;
    }
  });
  if (!match) return null;
  const id = `t${Math.round(match.EventTime * 1000)}`;
  return {
    type: claim.type,
    eventId: claim.type === 'KILL' ? `${id}-${claim.subject}` : id,
    eventTime: match.EventTime,
    payload: { subject: claim.subject, raw: match.KillerName ?? match.Recipient ?? match.TurretKilled },
  };
}

/** Démenti envoyé quand l'événement reste introuvable dans nos données. */
export function denial(claim: VerifyClaim): Observation {
  return {
    type: 'DENIAL',
    eventId: `deny-${claim.type}-t${Math.round(claim.eventTime * 1000)}-${claim.subject}`,
    eventTime: claim.eventTime,
    payload: { subject: claim.subject, raw: claim.type },
  };
}
