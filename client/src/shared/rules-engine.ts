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
  if (depth === 1) {
    const useless = redundancy(node);
    if (useless) return useless;
  }
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

/** `a` entraîne `b` : même condition, seuil au moins aussi haut (Kills ≥ 3 entraîne Kills ≥ 2). */
function implies(a: WinNode, b: WinNode): boolean {
  return a.condition === b.condition && (a.threshold ?? 0) >= (b.threshold ?? 0);
}

/**
 * Cherche une partie inutile de la règle (« Tour OU (Kills ≥ 2 ET Tour) » : la parenthèse ne change rien).
 * La règle est vue comme des termes reliés par l'opérateur racine, chaque terme étant un ensemble de
 * conditions reliées par l'opérateur inverse. Un terme est inutile quand un autre l'absorbe :
 *  - racine OU (termes en ET) : B est inutile si chaque condition de A est entraînée par une de B ;
 *  - racine ET (termes en OU) : B est inutile si chaque condition de A entraîne une de B.
 * Au-delà de deux niveaux (non produit par l'éditeur), seule la profondeur est contrôlée.
 */
export function redundancy(node: WinNode): string | null {
  if (node.condition) return null;
  const rootOp = node.op;
  const terms: WinNode[][] = [];
  for (const child of node.children ?? []) {
    if (child.condition) terms.push([child]);
    else if (child.op === rootOp) terms.push(...(child.children ?? []).map((c) => [c]));
    else if ((child.children ?? []).some((c) => !c.condition)) return null;
    else terms.push(child.children ?? []);
  }
  const label = (term: WinNode[]) => (term.length === 1 ? describe(term[0]) : `(${term.map((c) => describe(c)).join(rootOp === 'OR' ? ' ET ' : ' OU ')})`);
  for (const term of terms) {
    const codes = term.map((c) => c.condition);
    const dup = codes.find((code, i) => codes.indexOf(code) !== i);
    if (dup) return `${CONDITION_LABELS[dup]} apparaît deux fois dans ${label(term)}.`;
  }
  for (let a = 0; a < terms.length; a++) {
    for (let b = 0; b < terms.length; b++) {
      if (a === b) continue;
      const absorbs = terms[a].every((x) => terms[b].some((y) => (rootOp === 'OR' ? implies(y, x) : implies(x, y))));
      // Termes identiques : on ne signale que le second.
      const identical = absorbs && terms[b].every((y) => terms[a].some((x) => (rootOp === 'OR' ? implies(x, y) : implies(y, x))));
      if (absorbs && (!identical || a < b)) return `${label(terms[b])} ne sert à rien : ${label(terms[a])} ${rootOp === 'OR' ? 'suffit déjà' : 'l’impose déjà'}.`;
    }
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
