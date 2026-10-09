import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { GameTrackerService } from '../../core/game-tracker.service';
import { HubService } from '../../core/hub.service';
import { LolService } from '../../core/lol.service';
import { formatGameTime, HistoryEntry, MODE_LABELS, Round, SeriesState, SlotName, SPELL_MODE_LABELS } from '../../core/models';
import { ReferenceService } from '../../core/reference.service';
import { ToastService } from '../../core/toast.service';
import { ChampionCardComponent, SpellIconComponent } from '../../shared/champion-card.component';
import { AvatarComponent } from '../../shared/avatar.component';
import { ChampIconComponent } from '../../shared/champ-icon.component';
import { gameName, RoundRecapComponent, RoundRecapHeadComponent } from '../../shared/round-recap.component';
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
            <button class="btn primary big" (click)="launch()" [disabled]="busy() || !lol.status().connected" [title]="lol.status().connected ? '' : 'Lance le client LoL'">Lancer la manche</button>
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

        @if (s.spellMode !== 'FREE') {
          <p class="muted small">Blitz, Porofessor… : désactive l'import automatique des sorts, sinon ils remplacent les sorts imposés.</p>
        }
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
      // Ordre manqué (app relancée après la révélation) ou d'une manche précédente : on le redemande au serveur.
      const order = this.tracker.launchOrder();
      if (!order || order.seriesId !== this.state().id || order.roundId !== this.round().id) {
        this.tracker.launchOrder.set(null);
        await this.hub.invoke('RequestLaunch', this.state().id);
      }
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

        @if (!s.winExpression) {
          <!-- Mode labo : panneau projeté par la page série. -->
          <ng-content />
        } @else {
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
        }
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
  protected readonly conditionLeaves = computed(() => {
    const expr = this.state().winExpression;
    return expr ? leaves(expr) : [];
  });
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
  imports: [AvatarComponent, ChampIconComponent, RoundRecapComponent, RoundRecapHeadComponent],
  template: `
    @let s = state();
    <div class="hero" [class.win]="outcome() === 'win'" [class.loss]="outcome() === 'loss'">
      <app-avatar class="avatar neutral opp" [iconId]="opp().profileIconId" [name]="oppName()" />
      <div class="grow">
        <div class="kicker">Série terminée · contre {{ oppName() }}</div>
        <h1 class="big">{{ outcome() === 'aborted' ? 'Interrompue' : outcome() === 'win' ? 'Victoire' : 'Défaite' }}</h1>
        <div class="row wrap chips">
          <span class="chip">BO{{ s.bestOf }}</span>
          <span class="chip">{{ modeLabel[s.championMode] }}</span>
          <span class="chip">{{ spellLabel[s.spellMode] }}</span>
          <span class="muted small">{{ s.winExpressionLabel }}</span>
        </div>
      </div>
      <div class="tally">
        <strong class="score">{{ me().roundsWon }}<span class="sep">:</span>{{ opp().roundsWon }}</strong>
        <span class="muted small">{{ validated() }} manche(s){{ voided() ? ' · ' + voided() + ' annulée(s)' : '' }}</span>
      </div>
    </div>

    <h2>Détail des manches</h2>
    @if (recap(); as r) {
      <div class="rounds">
        @if (r.rounds.length) {
          <app-round-recap-head [opponent]="oppName()" />
        }
        @for (round of r.rounds; track round.number) {
          <app-round-recap [round]="round" [mySlot]="s.mySlot" />
        } @empty {
          <div class="empty">Aucune manche jouée.</div>
        }
      </div>
      @if (r.myBans.length || r.opponentBans.length) {
        <div class="bans">
          <div class="ban-side">
            <span class="label">Tes bans</span>
            <div class="row">@for (id of r.myBans; track id) { <app-champ-icon [id]="id" /> }</div>
          </div>
          <div class="ban-side right">
            <span class="label">Bans de {{ oppName() }}</span>
            <div class="row">@for (id of r.opponentBans; track id) { <app-champ-icon [id]="id" /> }</div>
          </div>
        </div>
      }
    } @else {
      <div class="empty">{{ error() || 'Chargement du récapitulatif…' }}</div>
    }

    <div class="row actions">
      <button class="btn primary" (click)="rematch()">Revanche</button>
      <button class="btn" (click)="faceToFace()">Face à face</button>
      <button class="btn ghost" (click)="home()">Accueil</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .hero { --tone: var(--muted); --tint: transparent; display: flex; align-items: center; gap: 22px; padding: 22px 26px; border-radius: var(--radius); border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--line)); background: linear-gradient(90deg, var(--tint), var(--panel) 55%); }
    .hero.win { --tone: var(--green); --tint: rgba(61, 220, 132, 0.16); }
    .hero.loss { --tone: var(--pink); --tint: rgba(255, 51, 102, 0.16); }
    .opp { width: 64px; height: 64px; border-radius: 14px; font-size: 24px; }
    .grow { flex: 1; min-width: 0; }
    .kicker .muted { text-transform: none; letter-spacing: 0; font-family: var(--body); font-weight: 500; }
    .big { font-size: 52px; margin: 4px 0 10px; color: var(--tone); }
    .hero:not(.win):not(.loss) .big { color: var(--text); }
    .chips { gap: 6px; }
    .small { font-size: 12px; }
    .tally { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .score { font-family: var(--display); font-size: 56px; line-height: 1; }
    .score .sep { color: var(--muted); margin: 0 4px; }
    h2 { margin: 8px 0 0; }
    .rounds { display: flex; flex-direction: column; gap: 8px; }
    .bans { display: flex; justify-content: space-between; gap: 20px; padding: 14px 18px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); }
    .ban-side { display: flex; flex-direction: column; gap: 10px; }
    .ban-side.right { align-items: flex-end; }
    .ban-side .row { gap: 8px; }
    .label { font-family: var(--display); font-weight: 700; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
    .actions { gap: 10px; }
  `,
})
export class SeriesRecapComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly state = input.required<SeriesState>();
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly recap = signal<HistoryEntry | null>(null);
  protected readonly error = signal('');
  protected readonly me = computed(() => players(this.state()).me);
  protected readonly opp = computed(() => players(this.state()).opp);
  protected readonly oppName = computed(() => gameName(this.opp().riotId));
  protected readonly outcome = computed(() => {
    const s = this.state();
    if (s.status !== 'FINISHED' || !s.winnerSlot) return 'aborted';
    return s.winnerSlot === s.mySlot ? 'win' : 'loss';
  });
  protected readonly validated = computed(() => this.state().rounds.filter((r) => r.status === 'VALIDATED').length);
  protected readonly voided = computed(() => this.state().rounds.filter((r) => r.status === 'VOIDED').length);

  async ngOnInit() {
    try {
      this.recap.set(await this.api.seriesRecap(this.state().id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  rematch() {
    void this.router.navigate([this.state().lab ? '/labo' : '/new'], { queryParams: { opponent: this.opp().riotId } });
  }

  faceToFace() {
    void this.router.navigate(['/stats'], { queryParams: { tab: 'players', player: this.opp().riotId } });
  }

  home() {
    void this.router.navigateByUrl('/');
  }
}
