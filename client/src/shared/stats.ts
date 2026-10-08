/**
 * Statistiques du joueur, calculées à partir de ses séries (GET /series/stats).
 * Fonctions pures : testées hors Angular (shared.test.ts).
 */

export interface StatsPlayerRound {
  championId: number | null;
  kills: number;
  cs: number;
  firstBlood: boolean;
  firstTower: boolean;
}

export interface StatsRound {
  number: number;
  winnerSlot: string | null;
  winningCondition: string | null;
  winningTime: number | null;
  startedAt: string | null;
  endedAt: string | null;
  me: StatsPlayerRound;
  opponent: StatsPlayerRound;
}

export interface StatsSeries {
  series: {
    id: string;
    status: string;
    bestOf: number;
    championMode: string;
    spellMode: string;
    mySlot: string;
    opponentName: string;
    opponentRiotId: string;
    opponentProfileIconId: number | null;
    myWins: number;
    opponentWins: number;
    winnerSlot: string | null;
    createdAt: string;
  };
  rounds: StatsRound[];
  myBans: number[];
  opponentBans: number[];
}

/** Bilan victoires / défaites. */
export interface WinLoss {
  played: number;
  wins: number;
}

/** Taux de victoire en %, null sans partie. */
export function winRate(r: WinLoss): number | null {
  return r.played ? Math.round((r.wins / r.played) * 100) : null;
}

/** Échantillon minimal pour classer un champion ou un adversaire (évite le « 1 partie, 100 % »). */
export const MIN_SAMPLE = 3;

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const rate = (flags: boolean[]) => (flags.length ? Math.round((flags.filter(Boolean).length / flags.length) * 100) : 0);

const isDecided = (e: StatsSeries) => e.series.status === 'FINISHED' && !!e.series.winnerSlot;
const seriesWon = (e: StatsSeries) => e.series.winnerSlot === e.series.mySlot;
const roundWon = (e: StatsSeries, r: StatsRound) => r.winnerSlot === e.series.mySlot;
const chronological = (entries: StatsSeries[]) => [...entries].sort((a, b) => a.series.createdAt.localeCompare(b.series.createdAt));

function duration(r: StatsRound): number | null {
  if (!r.startedAt || !r.endedAt) return null;
  const s = (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000;
  return s > 0 ? s : null;
}

function rounds(entries: StatsSeries[]) {
  return entries.flatMap((e) => e.rounds.map((r) => ({ e, r, won: roundWon(e, r) })));
}

function record<T>(items: T[], won: (t: T) => boolean): WinLoss {
  return { played: items.length, wins: items.filter(won).length };
}

/** Série de résultats en cours (séries décidées, de la plus récente à la plus ancienne). */
export interface Streak {
  wins: boolean;
  count: number;
}

function streak(entries: StatsSeries[]): Streak | null {
  const decided = chronological(entries).filter(isDecided).reverse();
  if (!decided.length) return null;
  const wins = seriesWon(decided[0]);
  let count = 0;
  while (count < decided.length && seriesWon(decided[count]) === wins) count++;
  return { wins, count };
}

/** Série gagnée après avoir été mené au score. */
function isComeback(e: StatsSeries): boolean {
  if (!isDecided(e) || !seriesWon(e)) return false;
  let me = 0;
  let opp = 0;
  for (const r of [...e.rounds].sort((a, b) => a.number - b.number)) {
    if (roundWon(e, r)) me++;
    else opp++;
    if (opp > me) return true;
  }
  return false;
}

// =====================================================================
// Vue d'ensemble
// =====================================================================

export interface Overview {
  series: WinLoss;
  rounds: WinLoss;
  streak: Streak | null;
  comebacks: number;
}

export function overview(entries: StatsSeries[]): Overview {
  const decided = entries.filter(isDecided);
  return {
    series: record(decided, seriesWon),
    rounds: record(rounds(entries), (x) => x.won),
    streak: streak(entries),
    comebacks: decided.filter(isComeback).length,
  };
}

// =====================================================================
// Champions
// =====================================================================

export interface ChampionStats extends WinLoss {
  championId: number;
  avgKills: number;
  avgCs: number;
  firstBloodRate: number;
  firstTowerRate: number;
  /** Temps de jeu le plus court d'une manche gagnée (s). */
  fastestWin: number | null;
  lastPlayed: string;
}

export function championStats(entries: StatsSeries[]): ChampionStats[] {
  const byChamp = new Map<number, { e: StatsSeries; r: StatsRound; won: boolean }[]>();
  for (const x of rounds(entries)) {
    if (x.r.me.championId == null) continue;
    byChamp.set(x.r.me.championId, [...(byChamp.get(x.r.me.championId) ?? []), x]);
  }
  return [...byChamp.entries()]
    .map(([championId, list]) => {
      const winTimes = list.filter((x) => x.won && x.r.winningTime != null).map((x) => x.r.winningTime!);
      return {
        championId,
        ...record(list, (x) => x.won),
        avgKills: avg(list.map((x) => x.r.me.kills)),
        avgCs: avg(list.map((x) => x.r.me.cs)),
        firstBloodRate: rate(list.map((x) => x.r.me.firstBlood)),
        firstTowerRate: rate(list.map((x) => x.r.me.firstTower)),
        fastestWin: winTimes.length ? Math.min(...winTimes) : null,
        lastPlayed: list.map((x) => x.e.series.createdAt).sort().at(-1)!,
      };
    })
    .sort((a, b) => b.played - a.played || b.wins - a.wins);
}

export interface ChampionHighlights {
  best: ChampionStats | null;
  mostPlayed: ChampionStats | null;
  worst: ChampionStats | null;
  fastest: ChampionStats | null;
}

export function championHighlights(stats: ChampionStats[]): ChampionHighlights {
  const ranked = stats.filter((c) => c.played >= MIN_SAMPLE);
  const byRate = [...ranked].sort((a, b) => b.wins / b.played - a.wins / a.played || b.played - a.played);
  const worst = byRate.at(-1);
  const fastest = stats.filter((c) => c.fastestWin != null).sort((a, b) => a.fastestWin! - b.fastestWin!)[0];
  return {
    best: byRate[0] ?? null,
    mostPlayed: stats[0] ?? null,
    worst: worst && worst !== byRate[0] && worst.wins < worst.played ? worst : null,
    fastest: fastest ?? null,
  };
}

export interface BanCount {
  championId: number;
  count: number;
}

function countBans(ids: number[]): BanCount[] {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].map(([championId, count]) => ({ championId, count })).sort((a, b) => b.count - a.count);
}

export function banStats(entries: StatsSeries[]) {
  return {
    againstMe: countBans(entries.flatMap((e) => e.opponentBans)),
    byMe: countBans(entries.flatMap((e) => e.myBans)),
  };
}

// =====================================================================
// Modes de jeu
// =====================================================================

export interface ModeStats {
  key: string;
  series: WinLoss;
  rounds: WinLoss;
  /** Durée moyenne d'une manche (s), null si inconnue. */
  avgDuration: number | null;
}

export function modeStats(entries: StatsSeries[], key: (e: StatsSeries) => string): ModeStats[] {
  const groups = new Map<string, StatsSeries[]>();
  for (const e of entries) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  return [...groups.entries()]
    .map(([k, list]) => {
      const durations = list.flatMap((e) => e.rounds.map(duration)).filter((d): d is number => d != null);
      return {
        key: k,
        series: record(list.filter(isDecided), seriesWon),
        rounds: record(rounds(list), (x) => x.won),
        avgDuration: durations.length ? avg(durations) : null,
      };
    })
    .sort((a, b) => b.rounds.played - a.rounds.played);
}

export interface ConditionShare {
  condition: string;
  count: number;
  percent: number;
}

/** Comment les manches se gagnent (won = true) ou se perdent (won = false). */
export function winConditions(entries: StatsSeries[], won: boolean): ConditionShare[] {
  const list = rounds(entries).filter((x) => x.won === won && x.r.winningCondition);
  const counts = new Map<string, number>();
  for (const x of list) counts.set(x.r.winningCondition!, (counts.get(x.r.winningCondition!) ?? 0) + 1);
  return [...counts.entries()]
    .map(([condition, count]) => ({ condition, count, percent: Math.round((count / list.length) * 100) }))
    .sort((a, b) => b.count - a.count);
}

// =====================================================================
// Adversaires
// =====================================================================

export interface OpponentSummary {
  riotId: string;
  name: string;
  iconId: number | null;
  series: WinLoss;
  rounds: WinLoss;
  streak: Streak | null;
  lastPlayed: string;
}

export function opponents(entries: StatsSeries[]): OpponentSummary[] {
  const groups = new Map<string, StatsSeries[]>();
  for (const e of entries) groups.set(e.series.opponentRiotId, [...(groups.get(e.series.opponentRiotId) ?? []), e]);
  return [...groups.entries()]
    .map(([riotId, list]) => {
      const latest = chronological(list).at(-1)!;
      return {
        riotId,
        name: latest.series.opponentName,
        iconId: latest.series.opponentProfileIconId,
        series: record(list.filter(isDecided), seriesWon),
        rounds: record(rounds(list), (x) => x.won),
        streak: streak(list),
        lastPlayed: latest.series.createdAt,
      };
    })
    .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

/** Meilleur et pire bilan en manches, parmi les adversaires assez affrontés. */
export function opponentHighlights(list: OpponentSummary[]): { favorite: OpponentSummary | null; nemesis: OpponentSummary | null } {
  const ranked = list.filter((o) => o.rounds.played >= MIN_SAMPLE).sort((a, b) => b.rounds.wins / b.rounds.played - a.rounds.wins / a.rounds.played);
  const worst = ranked.at(-1);
  return {
    favorite: ranked[0] ?? null,
    nemesis: worst && worst !== ranked[0] && worst.rounds.wins < worst.rounds.played ? worst : null,
  };
}

export interface ChampionRecord extends WinLoss {
  championId: number;
}

function championRecords(list: { championId: number | null; won: boolean }[]): ChampionRecord[] {
  const map = new Map<number, WinLoss>();
  for (const x of list) {
    if (x.championId == null) continue;
    const r = map.get(x.championId) ?? { played: 0, wins: 0 };
    map.set(x.championId, { played: r.played + 1, wins: r.wins + (x.won ? 1 : 0) });
  }
  return [...map.entries()].map(([championId, r]) => ({ championId, ...r })).sort((a, b) => b.played - a.played || b.wins - a.wins);
}

export interface SideStats {
  avgKills: number;
  avgCs: number;
  firstBloodRate: number;
  firstTowerRate: number;
}

export interface HeadToHead {
  opponent: OpponentSummary;
  /** Mes champions contre lui (wins = mes victoires). */
  myChampions: ChampionRecord[];
  /** Ses champions contre moi (wins = ses victoires). */
  theirChampions: ChampionRecord[];
  me: SideStats;
  them: SideStats;
  favoriteMode: ModeStats | null;
  recent: StatsSeries[];
}

function side(list: StatsPlayerRound[]): SideStats {
  return {
    avgKills: avg(list.map((p) => p.kills)),
    avgCs: avg(list.map((p) => p.cs)),
    firstBloodRate: rate(list.map((p) => p.firstBlood)),
    firstTowerRate: rate(list.map((p) => p.firstTower)),
  };
}

export function headToHead(entries: StatsSeries[], riotId: string): HeadToHead | null {
  const list = entries.filter((e) => e.series.opponentRiotId === riotId);
  const opponent = opponents(list)[0];
  if (!opponent) return null;
  const all = rounds(list);
  return {
    opponent,
    myChampions: championRecords(all.map((x) => ({ championId: x.r.me.championId, won: x.won }))),
    theirChampions: championRecords(all.map((x) => ({ championId: x.r.opponent.championId, won: !x.won }))),
    me: side(all.map((x) => x.r.me)),
    them: side(all.map((x) => x.r.opponent)),
    favoriteMode: modeStats(list, (e) => e.series.championMode)[0] ?? null,
    recent: chronological(list).reverse().slice(0, 5),
  };
}
