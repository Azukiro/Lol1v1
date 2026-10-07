/**
 * lcu-connector : seul module à parler à la LCU (API locale non officielle du client League).
 * Identifiants lus dans le lockfile (ou la ligne de commande de LeagueClientUx), REST + WebSocket WAMP.
 * Le certificat auto-signé n'est accepté que pour 127.0.0.1, via un agent dédié (jamais globalement).
 */
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import WebSocket from 'ws';
import type { ChampSelectState, GameflowState, LcuIdentity, LcuPool, LcuStatus } from '../src/shared/ipc';

interface Credentials {
  port: number;
  password: string;
}

const LOCAL_HOST = '127.0.0.1';
/** Agent réservé aux appels locaux : accepte le certificat auto-signé de Riot pour 127.0.0.1 uniquement. */
export const localAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const DEFAULT_DIRS = [
  'C:\\Riot Games\\League of Legends',
  'D:\\Riot Games\\League of Legends',
  'C:\\Program Files\\Riot Games\\League of Legends',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends',
];

export function parseLockfile(content: string): Credentials | null {
  // Format : LeagueClient:<pid>:<port>:<password>:https
  const parts = content.trim().split(':');
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  return Number.isFinite(port) && parts[3] ? { port, password: parts[3] } : null;
}

export function parseCommandLine(cmd: string): Credentials | null {
  const port = /--app-port=(\d+)/.exec(cmd)?.[1];
  const token = /--remoting-auth-token=([\w-]+)/.exec(cmd)?.[1];
  return port && token ? { port: Number(port), password: token } : null;
}

function readLockfile(): Credentials | null {
  const dirs = [process.env['LOL_PATH'], ...DEFAULT_DIRS].filter((d): d is string => !!d);
  for (const dir of dirs) {
    try {
      const creds = parseLockfile(fs.readFileSync(path.join(dir, 'lockfile'), 'utf8'));
      if (creds) return creds;
    } catch {
      /* fichier absent : client fermé ou autre dossier */
    }
  }
  return null;
}

function readFromProcess(): Promise<Credentials | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? null : parseCommandLine(stdout)),
    );
  });
}

export class LcuConnector extends EventEmitter {
  private creds: Credentials | null = null;
  private ws: WebSocket | null = null;
  private identity: LcuIdentity | undefined;
  private timer: NodeJS.Timeout | null = null;
  private lastError: string | undefined;

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 3000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }

  status(): LcuStatus {
    return { connected: !!this.creds && !!this.identity, identity: this.identity, error: this.lastError };
  }

  private async tick(): Promise<void> {
    if (this.creds) {
      // Connexion existante : vérifie qu'elle répond toujours.
      try {
        await this.request('GET', '/lol-summoner/v1/current-summoner');
        return;
      } catch {
        this.disconnect('Client LoL fermé');
      }
    }
    const creds = readLockfile() ?? (await readFromProcess());
    if (!creds) {
      this.setError('Client LoL introuvable. Lance League of Legends (ou définis LOL_PATH).');
      return;
    }
    this.creds = creds;
    try {
      this.identity = await this.loadIdentity();
      this.lastError = undefined;
      this.openSocket();
      this.emit('status', this.status());
      void this.refreshGameflow();
    } catch (e) {
      this.creds = null;
      this.setError(`Client LoL en cours de démarrage (${(e as Error).message})`);
    }
  }

  private setError(error: string) {
    if (this.lastError === error) return;
    this.lastError = error;
    this.emit('status', this.status());
  }

  private disconnect(reason: string) {
    this.creds = null;
    this.identity = undefined;
    this.ws?.close();
    this.ws = null;
    this.setError(reason);
  }

  request<T = unknown>(method: string, urlPath: string, body?: unknown): Promise<T> {
    const creds = this.creds;
    if (!creds) return Promise.reject(new Error('LCU non connectée'));
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          host: LOCAL_HOST,
          port: creds.port,
          path: urlPath,
          method,
          agent: localAgent,
          timeout: 5000,
          headers: {
            Authorization: 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64'),
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 400) return reject(new Error(`LCU ${method} ${urlPath} → ${res.statusCode} ${data}`));
            try {
              resolve((data ? JSON.parse(data) : undefined) as T);
            } catch {
              resolve(data as unknown as T);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  // ---------------------------------------------------------------- Lecture

  private async loadIdentity(): Promise<LcuIdentity> {
    const s = await this.request<{ puuid: string; gameName: string; tagLine: string; summonerId: number }>('GET', '/lol-summoner/v1/current-summoner');
    let region = '';
    try {
      region = (await this.request<{ region: string }>('GET', '/riotclient/region-locale')).region ?? '';
    } catch {
      /* région facultative */
    }
    return { puuid: s.puuid, gameName: s.gameName, tagLine: s.tagLine, summonerId: s.summonerId, region };
  }

  /** Champions possédés + rotation gratuite. */
  async pool(): Promise<LcuPool> {
    const list = await this.request<
      { id: number; freeToPlay?: boolean; ownership?: { owned?: boolean; rental?: { rented?: boolean } } }[]
    >('GET', '/lol-champions/v1/owned-champions-minimal');
    const owned: number[] = [];
    const free: number[] = [];
    for (const c of list) {
      if (c.id <= 0) continue;
      if (c.ownership?.owned || c.ownership?.rental?.rented) owned.push(c.id);
      else if (c.freeToPlay) free.push(c.id);
    }
    return { owned, free };
  }

  // ---------------------------------------------------------------- Lobby

  /** Partie personnalisée Abîme hurlant (map 12), 1 joueur par équipe, blind pick (mutator 1). */
  async createLobby(opponentPuuid: string, lobbyName: string): Promise<void> {
    await this.request('POST', '/lol-lobby/v2/lobby', {
      customGameLobby: {
        configuration: {
          gameMode: 'ARAM',
          gameMutator: '',
          gameServerRegion: '',
          mapId: 12,
          mutators: { id: 1 },
          spectatorPolicy: 'AllAllowed',
          teamSize: 1,
        },
        lobbyName,
        lobbyPassword: '',
      },
      isCustom: true,
    });
    const opponent = await this.request<{ summonerId: number }>('GET', `/lol-summoner/v2/summoners/puuid/${encodeURIComponent(opponentPuuid)}`);
    await this.request('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: opponent.summonerId }]);
  }

  async startChampSelect(): Promise<void> {
    await this.request('POST', '/lol-lobby/v1/lobby/custom/start-champ-select');
  }

  // ---------------------------------------------------------------- Événements

  private openSocket(): void {
    const creds = this.creds!;
    const ws = new WebSocket(`wss://${LOCAL_HOST}:${creds.port}/`, 'wamp', {
      rejectUnauthorized: false,
      headers: { Authorization: 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64') },
    });
    this.ws = ws;
    ws.on('open', () => {
      for (const evt of ['OnJsonApiEvent_lol-gameflow_v1_gameflow-phase', 'OnJsonApiEvent_lol-champ-select_v1_session']) {
        ws.send(JSON.stringify([5, evt]));
      }
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!Array.isArray(msg) || msg[0] !== 8) return;
        const { uri, data, eventType } = msg[2] as { uri: string; data: unknown; eventType: string };
        if (uri === '/lol-gameflow/v1/gameflow-phase') void this.refreshGameflow(data as string);
        else if (uri === '/lol-champ-select/v1/session') {
          this.emit('champSelect', eventType === 'Delete' ? null : normalizeChampSelect(data as ChampSelectSession));
        }
      } catch {
        /* message ignoré */
      }
    });
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
    });
    ws.on('error', () => ws.close());
  }

  private async refreshGameflow(phase?: string): Promise<void> {
    try {
      const p = phase ?? (await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase'));
      const state: GameflowState = { phase: p };
      if (p === 'InProgress' || p === 'GameStart') {
        const session = await this.request<{ gameData?: { gameId?: number } }>('GET', '/lol-gameflow/v1/session');
        state.gameId = session.gameData?.gameId;
      }
      this.emit('gameflow', state);
    } catch {
      /* ignoré */
    }
  }
}

export interface ChampSelectSession {
  localPlayerCellId: number;
  myTeam: { cellId: number; championId: number; championPickIntent: number; spell1Id: number; spell2Id: number }[];
  actions: { actorCellId: number; championId: number; completed: boolean; type: string }[][];
}

export function normalizeChampSelect(session: ChampSelectSession): ChampSelectState | null {
  const me = session.myTeam?.find((c) => c.cellId === session.localPlayerCellId);
  if (!me) return null;
  const pick = (session.actions ?? []).flat().find((a) => a.actorCellId === session.localPlayerCellId && a.type === 'pick');
  const championId = me.championId || pick?.championId || me.championPickIntent || 0;
  return { championId, locked: !!pick?.completed && championId > 0, spells: [me.spell1Id, me.spell2Id] };
}
