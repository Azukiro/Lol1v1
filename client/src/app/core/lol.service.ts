import { Injectable, signal } from '@angular/core';
import type { ChampSelectState, GameflowState, LcuPool, LcuStatus, Lol1v1Bridge, LolFriend, OverlayData, UpdateStatus } from '../../shared/ipc';

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
  /** Mise à jour de l'app en cours de téléchargement ou prête à installer. */
  readonly update = signal<UpdateStatus | null>(null);

  constructor() {
    if (!this.bridge) return;
    void this.bridge.lcu.status().then((s) => this.status.set(s));
    this.bridge.lcu.onStatus((s) => this.status.set(s));
    this.bridge.lcu.onGameflow((g) => {
      this.gameflow.set(g);
      // Hors partie, on oublie les données de la partie précédente (et la sélection une fois revenu au lobby).
      if (!['InProgress', 'GameStart', 'Reconnect'].includes(g.phase)) this.liveData.set(null);
      if (['None', 'Lobby', 'EndOfGame', 'PreEndOfGame', 'WaitingForStats'].includes(g.phase)) this.champSelect.set(null);
    });
    this.bridge.lcu.onChampSelect((c) => this.champSelect.set(c));
    this.bridge.live.onData((d) => this.liveData.set(d));
    void this.bridge.update.status().then((u) => u && this.update.set(u));
    this.bridge.update.onStatus((u) => this.update.set(u));
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

  prepareChampSelect(championId: number, spells: [number, number] | null): Promise<boolean> {
    return this.require().lcu.prepareChampSelect(championId, spells);
  }

  setSummonerSpells(spells: [number, number]): Promise<void> {
    return this.require().lcu.setSummonerSpells(spells);
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

  installUpdate(): Promise<void> {
    return this.require().update.install();
  }

  async hideOverlay(): Promise<void> {
    await this.bridge?.overlay.hide();
  }

  private require(): Bridge {
    if (!this.bridge) throw new Error('Fonction disponible uniquement dans l’application Windows.');
    return this.bridge;
  }
}
