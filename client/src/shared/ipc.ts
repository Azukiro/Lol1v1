/** Contrat IPC entre le processus principal Electron et l'interface Angular. */

export interface LcuIdentity {
  puuid: string;
  gameName: string;
  tagLine: string;
  summonerId: number;
  region: string;
  profileIconId: number;
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
  /** Icône d'invocateur (Data Dragon img/profileicon). */
  icon: number;
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

/** Lobby LoL courant : joueurs présents (toutes équipes) et équipes de la partie perso (100 = bleue, 200 = rouge). */
export interface LobbyState {
  puuids: string[];
  team100: string[];
  team200: string[];
}

export interface OverlayData {
  title: string;
  subtitle: string;
  score: string;
  footer: string;
  tone: 'win' | 'loss' | 'info';
}

export interface UpdateStatus {
  state: 'downloading' | 'ready';
  version: string;
}

export interface DuelystBridge {
  config: { apiUrl: string; version: string };
  lcu: {
    status(): Promise<LcuStatus>;
    pool(): Promise<LcuPool>;
    friends(): Promise<LolFriend[]>;
    createLobby(inviteePuuids: string[], lobbyName: string, teamSize: number): Promise<void>;
    invite(puuids: string[]): Promise<void>;
    switchTeam(): Promise<void>;
    startChampSelect(): Promise<void>;
    acceptInvitationFrom(puuid: string): Promise<boolean>;
    prepareChampSelect(championId: number, spells: [number, number] | null, lock: boolean): Promise<boolean>;
    setSummonerSpells(spells: [number, number]): Promise<void>;
    lobby(): Promise<LobbyState | null>;
    onStatus(cb: (s: LcuStatus) => void): () => void;
    onGameflow(cb: (g: GameflowState) => void): () => void;
    onChampSelect(cb: (c: ChampSelectState | null) => void): () => void;
    onLobby(cb: (l: LobbyState | null) => void): () => void;
    onInvitationsChanged(cb: () => void): () => void;
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
  /** Ramène la fenêtre de l'app au premier plan. */
  attention(): Promise<void>;
  /** Contrôles de la fenêtre sans cadre (barre de titre de l'app). */
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximized(cb: (maximized: boolean) => void): () => void;
  };
  update: {
    status(): Promise<UpdateStatus | null>;
    install(): Promise<void>;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
}
