/**
 * Traduction des données de la Live Client Data API (https://127.0.0.1:2999/liveclientdata/allgamedata)
 * en observations brutes pour le serveur. Les bénéficiaires sont relatifs au joueur local (SELF / OPPONENT) :
 * le serveur les convertit en joueur absolu et croise les remontées des deux clients.
 */
import { csThresholds, emptyFacts, Facts, WinNode } from './rules-engine';

export type ObservationType = 'KILL' | 'FIRST_BLOOD' | 'TURRET' | 'CS';
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

export function findPlayers(data: LiveGameData): { self?: LivePlayer; opponent?: LivePlayer } {
  const players = data.allPlayers ?? [];
  const active = data.activePlayer ?? {};
  const self = players.find(
    (p) =>
      (active.riotId && nameMatches(active.riotId, p)) ||
      (active.riotIdGameName && nameMatches(active.riotIdGameName, p)) ||
      (active.summonerName && nameMatches(active.summonerName, p)),
  );
  const opponent = self ? players.find((p) => p !== self && p.team !== self.team) : undefined;
  return { self, opponent };
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
export function extractObservations(data: LiveGameData, expression: WinNode, seen: Set<string>): Observation[] {
  const out: Observation[] = [];
  const { self, opponent } = findPlayers(data);
  if (!self) return out;

  const subjectOf = (name: string | undefined): Subject | null =>
    nameMatches(name, self) ? 'SELF' : nameMatches(name, opponent) ? 'OPPONENT' : null;

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
        // Compte si le jeu attribue le kill au joueur (y compris coup final d'une tour ou d'un minion).
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

  // CS : uniquement si l'expression contient une condition CS.
  const thresholds = csThresholds(expression);
  if (thresholds.length) {
    const time = data.gameData?.gameTime ?? 0;
    const selfCs = self.scores?.creepScore ?? 0;
    // Auto-déclaration : un palier par seuil atteint.
    for (const t of thresholds) {
      if (selfCs >= t) push({ type: 'CS', eventId: `self-${t}`, eventTime: time, payload: { subject: 'SELF', value: selfCs } });
    }
    // Vue de l'adversaire, par paliers de 10, pour le contrôle de plausibilité côté serveur.
    const oppCs = opponent?.scores?.creepScore ?? 0;
    const step = Math.floor(oppCs / 10) * 10;
    if (opponent && step > 0) push({ type: 'CS', eventId: `view-${step}`, eventTime: time, payload: { subject: 'OPPONENT', value: oppCs } });
  }
  return out;
}

/** Faits locaux (non arbitrés) pour l'affichage immédiat de la progression. */
export function localFacts(data: LiveGameData): { self: Facts; opponent: Facts } {
  const result = { self: emptyFacts(), opponent: emptyFacts() };
  const { self, opponent } = findPlayers(data);
  if (!self) return result;
  let firstTowerDone = false;
  for (const e of data.events?.Events ?? []) {
    if (e.EventName === 'ChampionKill') {
      if (nameMatches(e.KillerName, self)) result.self.killTimes.push(e.EventTime);
      else if (nameMatches(e.KillerName, opponent)) result.opponent.killTimes.push(e.EventTime);
    } else if (e.EventName === 'FirstBlood') {
      if (nameMatches(e.Recipient, self)) result.self.firstBloodTime = e.EventTime;
      else if (nameMatches(e.Recipient, opponent)) result.opponent.firstBloodTime = e.EventTime;
    } else if (e.EventName === 'TurretKilled' && !firstTowerDone) {
      const owner = turretOwner(e.TurretKilled);
      if (owner && self.team) {
        firstTowerDone = true;
        if (owner === self.team) result.opponent.firstTowerTime = e.EventTime;
        else result.self.firstTowerTime = e.EventTime;
      }
    }
  }
  const time = data.gameData?.gameTime ?? 0;
  result.self.csSamples.push({ value: self.scores?.creepScore ?? 0, time });
  result.opponent.csSamples.push({ value: opponent?.scores?.creepScore ?? 0, time });
  return result;
}
