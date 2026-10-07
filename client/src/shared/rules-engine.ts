/**
 * Moteur de règles local (non autoritaire) : évalue l'expression de victoire sur les faits
 * vus par ce client, pour un retour immédiat. Le serveur reste le seul arbitre.
 */

export type ConditionCode = 'FIRST_BLOOD' | 'KILLS' | 'FIRST_TOWER' | 'CS';

export interface WinNode {
  op?: 'AND' | 'OR';
  children?: WinNode[];
  condition?: ConditionCode;
  threshold?: number;
}

export interface Facts {
  killTimes: number[];
  firstBloodTime?: number;
  firstTowerTime?: number;
  csSamples: { value: number; time: number }[];
}

export const CONDITION_LABELS: Record<ConditionCode, string> = {
  FIRST_BLOOD: 'First blood',
  KILLS: 'Kills',
  FIRST_TOWER: 'Première tour',
  CS: 'CS',
};

export const MAX_DEPTH = 3;
/** La Live Client Data API ne fournit les CS que par paliers de 10, y compris pour le joueur local. */
export const CS_STEP = 10;

export function needsThreshold(c: ConditionCode): boolean {
  return c === 'KILLS' || c === 'CS';
}

export function emptyFacts(): Facts {
  return { killTimes: [], csSamples: [] };
}

/** Horodatage de jeu auquel l'expression devient vraie (OR = min, AND = max), ou null. */
export function evaluate(node: WinNode, facts: Facts): number | null {
  if (node.condition) {
    switch (node.condition) {
      case 'FIRST_BLOOD':
        return facts.firstBloodTime ?? null;
      case 'FIRST_TOWER':
        return facts.firstTowerTime ?? null;
      case 'KILLS': {
        const sorted = [...facts.killTimes].sort((a, b) => a - b);
        const n = node.threshold ?? 1;
        return sorted.length >= n ? sorted[n - 1] : null;
      }
      case 'CS': {
        const hits = facts.csSamples.filter((s) => s.value >= (node.threshold ?? 1)).map((s) => s.time);
        return hits.length ? Math.min(...hits) : null;
      }
    }
  }
  const results = (node.children ?? []).map((c) => evaluate(c, facts));
  if (node.op === 'OR') {
    const ok = results.filter((r): r is number => r !== null);
    return ok.length ? Math.min(...ok) : null;
  }
  if (results.some((r) => r === null)) return null;
  return Math.max(...(results as number[]));
}

export function describe(node: WinNode, root = true): string {
  if (node.condition) {
    switch (node.condition) {
      case 'FIRST_BLOOD':
        return 'First blood';
      case 'FIRST_TOWER':
        return 'Première tour';
      case 'KILLS':
        return `Kills ≥ ${node.threshold}`;
      case 'CS':
        return `CS ≥ ${node.threshold}`;
    }
  }
  const sep = node.op === 'AND' ? ' ET ' : ' OU ';
  const inner = (node.children ?? []).map((c) => describe(c, false)).join(sep);
  return root ? inner : `(${inner})`;
}

/** Même validation que le serveur, pour un retour immédiat dans le formulaire. */
export function validate(node: WinNode | undefined, depth = 1): string | null {
  if (!node) return 'Expression manquante.';
  if (depth > MAX_DEPTH) return `Profondeur maximale : ${MAX_DEPTH}.`;
  if (node.condition) {
    if (needsThreshold(node.condition) && (!node.threshold || node.threshold <= 0)) return `${CONDITION_LABELS[node.condition]} : seuil > 0 requis.`;
    if (node.condition === 'CS' && node.threshold! % CS_STEP !== 0) return `CS : multiple de ${CS_STEP} (le jeu ne donne les CS que par dizaines).`;
    return null;
  }
  if (node.op !== 'AND' && node.op !== 'OR') return 'Opérateur ET / OU attendu.';
  if (!node.children || node.children.length < 2) return 'Au moins deux conditions par opérateur.';
  for (const c of node.children) {
    const err = validate(c, depth + 1);
    if (err) return err;
  }
  return null;
}

/** Liste plate des conditions (pour l'affichage de la progression). */
export function leaves(node: WinNode): WinNode[] {
  return node.condition ? [node] : (node.children ?? []).flatMap(leaves);
}

export function csThresholds(node: WinNode): number[] {
  return leaves(node).filter((l) => l.condition === 'CS').map((l) => l.threshold ?? 0);
}
