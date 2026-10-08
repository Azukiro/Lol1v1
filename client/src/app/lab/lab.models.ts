import type { WinNode } from '../../shared/rules-engine';

export type LabMode = 'SECRET_OBJECTIVES';
export type ObjectiveTier = 'SHORT' | 'MEDIUM' | 'LONG';

export interface LabConfig {
  mode: LabMode;
  /** null = palier tiré au sort à chaque manche */
  tier: ObjectiveTier | null;
}

export interface LabObjective {
  id: string;
  label: string;
  expression: WinNode;
  tier: ObjectiveTier;
  estimatedMinutes: number;
}

export interface LabRound {
  roundId: string;
  tier: ObjectiveTier;
  timeLimit: number;
  /** null tant que la partie n'a pas commencé */
  mine: LabObjective | null;
  myProgress: number | null;
  gameClock: number;
}

export interface LabReveal {
  roundId: string;
  number: number;
  attempt: number;
  mine: LabObjective;
  opponent: LabObjective;
}

export interface LabState {
  mode: LabMode;
  tier: ObjectiveTier | null;
  current: LabRound | null;
  history: LabReveal[];
}

export interface LabTier {
  tier: ObjectiveTier;
  label: string;
  timeLimit: number;
  objectives: LabObjective[];
}

export const TIER_LABELS: Record<ObjectiveTier, string> = {
  SHORT: 'Court',
  MEDIUM: 'Moyen',
  LONG: 'Long',
};
