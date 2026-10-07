import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { GameTrackerService } from '../../core/game-tracker.service';
import { HubService } from '../../core/hub.service';
import { LolService } from '../../core/lol.service';
import { formatGameTime, Round, SeriesState, SlotName } from '../../core/models';
import { ReferenceService } from '../../core/reference.service';
import { ToastService } from '../../core/toast.service';
import { ChampionCardComponent, SpellIconComponent } from '../../shared/champion-card.component';
import { describe, leaves, WinNode } from '../../../shared/rules-engine';

function players(s: SeriesState) {
  return { me: s.players.find((p) => p.slot === s.mySlot)!, opp: s.players.find((p) => p.slot !== s.mySlot)! };
}

/** Attribution : pick aveugle (deck) et/ou choix des 2 sorts (deck de sorts). */
@Component({
  selector: 'app-pick-phase',
  imports: [ChampionCardComponent, SpellIconComponent],
  template: `
    @let s = state();
    <div class="grid layout">
      <section class="stack">
        @if (s.championMode === 'DECK') {
          <div class="row"><h2>Ton champion</h2><span class="spacer"></span>
            <span class="muted small">{{ available().length }} disponibles · {{ bannedCount() }} bannis par {{ opp().displayName }} · {{ playedCount() }} joué(s)</span></div>
          <div class="champ-grid">
            @for (d of s.me.deck; track d.championId) {
              <app-champion-card [championId]="d.championId" [banned]="d.banned" [played]="d.consumed" [disabled]="d.banned || d.consumed || submitted()"
                [selected]="champion() === d.championId" (click)="pickChampion(d.championId, d.banned || d.consumed)" />
            }
          </div>
        } @else {
          <h2>Ton champion</h2>
          <div class="assigned">
            <app-champion-card [championId]="mine()!.championId!" [selected]="true" />
            <p class="muted">Tiré par le serveur ({{ s.championMode === 'MIRROR' ? 'miroir : ' + opp().displayName + ' joue le même' : 'aléatoire' }}).</p>
          </div>
        }

        @if (s.spellMode !== 'FREE') {
          <div class="row"><h2>Tes 2 sorts</h2><span class="spacer"></span>
            <span class="muted small">{{ tokensLeft() }} jetons restants sur {{ s.rules.spellBudget }}</span></div>
          <div class="spell-grid">
            @for (t of s.me.spellTokens; track t.spellId) {
              <button class="spell" [class.on]="spells().includes(t.spellId)" [disabled]="t.left === 0 || submitted()" (click)="toggleSpell(t.spellId)">
                <span class="qty">×{{ t.left }}</span>
                @if (ref.spellImage(t.spellId); as src) { <img [src]="src" [alt]="ref.spellName(t.spellId)" /> }
                <span>{{ ref.spellName(t.spellId) }}</span>
              </button>
            }
          </div>
        }
      </section>

      <aside class="stack">
        <div class="card cyan">
          <div class="kicker">Ton choix</div>
          <h1 class="choice">{{ champion() ? ref.championName(champion()) : '—' }}</h1>
          <div class="row wrap">
            @for (sp of spells(); track sp) { <app-spell-icon [spellId]="sp" /> }
          </div>
        </div>
        <div class="card pink">
          <h3>{{ opp().displayName }} {{ oppAssignment()?.submitted ? 'a verrouillé' : 'choisit…' }}</h3>
          <p class="muted small">Révélé quand tu verrouilles.</p>
        </div>
        @if (submitted()) {
          <div class="card">Choix verrouillé. En attente de {{ opp().displayName }}…</div>
        } @else {
          <button class="btn primary big" (click)="lock()" [disabled]="!canLock() || busy()">Verrouiller</button>
        }
        <p class="muted small">Vérifié dans la sélection LoL. Autre champion ou autres sorts : manche annulée et rejouée.</p>
      </aside>
    </div>
  `,
  styles: `
    .layout { grid-template-columns: minmax(0, 1fr) 320px; }
    .small { font-size: 12px; }
    .assigned { display: flex; align-items: center; gap: 20px; }
    .assigned app-champion-card { width: 150px; }
    .choice { font-size: 40px; margin: 6px 0 12px; }
    p { margin: 6px 0 0; }
    h2 { margin: 0; }
  `,
})
export class PickPhaseComponent {
  protected readonly ref = inject(ReferenceService);
  private readonly hub = inject(HubService);
  private readonly toast = inject(ToastService);
  readonly state = input.required<SeriesState>();
  readonly round = input.required<Round>();

  protected readonly opp = computed(() => players(this.state()).opp);
  protected readonly mine = computed(() => this.round().assignments.find((a) => a.slot === this.state().mySlot));
  protected readonly oppAssignment = computed(() => this.round().assignments.find((a) => a.slot !== this.state().mySlot));
  protected readonly submitted = computed(() => !!this.mine()?.submitted);
  protected readonly available = computed(() => this.state().me.deck.filter((d) => !d.banned && !d.consumed));
  protected readonly bannedCount = computed(() => this.state().me.deck.filter((d) => d.banned).length);
  protected readonly playedCount = computed(() => this.state().me.deck.filter((d) => d.consumed).length);
  protected readonly tokensLeft = computed(() => this.state().me.spellTokens.reduce((a, t) => a + t.left, 0));

  private readonly chosen = signal<number | null>(null);
  private readonly chosenSpells = signal<number[]>([]);
  protected readonly champion = computed(() => this.mine()?.championId ?? this.chosen());
  protected readonly spells = computed(() => {
    const m = this.mine();
    return m?.spell1Id ? [m.spell1Id, m.spell2Id!] : this.chosenSpells();
  });
  protected readonly busy = signal(false);
  protected readonly canLock = computed(() => !!this.champion() && (this.state().spellMode === 'FREE' || this.spells().length === 2));

  protected pickChampion(id: number, unavailable: boolean) {
    if (!unavailable && !this.submitted()) this.chosen.set(id);
  }

  protected toggleSpell(id: number) {
    this.chosenSpells.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-2)));
  }

  async lock() {
    this.busy.set(true);
    try {
      const s = this.state();
      await this.hub.invoke('SubmitPick', s.id, s.championMode === 'DECK' ? this.champion() : null, s.spellMode === 'FREE' ? null : this.spells());
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Attributions révélées : création du lobby et contrôle du pick dans la sélection LoL. */
@Component({
  selector: 'app-lobby-phase',
  imports: [ChampionCardComponent, SpellIconComponent],
  template: `
    @let s = state();
    <div class="grid layout">
      <section class="versus">
        @for (a of round().assignments; track a.slot) {
          <div class="side" [class.me]="a.slot === s.mySlot">
            <div class="kicker" [class.danger]="a.slot !== s.mySlot">{{ name(a.slot) }}{{ a.slot === s.mySlot ? ' · toi' : '' }}</div>
            @if (a.championId) {
              <app-champion-card [championId]="a.championId" [selected]="a.slot === s.mySlot" />
            }
            <div class="row wrap">
              @if (a.spell1Id) { <app-spell-icon [spellId]="a.spell1Id" /> <app-spell-icon [spellId]="a.spell2Id" /> }
            </div>
          </div>
        }
        <div class="vs">VS</div>
      </section>

      <aside class="stack">
        @if (isCreator()) {
          <div class="card cyan stack">
            <h3>Lancer la manche</h3>
            <p class="muted small">Crée une partie personnalisée Abîme hurlant 1v1 en blind pick et invite {{ opp().displayName }}.</p>
            <button class="btn primary big" (click)="launch()" [disabled]="busy() || !lol.status().connected || !tracker.launchOrder()">Lancer la manche</button>
            <button class="btn" (click)="startSelect()" [disabled]="busy() || lol.gameflow().phase !== 'Lobby'">Démarrer la sélection</button>
          </div>
        } @else {
          <div class="card cyan">
            <h3>Rejoins la partie</h3>
            <p class="muted small">{{ opp().displayName }} crée le lobby : accepte son invitation dans le client LoL.</p>
          </div>
        }

        <div class="card">
          <div class="kicker muted">Ta sélection LoL</div>
          @if (lol.champSelect(); as cs) {
            <div class="row check">
              <span class="dot" [class.ok]="cs.championId === mine()?.championId" [class.ko]="cs.championId && cs.championId !== mine()?.championId" [class.wait]="!cs.championId"></span>
              {{ cs.championId ? ref.championName(cs.championId) : 'Aucun champion' }} {{ cs.locked ? '(verrouillé)' : '(survolé)' }}
            </div>
            @if (s.spellMode !== 'FREE') {
              <div class="row check">
                <span class="dot" [class.ok]="spellsOk(cs.spells)" [class.ko]="!spellsOk(cs.spells)"></span>
                {{ ref.spellName(cs.spells[0]) }} + {{ ref.spellName(cs.spells[1]) }}
              </div>
            }
          } @else {
            <p class="muted small">Pas encore en sélection ({{ lol.gameflow().phase }}).</p>
          }
        </div>

        <details class="card manual">
          <summary>Création manuelle (secours)</summary>
          <ol class="muted small">
            <li>Jouer → Personnalisée → Créer une partie personnalisée.</li>
            <li>Carte : Abîme hurlant · Joueurs par équipe : 1 · Type : Blind pick.</li>
            <li>Invite {{ opp().riotId }}, puis démarre la partie.</li>
          </ol>
        </details>
        <button class="btn ghost small" (click)="requestVoid()">Proposer d'annuler la manche</button>
      </aside>
    </div>
  `,
  styles: `
    .layout { grid-template-columns: minmax(0, 1fr) 320px; }
    .versus { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: start; }
    .side { display: flex; flex-direction: column; gap: 12px; }
    .side app-champion-card { max-width: 220px; }
    .vs { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-family: var(--display); font-weight: 700; font-size: 40px; color: var(--muted); }
    .small { font-size: 12px; }
    .check { margin-top: 8px; }
    p { margin: 0; }
    .manual summary { cursor: pointer; font-weight: 600; }
    .manual ol { margin: 10px 0 0; padding-left: 18px; }
  `,
})
export class LobbyPhaseComponent {
  protected readonly ref = inject(ReferenceService);
  protected readonly lol = inject(LolService);
  protected readonly tracker = inject(GameTrackerService);
  private readonly hub = inject(HubService);
  private readonly toast = inject(ToastService);
  readonly state = input.required<SeriesState>();
  readonly round = input.required<Round>();
  protected readonly busy = signal(false);
  protected readonly opp = computed(() => players(this.state()).opp);
  protected readonly mine = computed(() => this.round().assignments.find((a) => a.slot === this.state().mySlot));
  protected readonly isCreator = computed(() => this.state().mySlot === this.state().creatorSlot);

  protected name(slot: SlotName) {
    return this.state().players.find((p) => p.slot === slot)?.displayName ?? slot;
  }

  protected spellsOk(spells: [number, number]) {
    const m = this.mine();
    if (!m?.spell1Id) return true;
    return [...spells].sort().join() === [m.spell1Id, m.spell2Id].sort().join();
  }

  async launch() {
    await this.run(async () => {
      if (!this.tracker.launchOrder()) await this.hub.invoke('RequestLaunch', this.state().id);
      await this.tracker.launchLobby();
    });
  }

  async startSelect() {
    await this.run(() => this.lol.startChampSelect());
  }

  async requestVoid() {
    await this.run(() => this.hub.invoke('RequestVoidRound', this.state().id, 'Demande joueur'));
  }

  private async run(action: () => Promise<unknown>) {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Suivi en direct de la manche (écran « Live ») et résolution des litiges. */
@Component({
  selector: 'app-live-phase',
  template: `
    @let s = state();
    <div class="grid layout">
      <section class="stack">
        <div class="versus card">
          @for (a of round().assignments; track a.slot) {
            <div class="side" [class.right]="a.slot !== s.mySlot" [style.order]="a.slot === s.mySlot ? 0 : 2">
              <div class="kicker" [class.danger]="a.slot !== s.mySlot">{{ name(a.slot) }}{{ a.slot === s.mySlot ? ' · toi' : '' }}</div>
              <h2>{{ ref.championName(a.championId) }}</h2>
              <span class="chip" [class.green]="a.conform" [class.pink]="!a.conform">{{ a.conform ? '✓ conforme' : '✕ non conforme' }}</span>
            </div>
          }
          <div class="mid" style="order: 1">
            <div class="vs">VS</div>
            <span class="chip pink">LIVE {{ clock() }}</span>
          </div>
        </div>

        @if (round().status === 'DISPUTED') {
          <div class="card pink stack">
            <h3>Manche en litige</h3>
            @for (c of s.live?.contradictions ?? []; track c) { <p class="muted small">{{ c }}</p> }
            <p class="small">Désignez ensemble le vainqueur. En cas de désaccord, la manche est annulée et rejouée.</p>
            <div class="row wrap">
              <button class="btn" [class.outline]="round().myDisputeVote === s.mySlot" (click)="vote(s.mySlot)">J'ai gagné</button>
              <button class="btn" [class.outline]="round().myDisputeVote === oppSlot()" (click)="vote(oppSlot())">{{ opp().displayName }} a gagné</button>
              <button class="btn" [class.outline]="round().myDisputeVote === 'VOID'" (click)="vote('VOID')">Annuler la manche</button>
            </div>
          </div>
        }

        <div class="card">
          <div class="row"><h2>Conditions de victoire</h2><span class="spacer"></span><span class="muted small">La première atteinte gagne</span></div>
          <div class="conds">
            @for (leaf of conditionLeaves(); track $index) {
              <div class="cond">
                <div class="row"><strong class="display">{{ label(leaf) }}</strong><span class="spacer"></span><span class="yellow small">{{ hint(leaf) }}</span></div>
                <div class="bars">
                  @for (p of progressRows(leaf); track p.slot) {
                    <div class="bar-row">
                      <span class="who" [class.accent]="p.mine" [class.danger]="!p.mine">{{ p.mine ? 'Toi' : opp().displayName }}</span>
                      <div class="bar"><i [style.transform]="'scaleX(' + p.pct / 100 + ')'" [class.me]="p.mine"></i></div>
                      <span class="val">{{ p.text }}</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
          <p class="muted small expr">{{ s.winExpressionLabel }}</p>
        </div>
      </section>

      <aside class="stack">
        <div class="card">
          <h3>Événements validés</h3>
          @for (e of s.live?.events ?? []; track $index) {
            <div class="list-item ev">
              <div><strong>{{ eventLabel(e.type) }} · {{ name(e.slot) }}</strong>
                <div class="muted small">{{ fmt(e.eventTime) }} · {{ e.singleSource ? 'source unique' : 'confirmé par les 2 clients' }}</div></div>
            </div>
          } @empty {
            <p class="muted small">Aucun événement pour l'instant.</p>
          }
          @if (s.live?.pending) { <p class="yellow small">Observation en attente de confirmation…</p> }
        </div>
        <div class="card">
          <h3>Connexions</h3>
          <div class="conn"><span>Données de jeu</span><span><span class="dot" [class.ok]="liveOk()" [class.ko]="!liveOk()"></span>{{ liveOk() ? 'OK' : 'Aucune' }}</span></div>
          <div class="conn"><span>Serveur arbitre</span><span><span class="dot" [class.ok]="hub.state() === 'connected'" [class.ko]="hub.state() !== 'connected'"></span>{{ hub.state() === 'connected' ? 'OK' : 'Reconnexion' }}</span></div>
          <div class="conn"><span>Client LoL</span><span><span class="dot" [class.ok]="lol.status().connected" [class.ko]="!lol.status().connected"></span>{{ lol.gameflow().phase }}</span></div>
        </div>
        <button class="btn ghost" (click)="requestVoid()" [disabled]="round().voidRequestedBySlot === s.mySlot">
          {{ round().voidRequestedBySlot === s.mySlot ? 'Annulation proposée' : round().voidRequestedBySlot ? 'Accepter l’annulation' : 'Proposer d’annuler la manche' }}
        </button>
      </aside>
    </div>
  `,
  styles: `
    .layout { grid-template-columns: minmax(0, 1fr) 300px; }
    .small { font-size: 12px; }
    p { margin: 6px 0 0; }
    h2 { margin: 6px 0 10px; }
    .versus { display: flex; align-items: center; justify-content: space-between; gap: 20px;
      background: linear-gradient(110deg, rgba(25, 227, 255, 0.08), var(--panel) 45%, var(--panel) 55%, rgba(255, 51, 102, 0.08)); }
    .side.right { text-align: right; }
    .side h2 { font-size: 36px; }
    .mid { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .vs { font-family: var(--display); font-weight: 700; font-size: 32px; color: var(--muted); }
    .conds { display: grid; gap: 16px; margin-top: 8px; }
    .cond { padding: 14px; border-radius: 10px; background: #0a0d13; border: 1px solid var(--line); }
    .display { font-family: var(--display); letter-spacing: 0.08em; font-size: 16px; }
    .bars { display: grid; gap: 8px; margin-top: 10px; }
    .bar-row { display: grid; grid-template-columns: 90px 1fr 60px; gap: 10px; align-items: center; }
    .who { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { height: 8px; border-radius: 4px; background: #222a38; overflow: hidden; }
    .bar i { display: block; width: 100%; height: 100%; background: var(--pink); transform-origin: left; transition: transform 0.3s; }
    .bar i.me { background: var(--cyan); }
    .val { text-align: right; font-family: var(--display); font-weight: 700; }
    .expr { margin-top: 12px; }
    .ev { padding: 8px 0; }
    .conn { display: flex; justify-content: space-between; padding: 6px 0; }
  `,
})
export class LivePhaseComponent {
  protected readonly ref = inject(ReferenceService);
  protected readonly lol = inject(LolService);
  protected readonly hub = inject(HubService);
  private readonly tracker = inject(GameTrackerService);
  private readonly toast = inject(ToastService);
  readonly state = input.required<SeriesState>();
  readonly round = input.required<Round>();

  protected readonly opp = computed(() => players(this.state()).opp);
  protected readonly oppSlot = computed(() => this.opp().slot);
  protected readonly conditionLeaves = computed(() => leaves(this.state().winExpression));
  protected readonly clock = computed(() => formatGameTime(this.tracker.localProgress()?.gameTime ?? 0));
  protected readonly liveOk = computed(() => !!this.lol.liveData());
  protected readonly fmt = formatGameTime;

  protected name(slot: SlotName) {
    return this.state().players.find((p) => p.slot === slot)?.displayName ?? slot;
  }

  protected label(leaf: WinNode) {
    return describe(leaf);
  }

  protected eventLabel(type: string) {
    return { KILL: 'Kill', FIRST_BLOOD: 'First blood', TURRET: 'Tour détruite', CS: 'CS' }[type] ?? type;
  }

  protected hint(leaf: WinNode): string {
    const mine = this.progressRows(leaf).find((r) => r.mine);
    if (!mine || leaf.condition !== 'KILLS' || !leaf.threshold) return '';
    const left = leaf.threshold - mine.value;
    return left > 0 ? `Plus que ${left} kill${left > 1 ? 's' : ''}` : 'Atteint';
  }

  /** Progression : valeurs arbitrées par le serveur, complétées par la vue locale (plus réactive). */
  protected progressRows(leaf: WinNode) {
    const s = this.state();
    const local = this.tracker.localProgress();
    return (['A', 'B'] as SlotName[]).map((slot) => {
      const mine = slot === s.mySlot;
      const server = s.live?.progress[slot];
      const facts = local ? (mine ? local.self : local.opponent) : null;
      let value = 0;
      let target = 1;
      switch (leaf.condition) {
        case 'KILLS':
          value = Math.max(server?.kills ?? 0, facts?.killTimes.length ?? 0);
          target = leaf.threshold ?? 1;
          break;
        case 'CS':
          value = Math.max(server?.cs ?? 0, facts?.csSamples.at(-1)?.value ?? 0);
          target = leaf.threshold ?? 1;
          break;
        case 'FIRST_BLOOD':
          value = server?.firstBlood || facts?.firstBloodTime != null ? 1 : 0;
          break;
        case 'FIRST_TOWER':
          value = server?.firstTower || facts?.firstTowerTime != null ? 1 : 0;
          break;
      }
      const isBinary = leaf.condition === 'FIRST_BLOOD' || leaf.condition === 'FIRST_TOWER';
      return { slot, mine, value, pct: Math.min(100, (value / target) * 100), text: isBinary ? (value ? '✓' : 'aucune') : `${value}/${target}` };
    });
  }

  async vote(v: string) {
    try {
      await this.hub.invoke('VoteDispute', this.state().id, v);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async requestVoid() {
    try {
      await this.hub.invoke('RequestVoidRound', this.state().id, 'Demande joueur');
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}

/** Récapitulatif de fin de série (US-4.5) et détail par manche (US-5.1). */
@Component({
  selector: 'app-series-recap',
  template: `
    @let s = state();
    <div class="hero" [class.win]="won()" [class.loss]="!won()">
      <div class="kicker">Série terminée · BO{{ s.bestOf }}</div>
      <h1 class="big">{{ s.status === 'ABORTED' ? 'Interrompue' : won() ? 'Victoire' : 'Défaite' }}</h1>
      <p class="muted">Contre {{ opp().riotId }} · {{ validated() }} manches jouées{{ voided() ? ', ' + voided() + ' annulée(s)' : '' }}</p>
      <div class="score">
        <span class="name">{{ me().displayName }}</span>
        <span class="num me">{{ me().roundsWon }}</span><span class="sep">:</span><span class="num opp">{{ opp().roundsWon }}</span>
        <span class="name">{{ opp().displayName }}</span>
      </div>
    </div>
    <h2>Détail des manches</h2>
    <div class="card">
      @for (r of s.rounds; track r.id) {
        <div class="list-item round">
          <span class="chip" [class.cyan]="r.winnerSlot === s.mySlot" [class.pink]="r.winnerSlot && r.winnerSlot !== s.mySlot">
            {{ r.status === 'VOIDED' ? 'Annulée' : r.winnerSlot === s.mySlot ? 'Victoire' : r.winnerSlot ? 'Défaite' : r.status }}
          </span>
          <strong class="m">M{{ r.number }}</strong>
          <span class="grow">{{ champ(r, s.mySlot) }} <span class="muted">vs</span> {{ champ(r, oppSlot()) }}</span>
          <span class="muted">{{ r.status === 'VOIDED' ? r.voidReason : r.winningCondition?.label }}</span>
          <span class="time">{{ fmt(r.winningCondition?.eventTime) }}</span>
        </div>
      }
    </div>
    <div class="row actions">
      <button class="btn outline" (click)="rematch()">Revanche</button>
      <button class="btn" (click)="home()">Accueil</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 20px; }
    .hero { padding: 28px; border-radius: 16px; border: 1px solid var(--line); }
    .hero.win { background: linear-gradient(120deg, rgba(25, 227, 255, 0.14), var(--panel)); border-color: rgba(25, 227, 255, 0.5); }
    .hero.loss { background: linear-gradient(120deg, rgba(255, 51, 102, 0.14), var(--panel)); border-color: rgba(255, 51, 102, 0.5); }
    .big { font-size: 64px; margin: 6px 0; }
    .hero p { margin: 0 0 16px; }
    .round { gap: 16px; }
    .m { font-family: var(--display); font-size: 18px; width: 40px; }
    .grow { flex: 1; font-weight: 600; }
    .time { font-family: var(--display); font-weight: 700; width: 60px; text-align: right; }
    h2 { margin: 0; }
  `,
})
export class SeriesRecapComponent {
  private readonly ref = inject(ReferenceService);
  private readonly router = inject(Router);
  readonly state = input.required<SeriesState>();
  protected readonly me = computed(() => players(this.state()).me);
  protected readonly opp = computed(() => players(this.state()).opp);
  protected readonly oppSlot = computed(() => this.opp().slot);
  protected readonly won = computed(() => this.state().winnerSlot === this.state().mySlot);
  protected readonly validated = computed(() => this.state().rounds.filter((r) => r.status === 'VALIDATED').length);
  protected readonly voided = computed(() => this.state().rounds.filter((r) => r.status === 'VOIDED').length);
  protected readonly fmt = formatGameTime;

  protected champ(r: Round, slot: SlotName) {
    return this.ref.championName(r.assignments.find((a) => a.slot === slot)?.championId);
  }

  rematch() {
    void this.router.navigate(['/new'], { queryParams: { opponent: this.opp().riotId } });
  }

  home() {
    void this.router.navigateByUrl('/');
  }
}
