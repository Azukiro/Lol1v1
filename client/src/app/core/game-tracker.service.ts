import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ApiService, errorMessage } from './api.service';
import { HubService } from './hub.service';
import { LolService } from './lol.service';
import { formatGameTime, Round, SeriesState } from './models';
import { ToastService } from './toast.service';
import { evaluate, Facts } from '../../shared/rules-engine';
import { extractObservations, LiveGameData, localFacts } from '../../shared/live-events';

export interface LaunchOrder {
  seriesId: string;
  roundId: string;
  opponentPuuid: string;
  opponentRiotId: string;
}

/**
 * Relie le client LoL au serveur arbitre pour la série active :
 * remontée du pool, contrôle du pick, début de partie, observations en jeu, overlay de fin de manche.
 */
@Injectable({ providedIn: 'root' })
export class GameTrackerService {
  private readonly hub = inject(HubService);
  private readonly lol = inject(LolService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly activeSeriesId = signal<string | null>(null);
  readonly launchOrder = signal<LaunchOrder | null>(null);
  readonly activeSeries = computed<SeriesState | null>(() => {
    const id = this.activeSeriesId();
    return id ? (this.hub.series()[id] ?? null) : null;
  });
  readonly currentRound = computed<Round | null>(() => {
    const s = this.activeSeries();
    return s?.rounds.find((r) => r.id === s.currentRoundId) ?? null;
  });
  /** Progression locale (non arbitrée) pour un affichage immédiat. */
  readonly localProgress = signal<{ self: Facts; opponent: Facts; selfAt: number | null; opponentAt: number | null; gameTime: number } | null>(null);

  private seen = new Set<string>();
  private seenRoundId: string | null = null;
  private startedRoundId: string | null = null;
  private lastChampSelectKey = '';
  private poolSentFor = new Set<string>();

  constructor() {
    // Pool remonté automatiquement au démarrage de la série et à chaque nouvelle manche.
    effect(() => {
      const s = this.activeSeries();
      const connected = this.lol.status().connected;
      if (!s || !connected || s.status === 'FINISHED' || s.status === 'ABORTED') return;
      const key = `${s.id}:${s.currentRoundId ?? 'setup'}`;
      untracked(() => {
        if (this.poolSentFor.has(key)) return;
        this.poolSentFor.add(key);
        void this.uploadPool(s.id);
      });
    });

    // Contrôle du pick : session de champ select remontée au serveur.
    effect(() => {
      const cs = this.lol.champSelect();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!cs || !s || !round || !['LOBBY', 'CHAMP_SELECT'].includes(round.status)) return;
      const key = `${round.id}:${cs.championId}:${cs.locked}:${cs.spells.join(',')}`;
      if (key === this.lastChampSelectKey) return;
      this.lastChampSelectKey = key;
      this.hub.send('ReportChampSelect', s.id, cs.championId, cs.locked, cs.spells);
    });

    // Début de partie : gameId du gameflow LCU + dernier pick connu.
    effect(() => {
      const flow = this.lol.gameflow();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!s || !round || flow.phase !== 'InProgress') return;
      if (!['LOBBY', 'CHAMP_SELECT', 'IN_GAME'].includes(round.status) || this.startedRoundId === round.id) return;
      this.startedRoundId = round.id;
      const cs = untracked(() => this.lol.champSelect());
      this.hub.send('ReportGameStarted', s.id, flow.gameId ?? 0, cs?.championId || null, cs ? cs.spells : null);
    });

    // En jeu : observations brutes (dédupliquées par EventID) + progression locale.
    effect(() => {
      const data = this.lol.liveData() as LiveGameData | null;
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!data || !s || !round) return;
      if (this.seenRoundId !== round.id) {
        this.seen = new Set();
        this.seenRoundId = round.id;
      }
      const facts = localFacts(data);
      this.localProgress.set({
        ...facts,
        selfAt: evaluate(s.winExpression, facts.self),
        opponentAt: evaluate(s.winExpression, facts.opponent),
        gameTime: data.gameData?.gameTime ?? 0,
      });
      if (round.status !== 'IN_GAME') return;
      for (const o of extractObservations(data, s.winExpression, this.seen)) this.hub.reportObservation(s.id, o);
    });

    // Fin de partie côté LoL : on retire l'overlay.
    effect(() => {
      const phase = this.lol.gameflow().phase;
      if (phase !== 'InProgress' && phase !== 'GameStart') void this.lol.hideOverlay();
    });

    this.hub.events$.subscribe((e) => this.onEvent(e.name, e.seriesId, e.payload));
  }

  setActive(seriesId: string | null) {
    this.activeSeriesId.set(seriesId);
  }

  async uploadPool(seriesId: string) {
    try {
      const pool = await this.lol.pool();
      this.hub.storeState(seriesId, await this.api.putPool(seriesId, pool.owned, pool.free));
    } catch (e) {
      this.toast.error(`Pool non remonté : ${errorMessage(e)}`);
    }
  }

  /** US-4.2 : le créateur crée le lobby Abîme hurlant 1v1 blind pick et invite l'adversaire. */
  async launchLobby() {
    const order = this.launchOrder();
    if (!order) return;
    const s = this.hub.series()[order.seriesId];
    const round = s?.rounds.find((r) => r.id === order.roundId);
    await this.lol.createLobby(order.opponentPuuid, `1v1 M${round?.number ?? ''} ${order.seriesId.slice(0, 4)}`);
    this.toast.info(`Lobby créé, invitation envoyée à ${order.opponentRiotId}. Lance la sélection quand il a rejoint.`);
  }

  private onEvent(name: string, seriesId: string, payload: any) {
    const s = this.hub.series()[seriesId];
    const me = s?.players.find((p) => p.slot === s.mySlot);
    const opp = s?.players.find((p) => p.slot !== s.mySlot);
    switch (name) {
      case 'LaunchLobby':
        this.launchOrder.set({ seriesId, ...payload });
        break;
      case 'AssignmentReady':
        this.lastChampSelectKey = '';
        void this.lol.hideOverlay();
        break;
      case 'PickWarning':
        if (s && payload.slot === s.mySlot) this.toast.error('Champion ou sorts non conformes : corrige avant de verrouiller, sinon la manche sera annulée.');
        else this.toast.info(`${opp?.displayName ?? 'Ton adversaire'} survole un choix non conforme.`);
        break;
      case 'RoundVoided':
        this.toast.error(`Manche annulée : ${payload.reason}. Elle est rejouée avec les mêmes attributions.`);
        this.startedRoundId = null;
        break;
      case 'RoundDisputed':
        this.toast.error('Observations contradictoires : manche en litige. Votez pour la résoudre.');
        break;
      case 'VoidRequested':
        if (s && payload.bySlot !== s.mySlot) this.toast.info(`${opp?.displayName ?? 'Ton adversaire'} propose d'annuler la manche.`);
        break;
      case 'RoundResolved': {
        if (!s) break;
        const won = payload.winnerSlot === s.mySlot;
        const myScore = s.mySlot === 'A' ? payload.score.a : payload.score.b;
        const oppScore = s.mySlot === 'A' ? payload.score.b : payload.score.a;
        void this.lol.showOverlay({
          title: won ? 'Manche gagnée' : 'Manche perdue',
          subtitle: `${payload.winnerName} : ${payload.condition}${payload.eventTime != null ? ` à ${formatGameTime(payload.eventTime)}` : ''}`,
          score: `${me?.displayName ?? 'Toi'} ${myScore} : ${oppScore} ${opp?.displayName ?? ''}`,
          footer: 'Quitte la partie pour la manche suivante',
          tone: won ? 'win' : 'loss',
        });
        break;
      }
      case 'SeriesFinished': {
        if (!s) break;
        const won = payload.winnerSlot === s.mySlot;
        void this.lol.showOverlay({
          title: won ? 'Victoire' : 'Défaite',
          subtitle: `Série terminée · ${payload.winnerName} l'emporte`,
          score: `${s.mySlot === 'A' ? payload.score.a : payload.score.b} : ${s.mySlot === 'A' ? payload.score.b : payload.score.a}`,
          footer: 'Quitte la partie',
          tone: won ? 'win' : 'loss',
        });
        this.launchOrder.set(null);
        break;
      }
      case 'SeriesAborted':
        this.toast.error(`Série interrompue : ${payload.reason}`);
        break;
    }
  }
}
