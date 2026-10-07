import { inject, Injectable, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { appConfig, readToken } from './api.service';
import { Invitation, SeriesState } from './models';
import type { Observation } from '../../shared/live-events';

export interface SeriesEvent {
  name: string;
  seriesId: string;
  payload: any;
}

const SERIES_EVENTS = [
  'BansRevealed',
  'AssignmentReady',
  'PicksRevealed',
  'LaunchLobby',
  'PickWarning',
  'RoundVoided',
  'RoundResolved',
  'RoundDisputed',
  'SeriesFinished',
  'VoidRequested',
  'SeriesAborted',
];

/**
 * Module sync : client SignalR du hub /hubs/series, reconnexion automatique,
 * file d'envoi des observations rejouée après une coupure.
 */
@Injectable({ providedIn: 'root' })
export class HubService {
  private connection: HubConnection | null = null;
  private readonly queue: { method: string; args: unknown[] }[] = [];
  private readonly joined = new Set<string>();

  readonly state = signal<'disconnected' | 'connecting' | 'connected'>('disconnected');
  /** Derniers états de série reçus, par identifiant. */
  readonly series = signal<Record<string, SeriesState>>({});
  readonly events$ = new Subject<SeriesEvent>();
  readonly invitations$ = new Subject<{ name: string; invitation: Invitation }>();

  async connect(): Promise<void> {
    if (this.connection) return;
    const connection = new HubConnectionBuilder()
      .withUrl(`${appConfig.apiUrl}/hubs/series`, { accessTokenFactory: () => readToken() ?? '', withCredentials: false })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();
    this.connection = connection;

    connection.on('SeriesUpdated', (seriesId: string, state: SeriesState) => this.storeState(seriesId, state));
    for (const name of SERIES_EVENTS) {
      connection.on(name, (seriesId: string, payload: unknown) => this.events$.next({ name, seriesId, payload }));
    }
    connection.on('InvitationReceived', (inv: Invitation) => this.invitations$.next({ name: 'InvitationReceived', invitation: inv }));
    connection.on('InvitationUpdated', (inv: Invitation) => this.invitations$.next({ name: 'InvitationUpdated', invitation: inv }));

    connection.onreconnecting(() => this.state.set('connecting'));
    connection.onreconnected(async () => {
      this.state.set('connected');
      // À la reconnexion : rappeler JoinSeries pour recevoir l'état complet, puis vider la file.
      for (const id of this.joined) await this.join(id).catch(() => undefined);
      await this.flush();
    });
    connection.onclose(() => this.state.set('disconnected'));

    this.state.set('connecting');
    try {
      await connection.start();
      this.state.set('connected');
    } catch (e) {
      this.state.set('disconnected');
      this.connection = null;
      throw e;
    }
  }

  async disconnect() {
    await this.connection?.stop();
    this.connection = null;
    this.joined.clear();
    this.series.set({});
  }

  async join(seriesId: string): Promise<SeriesState> {
    this.joined.add(seriesId);
    const state = await this.invoke<SeriesState>('JoinSeries', seriesId);
    this.storeState(seriesId, state);
    return state;
  }

  storeState(seriesId: string, state: SeriesState) {
    this.series.update((all) => ({ ...all, [seriesId]: state }));
  }

  invoke<T = void>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      return Promise.reject(new Error('Connexion au serveur en cours…'));
    }
    return this.connection.invoke<T>(method, ...args);
  }

  /** Envoi tolérant aux coupures : mis en file et rejoué à la reconnexion (observations en jeu). */
  send(method: string, ...args: unknown[]) {
    this.queue.push({ method, args });
    void this.flush();
  }

  reportObservation(seriesId: string, o: Observation) {
    this.send('ReportObservation', seriesId, o);
  }

  private flushing = false;
  private async flush() {
    if (this.flushing || this.connection?.state !== HubConnectionState.Connected) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const next = this.queue[0];
        try {
          await this.connection.invoke(next.method, ...next.args);
        } catch (e) {
          // Erreur métier (HubException) : on abandonne ce message ; coupure : on réessaiera.
          if (this.connection?.state !== HubConnectionState.Connected) break;
          console.warn('Message rejeté par le serveur', next.method, e);
        }
        this.queue.shift();
      }
    } finally {
      this.flushing = false;
    }
  }
}
