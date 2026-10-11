import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ApiService, errorMessage } from './api.service';
import { HubService } from './hub.service';
import { LolService } from './lol.service';
import { formatGameTime, myAssignment, Player, Round, SeriesState, SlotName, teamName, teamPlayers } from './models';
import type { LobbyState } from '../../shared/ipc';
import { ReferenceService } from './reference.service';
import { ToastService } from './toast.service';
import { evaluate, Facts } from '../../shared/rules-engine';
import { extractObservations, LiveGameData, localFacts } from '../../shared/live-events';
import { labObservations } from '../../shared/lab';

export interface LaunchOrder {
  seriesId: string;
  roundId: string;
  opponentPuuid: string;
  opponentRiotId: string;
  teamSize?: number;
  /** Invités du créateur avec leur équipe (A = la sienne). */
  guests?: { puuid: string; riotId: string; slot: SlotName }[];
}

/** Créateur de la série : capitaine de l'équipe A, il crée le lobby et invite les autres. */
function creatorOf(s: SeriesState): Player | undefined {
  return teamPlayers(s, 'A')[0];
}

function guestsOf(s: SeriesState): Player[] {
  const creator = creatorOf(s);
  return s.players.filter((p) => p.userId !== creator?.userId);
}

/**
 * Équipe LoL (100 / 200) de chaque slot : l'équipe A est celle où se trouve le créateur.
 * Null tant que le créateur n'est pas placé.
 */
function lobbyTeams(s: SeriesState, lobby: LobbyState | null): Record<SlotName, string[]> | null {
  const creator = creatorOf(s);
  if (!lobby || !creator) return null;
  if (lobby.team100.includes(creator.puuid)) return { A: lobby.team100, B: lobby.team200 };
  if (lobby.team200.includes(creator.puuid)) return { A: lobby.team200, B: lobby.team100 };
  return null;
}

/** Tous les joueurs de la série sont dans le lobby, chacun dans l'équipe de son slot. */
function lobbyComplete(s: SeriesState, lobby: LobbyState | null): boolean {
  if (s.teamSize === 1) return guestsOf(s).every((p) => lobby?.puuids.includes(p.puuid));
  const teams = lobbyTeams(s, lobby);
  return !!teams && s.players.every((p) => teams[p.slot].includes(p.puuid));
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
  private readonly reference = inject(ReferenceService);

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
  private champSelectRoundId: string | null = null;
  private preparedRoundId: string | null = null;
  /** Tentative de manche (id:attempt) déjà traitée par chaque automatisme, pour ne le déclencher qu'une fois. */
  private autoLobbyKey: string | null = null;
  private autoSelectKey: string | null = null;
  /** 2v2 : adversaires invités une fois le coéquipier placé (évite deux joueurs mal placés bloqués l'un par l'autre). */
  private autoInviteKey: string | null = null;
  private teamSwitchKey = '';
  private readonly spellFixes = new Map<string, number>();
  private spellFixTimer: ReturnType<typeof setTimeout> | null = null;
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

    // Sélection LoL vue pour la manche courante : seule une partie lancée après elle compte.
    effect(() => {
      const phase = this.lol.gameflow().phase;
      const round = this.currentRound();
      // Uniquement la phase ChampSelect en cours : la sélection de la manche précédente reste en mémoire pendant la partie.
      if (round && ['LOBBY', 'CHAMP_SELECT'].includes(round.status) && phase === 'ChampSelect') {
        this.champSelectRoundId = round.id;
      }
    });

    // Créateur : lobby créé et invités conviés dès que les champions sont révélés, une fois sorti de la partie précédente.
    effect(() => {
      const s = this.activeSeries();
      const round = this.currentRound();
      const phase = this.lol.gameflow().phase;
      if (!s || !round || round.status !== 'LOBBY' || !this.isCreator(s) || !this.lol.status().connected) return;
      if (!['None', 'Lobby'].includes(phase)) return;
      const key = `${round.id}:${round.attempt}`;
      if (this.autoLobbyKey === key) return;
      // Invités déjà dans mon lobby (ex. « Rejouer » après la manche précédente) : pas besoin d'en recréer un.
      if (phase === 'Lobby' && guestsOf(s).every((p) => this.lol.lobby()?.puuids.includes(p.puuid))) return;
      this.autoLobbyKey = key;
      untracked(() => void this.launchRound(s.id, round.id).catch((e) => this.toast.error(`Lobby non créé : ${errorMessage(e)}. Utilise « Lancer la manche ».`)));
    });

    // Créateur 2v2 : adversaires invités dès que le coéquipier a rejoint mon équipe (elle est alors pleine,
    // les adversaires arrivent forcément dans l'autre).
    effect(() => {
      const s = this.activeSeries();
      const round = this.currentRound();
      const lobby = this.lol.lobby();
      if (!s || s.teamSize === 1 || !round || round.status !== 'LOBBY' || !this.isCreator(s)) return;
      if (this.lol.gameflow().phase !== 'Lobby') return;
      const teams = lobbyTeams(s, lobby);
      if (!teams || !teamPlayers(s, 'A').every((p) => teams.A.includes(p.puuid))) return;
      const missing = teamPlayers(s, 'B').filter((p) => !lobby!.puuids.includes(p.puuid));
      const key = `${round.id}:${round.attempt}`;
      if (!missing.length || this.autoInviteKey === key) return;
      this.autoInviteKey = key;
      untracked(() => void this.lol.invite(missing.map((p) => p.puuid)).catch((e) => this.toast.error(`Adversaires non invités : ${errorMessage(e)}. Utilise « Lancer la manche ».`)));
    });

    // Créateur : sélection démarrée dès que tout le monde est dans le lobby (et, en 2v2, dans la bonne équipe).
    effect(() => {
      const s = this.activeSeries();
      const round = this.currentRound();
      const lobby = this.lol.lobby();
      if (!s || !round || round.status !== 'LOBBY' || !this.isCreator(s)) return;
      if (this.lol.gameflow().phase !== 'Lobby' || !lobbyComplete(s, lobby)) return;
      const key = `${round.id}:${round.attempt}`;
      if (this.autoSelectKey === key) return;
      this.autoSelectKey = key;
      // Court délai : le client LoL refuse le démarrage tant que l'arrivée du joueur n'est pas finalisée.
      setTimeout(() => void this.lol.startChampSelect().catch((e) => this.toast.error(`Sélection non démarrée : ${errorMessage(e)}. Utilise « Démarrer la sélection ».`)), 1500);
    });

    // Invité : accepte l'invitation du créateur pour la manche en cours.
    effect(() => {
      this.lol.invitationsVersion();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!s || !round || round.status !== 'LOBBY' || this.isCreator(s) || !this.lol.status().connected) return;
      if (!['None', 'Lobby'].includes(this.lol.gameflow().phase)) return;
      const creator = creatorOf(s);
      if (!creator || this.lol.lobby()?.puuids.includes(creator.puuid)) return;
      untracked(() => void this.lol.acceptInvitationFrom(creator.puuid).catch(() => undefined));
    });

    // Invité 2v2 : rejoint l'équipe de son slot s'il a été placé dans l'autre et qu'il y reste une place.
    effect(() => {
      const s = this.activeSeries();
      const round = this.currentRound();
      const lobby = this.lol.lobby();
      if (!s || s.teamSize === 1 || !round || round.status !== 'LOBBY' || this.isCreator(s)) return;
      if (this.lol.gameflow().phase !== 'Lobby') return;
      const me = s.players.find((p) => p.userId === s.myUserId);
      const teams = lobbyTeams(s, lobby);
      if (!me || !teams || !lobby!.puuids.includes(me.puuid) || teams[me.slot].includes(me.puuid)) return;
      if (teams[me.slot].length >= s.teamSize) return;
      const key = `${round.id}:${lobby!.team100.join()}|${lobby!.team200.join()}`;
      if (this.teamSwitchKey === key) return;
      this.teamSwitchKey = key;
      untracked(() => void this.lol.switchTeam().catch(() => undefined));
    });

    // Sélection LoL : règle les sorts, survole puis verrouille le champion attribué (une fois par tentative de manche).
    effect(() => {
      const cs = this.lol.champSelect();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!cs || cs.locked || !s || !round || !['LOBBY', 'CHAMP_SELECT'].includes(round.status)) return;
      if (this.lol.gameflow().phase !== 'ChampSelect' || this.preparedRoundId === round.id) return;
      const mine = myAssignment(s, round);
      if (!mine?.championId) return;
      const spells: [number, number] | null = s.spellMode !== 'FREE' && mine.spell1Id && mine.spell2Id ? [mine.spell1Id, mine.spell2Id] : null;
      this.preparedRoundId = round.id;
      this.lol
        .prepareChampSelect(mine.championId, spells, true)
        .then((done) => {
          if (!done) this.preparedRoundId = null; // phase de pick pas encore ouverte : on réessaiera au prochain événement
        })
        .catch(() => (this.preparedRoundId = null));
    });

    // Sorts imposés écrasés par un autre outil (Blitz, Porofessor… importent leurs propres sorts après le pick) :
    // on les ré-impose, avec un délai pour passer après l'outil et un nombre limité de tentatives.
    effect(() => {
      const cs = this.lol.champSelect();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!cs || !s || s.spellMode === 'FREE' || !round || !['LOBBY', 'CHAMP_SELECT'].includes(round.status)) return;
      if (this.lol.gameflow().phase !== 'ChampSelect') return;
      const mine = myAssignment(s, round);
      if (!mine?.spell1Id || !mine.spell2Id) return;
      const expected: [number, number] = [mine.spell1Id, mine.spell2Id];
      if ([...cs.spells].sort().join() === [...expected].sort().join()) return;
      const attempts = this.spellFixes.get(round.id) ?? 0;
      if (attempts >= 5 || this.spellFixTimer) return;
      this.spellFixes.set(round.id, attempts + 1);
      this.spellFixTimer = setTimeout(() => {
        this.spellFixTimer = null;
        void this.lol.setSummonerSpells(expected).catch(() => undefined);
      }, 700);
      if (attempts === 2) this.toast.info('Un autre outil (Blitz ?) change tes sorts : désactive son import automatique des sorts.');
    });

    // Début de partie : gameId du gameflow LCU + dernier pick connu.
    // Sans sélection vue pour cette manche, une partie « InProgress » est celle de la manche précédente
    // (pas encore quittée) : on l'ignore, sinon ses kills seraient attribués à la nouvelle manche.
    effect(() => {
      const flow = this.lol.gameflow();
      const s = this.activeSeries();
      const round = this.currentRound();
      if (!s || !round || flow.phase !== 'InProgress') return;
      if (!['LOBBY', 'CHAMP_SELECT'].includes(round.status) || this.startedRoundId === round.id) return;
      if (this.champSelectRoundId !== round.id) return;
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
      // Labo « objectifs secrets » : pas d'expression commune, chacun évalue la sienne.
      const mine = s.winExpression ?? s.lab?.current?.mine?.expression ?? null;
      this.localProgress.set({
        ...facts,
        selfAt: mine ? evaluate(mine, facts.self) : null,
        opponentAt: s.winExpression ? evaluate(s.winExpression, facts.opponent) : null,
        gameTime: data.gameData?.gameTime ?? 0,
      });
      if (round.status !== 'IN_GAME') return;
      const observations = s.winExpression ? extractObservations(data, this.seen) : labObservations(data, this.seen);
      for (const o of observations) this.hub.reportObservation(s.id, o);
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
      await this.reference.load();
      const pool = await this.lol.pool();
      this.hub.storeState(seriesId, await this.api.putPool(seriesId, this.reference.playable(pool.owned), this.reference.playable(pool.free)));
    } catch (e) {
      this.toast.error(`Pool non remonté : ${errorMessage(e)}`);
    }
  }

  /** Lance la manche : redemande l'ordre au serveur s'il manque ou date d'une autre manche, puis crée le lobby. */
  async launchRound(seriesId: string, roundId: string) {
    const order = this.launchOrder();
    if (!order || order.seriesId !== seriesId || order.roundId !== roundId) {
      this.launchOrder.set(null);
      await this.hub.invoke('RequestLaunch', seriesId);
    }
    await this.launchLobby();
  }

  private isCreator(s: SeriesState): boolean {
    return creatorOf(s)?.userId === s.myUserId;
  }

  /**
   * US-4.2 : le créateur crée le lobby Abîme hurlant blind pick et invite l'adversaire.
   * En 2v2, seul le coéquipier est invité d'abord ; les adversaires le sont une fois qu'il a rejoint l'équipe.
   */
  async launchLobby() {
    // L'événement LaunchLobby peut arriver juste après la réponse à RequestLaunch.
    for (let i = 0; i < 30 && !this.launchOrder(); i++) await new Promise((r) => setTimeout(r, 100));
    const order = this.launchOrder();
    if (!order) throw new Error('Le serveur n’a pas donné l’ordre de lancement.');
    const s = this.hub.series()[order.seriesId];
    const round = s?.rounds.find((r) => r.id === order.roundId);
    const teamSize = order.teamSize ?? 1;
    if (teamSize === 1) {
      await this.lol.createLobby([order.opponentPuuid], `Duel 1v1 manche ${round?.number ?? 1}`);
      this.toast.info(`Lobby créé, invitation envoyée à ${order.opponentRiotId}. La sélection démarre dès qu'il rejoint.`);
      return;
    }
    const mates = (order.guests ?? []).filter((g) => g.slot === 'A');
    this.autoInviteKey = null;
    await this.lol.createLobby(
      mates.map((g) => g.puuid),
      `Duel ${teamSize}v${teamSize} manche ${round?.number ?? 1}`,
      teamSize,
    );
    this.toast.info(`Lobby ${teamSize}v${teamSize} créé : ${mates.map((g) => g.riotId).join(', ')} invité. Les adversaires suivent dès qu'il a rejoint ton équipe.`);
  }

  /** Événements qui demandent une action du joueur (ou qui concluent une manche) : app au premier plan. */
  private static readonly ATTENTION_EVENTS = [
    'BansRevealed',
    'AssignmentReady',
    'PicksRevealed',
    'RoundVoided',
    'RoundDisputed',
    'RoundResolved',
    'SeriesFinished',
    'VoidRequested',
    'SeriesAborted',
  ];

  private onEvent(name: string, seriesId: string, payload: any) {
    if (GameTrackerService.ATTENTION_EVENTS.includes(name)) this.lol.attention();
    const s = this.hub.series()[seriesId];
    const other: SlotName = s?.mySlot === 'A' ? 'B' : 'A';
    const opponents = s ? teamName(s, other) : '';
    switch (name) {
      case 'LaunchLobby':
        this.launchOrder.set({ seriesId, ...payload });
        break;
      case 'AssignmentReady':
        // Pas de hideOverlay ici : la manche suivante est créée dans la foulée de RoundResolved,
        // le bandeau « Manche gagnée » doit rester jusqu'à ce que le joueur quitte la partie.
        this.lastChampSelectKey = '';
        break;
      case 'PickWarning':
        if (s && (payload.userId ?? null) === s.myUserId) this.toast.error('Champion ou sorts non conformes : corrige avant de verrouiller, sinon la manche sera annulée.');
        else if (s && payload.slot === s.mySlot && s.teamSize > 1) this.toast.info('Ton coéquipier survole un choix non conforme.');
        else this.toast.info(`${s?.players.find((p) => p.userId === payload.userId)?.displayName ?? (opponents || 'Ton adversaire')} survole un choix non conforme.`);
        break;
      case 'RoundVoided':
        this.toast.error(`Manche annulée : ${payload.reason}. Elle est rejouée avec les mêmes attributions.`);
        this.startedRoundId = null;
        // La manche rejouée relance lobby, sélection et verrouillage automatiques.
        this.autoLobbyKey = null;
        this.autoSelectKey = null;
        this.autoInviteKey = null;
        this.preparedRoundId = null;
        break;
      case 'RoundDisputed':
        this.toast.error('Observations contradictoires : manche en litige. Votez pour la résoudre.');
        break;
      case 'VoidRequested':
        if (s && payload.bySlot !== s.mySlot) this.toast.info(`${opponents || 'Ton adversaire'} propose${s.teamSize > 1 ? 'nt' : ''} d'annuler la manche.`);
        break;
      case 'RoundResolved': {
        if (!s) break;
        const won = payload.winnerSlot === s.mySlot;
        const myScore = s.mySlot === 'A' ? payload.score.a : payload.score.b;
        const oppScore = s.mySlot === 'A' ? payload.score.b : payload.score.a;
        void this.lol.showOverlay({
          title: won ? 'Manche gagnée' : 'Manche perdue',
          subtitle: `${payload.winnerName} : ${payload.condition}${payload.eventTime != null ? ` à ${formatGameTime(payload.eventTime)}` : ''}`,
          score: `${teamName(s, s.mySlot) || 'Toi'} ${myScore} : ${oppScore} ${opponents}`,
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
