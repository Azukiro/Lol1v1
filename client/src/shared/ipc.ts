/** Contrat IPC entre le processus principal Electron et l'interface Angular. */

export interface LcuIdentity {
  puuid: string;
  gameName: string;
  tagLine: string;
  summonerId: number;
  region: string;
}

export interface LcuStatus {
  connected: boolean;
  identity?: LcuIdentity;
  error?: string;
}

export interface LcuPool {
  owned: number[];
  free: number[];
}

export type GameflowPhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | 'Reconnect'
  | string;

export interface LolFriend {
  puuid: string;
  gameName: string;
  tagLine: string;
  /** chat (en ligne), away, dnd (souvent en partie), mobile, offline */
  availability: string;
  /** inGame, championSelect, outOfGame… (vide si hors ligne) */
  gameStatus: string;
  groupName: string;
}

export interface GameflowState {
  phase: GameflowPhase;
  gameId?: number;
}

export interface ChampSelectState {
  championId: number;
  locked: boolean;
  spells: [number, number];
}

export interface OverlayData {
  title: string;
  subtitle: string;
  score: string;
  footer: string;
  tone: 'win' | 'loss' | 'info';
}

export interface Lol1v1Bridge {
  config: { apiUrl: string; version: string };
  lcu: {
    status(): Promise<LcuStatus>;
    pool(): Promise<LcuPool>;
    friends(): Promise<LolFriend[]>;
    createLobby(opponentPuuid: string, lobbyName: string): Promise<void>;
    startChampSelect(): Promise<void>;
    onStatus(cb: (s: LcuStatus) => void): () => void;
    onGameflow(cb: (g: GameflowState) => void): () => void;
    onChampSelect(cb: (c: ChampSelectState | null) => void): () => void;
    onFriendsChanged(cb: () => void): () => void;
  };
  live: {
    onData(cb: (data: unknown) => void): () => void;
  };
  overlay: {
    show(data: OverlayData): Promise<void>;
    hide(): Promise<void>;
  };
  notify(title: string, body: string): Promise<void>;
}
