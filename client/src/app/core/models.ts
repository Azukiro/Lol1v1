import type { WinNode } from '../../shared/rules-engine';
import type { LabConfig, LabState } from '../lab/lab.models';

export type ChampionMode = 'MIRROR' | 'RANDOM' | 'DECK' | 'MIRROR_DECK';
export type SpellMode = 'FREE' | 'DECK_COMPOSED' | 'DECK_RANDOM';
export type SeriesStatus = 'SETUP' | 'BANS' | 'IN_PROGRESS' | 'FINISHED' | 'ABORTED';
export type RoundStatus = 'ASSIGNMENT' | 'LOBBY' | 'CHAMP_SELECT' | 'IN_GAME' | 'VOIDED' | 'DISPUTED' | 'VALIDATED';
export type SlotName = 'A' | 'B';

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: string;
  riotId: string;
  profileIconId: number | null;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  riotAccount: RiotAccount | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface PlayerRef {
  userId: string;
  displayName: string;
  riotId: string;
  profileIconId?: number | null;
}

export interface SeriesConfig {
  bestOf: number;
  championMode: ChampionMode;
  spellMode: SpellMode;
  /** Absente en mode labo « objectifs secrets ». */
  winExpression?: WinNode;
  lab?: LabConfig;
}

/** Config prête : tout sauf le format, choisi au lancement du défi. */
/** Les pré-configurations ne couvrent que les séries standards : expression requise, pas de labo. */
export type PresetConfig = Omit<SeriesConfig, 'bestOf' | 'winExpression' | 'lab'> & { winExpression: WinNode };

export interface Preset {
  id: string;
  name: string;
  description: string;
  config: PresetConfig;
  builtIn: boolean;
}

export interface Invitation {
  id: string;
  status: string;
  config: SeriesConfig;
  configLabel: string;
  from: PlayerRef;
  to: PlayerRef;
  createdAt: string;
  expiresAt: string;
  seriesId: string | null;
}

export interface SeriesSummary {
  id: string;
  status: SeriesStatus;
  bestOf: number;
  championMode: ChampionMode;
  spellMode: SpellMode;
  winExpressionLabel: string;
  mySlot: SlotName;
  opponentName: string;
  opponentRiotId: string;
  opponentProfileIconId: number | null;
  myWins: number;
  opponentWins: number;
  winnerSlot: SlotName | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface HistoryPlayerRound {
  championId: number | null;
  spell1Id: number | null;
  spell2Id: number | null;
  kills: number;
  cs: number;
  firstBlood: boolean;
  firstTower: boolean;
}

export interface HistoryRound {
  number: number;
  winnerSlot: SlotName | null;
  winningLabel: string | null;
  winningCondition: string | null;
  /** Temps de jeu (s) auquel la condition de victoire a été remplie. */
  winningTime: number | null;
  startedAt: string | null;
  endedAt: string | null;
  me: HistoryPlayerRound;
  opponent: HistoryPlayerRound;
}

export interface HistoryEntry {
  series: SeriesSummary;
  rounds: HistoryRound[];
  /** Champions que j'ai bannis / que l'adversaire m'a bannis (mode deck). */
  myBans: number[];
  opponentBans: number[];
}

export interface Player {
  slot: SlotName;
  userId: string;
  displayName: string;
  riotId: string;
  puuid: string;
  profileIconId: number | null;
  roundsWon: number;
  poolSize: number;
  freeCount: number;
  poolUpdatedAt: string | null;
  deckLocked: boolean;
  deckSize: number;
  spellBudgetLocked: boolean;
  bansSubmitted: boolean;
}

export interface DeckEntry {
  championId: number;
  banned: boolean;
  consumed: boolean;
}

export interface SpellTokenState {
  spellId: number;
  initial: number;
  left: number;
}

export interface Assignment {
  slot: SlotName;
  championId: number | null;
  spell1Id: number | null;
  spell2Id: number | null;
  submitted: boolean;
  revealed: boolean;
  conform: boolean;
}

export interface WinningCondition {
  label: string;
  condition: string | null;
  threshold: number | null;
  eventTime: number | null;
  singleSource: boolean;
}

export interface Round {
  id: string;
  number: number;
  attempt: number;
  status: RoundStatus;
  voidReason: string | null;
  lolGameId: number | null;
  winnerSlot: SlotName | null;
  winningCondition: WinningCondition | null;
  startedAt: string | null;
  endedAt: string | null;
  assignments: Assignment[];
  voidRequestedBySlot: SlotName | null;
  myDisputeVote: string | null;
}

export interface PlayerProgress {
  kills: number;
  firstBlood: boolean;
  firstTower: boolean;
  cs: number;
  satisfiedAt: number | null;
}

export interface LiveState {
  progress: Record<SlotName, PlayerProgress>;
  events: { type: string; slot: SlotName; eventTime: number; value: number | null; singleSource: boolean }[];
  pending: boolean;
  contradictions: string[];
}

export interface SeriesState {
  id: string;
  status: SeriesStatus;
  bestOf: number;
  winsNeeded: number;
  championMode: ChampionMode;
  spellMode: SpellMode;
  /** Null en mode labo « objectifs secrets » (voir lab). */
  winExpression: WinNode | null;
  winExpressionLabel: string;
  winnerSlot: SlotName | null;
  mySlot: SlotName;
  creatorSlot: SlotName;
  createdAt: string;
  finishedAt: string | null;
  rules: { minDeckSize: number; bansPerPlayer: number; spellBudget: number; spellCap: number; allowedSpellIds: number[] };
  players: Player[];
  me: { pool: number[]; free: number[]; deck: DeckEntry[]; spellTokens: SpellTokenState[]; myBans: number[]; deckChampionsNotInPool: number[]; commonPool: number[] | null };
  opponent: { deck: DeckEntry[] | null; bansOnMe: number[] | null; spellTokens: SpellTokenState[] | null };
  rounds: Round[];
  currentRoundId: string | null;
  live: LiveState | null;
  /** Mode expérimental du labo, null pour une série standard. */
  lab: LabState | null;
}

export interface ChampionRef {
  id: number;
  key: string;
  name: string;
  tags: string[];
}

export interface SpellRef {
  id: number;
  key: string;
  name: string;
}

export const MODE_LABELS: Record<ChampionMode, string> = { MIRROR: 'Miroir', RANDOM: 'Aléatoire', DECK: 'Deck', MIRROR_DECK: 'Deck miroir' };

/** Modes où chaque joueur compose un deck avant la série. */
export function usesDeck(mode: ChampionMode) {
  return mode === 'DECK' || mode === 'MIRROR_DECK';
}
export const SPELL_MODE_LABELS: Record<SpellMode, string> = {
  FREE: 'Sorts libres',
  DECK_COMPOSED: 'Deck composé',
  DECK_RANDOM: 'Deck aléatoire',
};

export function formatGameTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
