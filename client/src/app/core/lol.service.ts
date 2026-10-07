import { Injectable, signal } from '@angular/core';
import type { ChampSelectState, GameflowState, LcuPool, LcuStatus, Lol1v1Bridge, LolFriend, OverlayData } from '../../shared/ipc';

type Bridge = Lol1v1Bridge & { loadConfig(): Promise<{ apiUrl: string; version: string }> };

declare global {
  interface Window {
    lol1v1?: Bridge;
  }
}

/** Pont vers le processus principal Electron (LCU, Live Client Data, overlay). Inactif dans un navigateur. */
@Injectable({ providedIn: 'root' })
export class LolService {
  private readonly bridge = window.lol1v1;
  readonly available = !!this.bridge;

  readonly status = signal<LcuStatus>({ connected: false, error: this.bridge ? 'Recherche du client LoL…' : 'Hors Electron : client LoL indisponible.' });
  readonly gameflow = signal<GameflowState>({ phase: 'None' });
  readonly champSelect = signal<ChampSelectState | null>(null);
  /** Dernières données brutes de la Live Client Data API. */
  readonly liveData = signal<unknown>(null);
  /** Incrémenté à chaque changement de la liste d'amis LoL. */
  readonly friendsVersion = signal(0);

  constructor() {
    if (!this.bridge) return;
    void this.bridge.lcu.status().then((s) => this.status.set(s));
    this.bridge.lcu.onStatus((s) => this.status.set(s));
    this.bridge.lcu.onGameflow((g) => this.gameflow.set(g));
    this.bridge.lcu.onChampSelect((c) => this.champSelect.set(c));
    this.bridge.live.onData((d) => this.liveData.set(d));
    this.bridge.lcu.onFriendsChanged(() => this.friendsVersion.update((v) => v + 1));
  }

  async loadConfig(): Promise<{ apiUrl: string; version: string } | null> {
    return this.bridge ? this.bridge.loadConfig() : null;
  }

  pool(): Promise<LcuPool> {
    return this.require().lcu.pool();
  }

  friends(): Promise<LolFriend[]> {
    return this.require().lcu.friends();
  }

  createLobby(opponentPuuid: string, lobbyName: string): Promise<void> {
    return this.require().lcu.createLobby(opponentPuuid, lobbyName);
  }

  startChampSelect(): Promise<void> {
    return this.require().lcu.startChampSelect();
  }

  async showOverlay(data: OverlayData): Promise<void> {
    if (!this.bridge) return;
    await this.bridge.overlay.show(data);
    // Secours : notification Windows (si le jeu est en plein écran exclusif, l'overlay n'est pas visible).
    await this.bridge.notify(data.title, `${data.subtitle} — ${data.footer}`);
  }

  async hideOverlay(): Promise<void> {
    await this.bridge?.overlay.hide();
  }

  private require(): Bridge {
    if (!this.bridge) throw new Error('Fonction disponible uniquement dans l’application Windows.');
    return this.bridge;
  }
}
