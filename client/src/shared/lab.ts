/**
 * Labo « objectifs secrets » : observations génériques et progression.
 * Les remontées ne doivent rien trahir de l'objectif du joueur : on déclare les CS par paliers
 * de 10 quel que soit l'objectif, et on envoie l'horloge de jeu pour le temps limite.
 */
import { extractObservations, LiveGameData, Observation } from './live-events';
import { Facts, WinNode } from './rules-engine';

export const CLOCK_INTERVAL = 30;
const CS_STEP = 10;
const CS_MAX = 400;

/** Expression factice dont seuls les paliers de CS servent : identique pour tous les joueurs. */
const GENERIC_CS: WinNode = {
  op: 'OR',
  children: Array.from({ length: CS_MAX / CS_STEP }, (_, i) => ({
    condition: 'CS' as const,
    threshold: (i + 1) * CS_STEP,
  })),
};

export function labObservations(data: LiveGameData, seen: Set<string>): Observation[] {
  const out = extractObservations(data, GENERIC_CS, seen);
  const time = data.gameData?.gameTime ?? 0;
  const bucket = Math.floor(time / CLOCK_INTERVAL);
  const key = `CLOCK:t-${bucket}`;
  if (bucket > 0 && !seen.has(key)) {
    seen.add(key);
    out.push({
      type: 'CLOCK',
      eventId: `t-${bucket}`,
      eventTime: time,
      payload: { subject: 'SELF' },
    });
  }
  return out;
}

/** Valeur actuelle d'une condition pour un joueur. */
export function conditionValue(leaf: WinNode, facts: Facts): number {
  switch (leaf.condition) {
    case 'KILLS':
      return facts.killTimes.length;
    case 'TOWERS':
      return facts.towerTimes.length;
    case 'CS':
      return Math.max(0, ...facts.csSamples.map((s) => s.value));
    case 'FIRST_BLOOD':
      return facts.firstBloodTime != null ? 1 : 0;
    case 'FIRST_TOWER':
      return facts.firstTowerTime != null ? 1 : 0;
    default:
      return 0;
  }
}

/** Progression 0..1, même règle que le serveur : compteur / seuil, OU = max, ET = moyenne. */
export function progress(node: WinNode, facts: Facts): number {
  if (node.condition)
    return Math.min(1, conditionValue(node, facts) / Math.max(1, node.threshold ?? 1));
  const children = (node.children ?? []).map((c) => progress(c, facts));
  if (!children.length) return 0;
  return node.op === 'OR'
    ? Math.max(...children)
    : children.reduce((a, b) => a + b, 0) / children.length;
}
