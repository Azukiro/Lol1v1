import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { GameTrackerService } from '../../core/game-tracker.service';
import { HubService } from '../../core/hub.service';
import { LolService } from '../../core/lol.service';
import { SeriesState, usesDeck } from '../../core/models';
import { ReferenceService } from '../../core/reference.service';
import { ToastService } from '../../core/toast.service';
import { ChampionCardComponent } from '../../shared/champion-card.component';

/** Étape de préparation : pool, deck (mode deck), budget de sorts (deck composé). */
@Component({
  selector: 'app-setup-phase',
  imports: [FormsModule, ChampionCardComponent],
  template: `
    @let s = state();
    @if (!me().poolUpdatedAt) {
      <div class="card pink row">
        <div class="grow">
          <h3>Remonte ton pool</h3>
          <p class="muted">Tes champions possédés et la rotation gratuite sont lus dans le client LoL.</p>
        </div>
        <button class="btn danger-fill" (click)="tracker.uploadPool(s.id)" [disabled]="!lol.status().connected">Envoyer mon pool</button>
      </div>
    }

    @if (mirrorDeck() && !me().deckLocked && me().poolUpdatedAt && !s.me.commonPool) {
      <div class="card">
        <h3>En attente du pool de {{ opponent().displayName }}</h3>
        <p class="muted">Ton deck ne peut contenir que des champions que vous possédez tous les deux.</p>
      </div>
    } @else if (usesDeck(s.championMode) && !me().deckLocked && me().poolUpdatedAt) {
      <div class="grid deck-layout">
        <section>
          <div class="row toolbar">
            <input class="input grow" placeholder="Rechercher un champion" [ngModel]="query()" (ngModelChange)="query.set($event)" />
            <div class="seg">
              <button [class.on]="filter() === 'all'" (click)="filter.set('all')">TOUS · {{ pool().length }}</button>
              <button [class.on]="filter() === 'free'" (click)="filter.set('free')">GRATUITS · {{ freeInPool().length }}</button>
            </div>
          </div>
          <div class="champ-grid">
            @for (id of visible(); track id) {
              <app-champion-card [championId]="id" [free]="isFree(id)" [selected]="picked().has(id)" (click)="toggle(id)" />
            }
          </div>
        </section>
        <aside class="card cyan side">
          <div class="kicker">Ton deck</div>
          <div class="count"><span class="accent">{{ picked().size }}</span> / {{ s.rules.minDeckSize }}</div>
          <div class="deck-list">
            @for (id of pickedList(); track id) {
              <button class="chip cyan" (click)="toggle(id)" title="Retirer">{{ ref.championName(id) }} ✕</button>
            }
          </div>
          @if (mirrorDeck()) {
            <p class="muted small">Champions que vous possédez tous les deux. Avec ceux de {{ opponent().displayName }}, ils forment le pot : chaque manche en tire un, joué par vous deux.</p>
          } @else {
            <p class="muted small">{{ s.bestOf }} manches max + 3 bans subis = {{ s.rules.minDeckSize }} champions minimum. Varie les rôles pour encaisser les bans.</p>
          }
          <button class="btn primary big" (click)="lockDeck()" [disabled]="busy() || picked().size < s.rules.minDeckSize">
            {{ picked().size < s.rules.minDeckSize ? 'Encore ' + (s.rules.minDeckSize - picked().size) + ' à choisir' : 'Valider mon deck' }}
          </button>
        </aside>
      </div>
    }

    @if (s.spellMode === 'DECK_COMPOSED' && !me().spellBudgetLocked) {
      <section class="card budget">
        <h2>Ton deck de sorts</h2>
        <p class="muted">Répartis {{ s.rules.spellBudget }} jetons ({{ s.rules.spellCap }} max par sort). Chaque manche consomme 2 sorts différents.</p>
        <div class="spell-grid">
          @for (spell of spells(); track spell.id) {
            <div class="spell-edit">
              @if (ref.spellImage(spell.id); as src) { <img [src]="src" [alt]="spell.name" /> }
              <span>{{ spell.name }}</span>
              <div class="row stepper">
                <button class="btn small" (click)="bump(spell.id, -1)" [disabled]="(budget()[spell.id] || 0) === 0">−</button>
                <strong>{{ budget()[spell.id] || 0 }}</strong>
                <button class="btn small" (click)="bump(spell.id, 1)" [disabled]="(budget()[spell.id] || 0) >= s.rules.spellCap || budgetTotal() >= s.rules.spellBudget">+</button>
              </div>
            </div>
          }
        </div>
        <div class="row">
          <span>Total : <strong [class.accent]="budgetTotal() === s.rules.spellBudget">{{ budgetTotal() }}</strong> / {{ s.rules.spellBudget }}</span>
          <span class="spacer"></span>
          <button class="btn primary" (click)="lockBudget()" [disabled]="busy() || budgetTotal() !== s.rules.spellBudget">Valider mes sorts</button>
        </div>
      </section>
    }

    @if (waiting()) {
      <div class="card waiting">
        <h3>En attente de {{ opponent().displayName }}</h3>
        <ul class="muted">
          <li><span class="dot" [class.ok]="opponent().poolUpdatedAt" [class.wait]="!opponent().poolUpdatedAt"></span>Pool</li>
          @if (usesDeck(s.championMode)) {
            <li><span class="dot" [class.ok]="opponent().deckLocked" [class.wait]="!opponent().deckLocked"></span>Deck</li>
          }
          @if (s.spellMode === 'DECK_COMPOSED') {
            <li><span class="dot" [class.ok]="opponent().spellBudgetLocked" [class.wait]="!opponent().spellBudgetLocked"></span>Sorts</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 24px; }
    .grow { flex: 1; }
    .small { font-size: 12px; }
    p { margin: 6px 0 0; }
    .deck-layout { grid-template-columns: minmax(0, 1fr) 300px; }
    .toolbar { margin-bottom: 16px; }
    .side { display: flex; flex-direction: column; gap: 14px; align-self: start; position: sticky; top: 24px; }
    .count { font-family: var(--display); font-weight: 700; font-size: 40px; }
    .deck-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .deck-list .chip { cursor: pointer; }
    .budget { display: flex; flex-direction: column; gap: 16px; }
    .spell-edit { width: 110px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--panel-2); }
    .spell-edit img { width: 40px; height: 40px; border-radius: 8px; }
    .spell-edit span { font-size: 12px; text-align: center; }
    .stepper { gap: 8px; }
    .waiting ul { list-style: none; padding: 0; margin: 12px 0 0; display: flex; gap: 20px; }
  `,
})
export class SetupPhaseComponent {
  protected readonly ref = inject(ReferenceService);
  protected readonly lol = inject(LolService);
  protected readonly tracker = inject(GameTrackerService);
  private readonly api = inject(ApiService);
  private readonly hub = inject(HubService);
  private readonly toast = inject(ToastService);

  readonly state = input.required<SeriesState>();
  protected readonly me = computed(() => this.state().players.find((p) => p.slot === this.state().mySlot)!);
  protected readonly opponent = computed(() => this.state().players.find((p) => p.slot !== this.state().mySlot)!);
  protected readonly usesDeck = usesDeck;
  protected readonly mirrorDeck = computed(() => this.state().championMode === 'MIRROR_DECK');
  /** Champions proposés pour le deck : tout mon pool, ou seulement les communs en deck miroir. */
  protected readonly pool = computed(() => (this.mirrorDeck() ? (this.state().me.commonPool ?? []) : [...this.state().me.pool, ...this.state().me.free]));
  protected readonly freeInPool = computed(() => this.state().me.free.filter((id) => this.pool().includes(id)));
  protected readonly query = signal('');
  protected readonly filter = signal<'all' | 'free'>('all');
  protected readonly picked = signal(new Set<number>());
  protected readonly pickedList = computed(() => [...this.picked()]);
  protected readonly budget = signal<Record<number, number>>({});
  protected readonly busy = signal(false);
  protected readonly spells = computed(() => this.ref.spells().filter((s) => this.state().rules.allowedSpellIds.includes(s.id)));
  protected readonly budgetTotal = computed(() => Object.values(this.budget()).reduce((a, b) => a + b, 0));

  protected readonly visible = computed(() => {
    this.ref.version();
    const ids = this.filter() === 'free' ? this.freeInPool() : this.pool();
    return this.ref.search(ids, this.query());
  });

  protected readonly waiting = computed(() => {
    const s = this.state();
    const me = this.me();
    const meDone = !!me.poolUpdatedAt && (!usesDeck(s.championMode) || me.deckLocked) && (s.spellMode !== 'DECK_COMPOSED' || me.spellBudgetLocked);
    return meDone;
  });

  protected isFree(id: number) {
    return this.state().me.free.includes(id);
  }

  protected toggle(id: number) {
    this.picked.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      // Deck miroir : taille exacte, pas un minimum.
      else if (!this.mirrorDeck() || next.size < this.state().rules.minDeckSize) next.add(id);
      return next;
    });
  }

  protected bump(spellId: number, delta: number) {
    this.budget.update((b) => ({ ...b, [spellId]: Math.max(0, (b[spellId] ?? 0) + delta) }));
  }

  async lockDeck() {
    await this.run(async () => this.hub.storeState(this.state().id, await this.api.putDeck(this.state().id, this.pickedList())));
  }

  async lockBudget() {
    await this.run(async () => this.hub.storeState(this.state().id, await this.api.putSpellBudget(this.state().id, this.budget())));
  }

  private async run(action: () => Promise<void>) {
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

/** Phase de bans : 3 champions du deck adverse, à l'aveugle simultané. */
@Component({
  selector: 'app-ban-phase',
  imports: [ChampionCardComponent],
  template: `
    @let s = state();
    <div class="grid layout">
      <section>
        <div class="row slots">
          @for (i of [0, 1, 2]; track i) {
            <div class="slot" [class.filled]="selectedList()[i]">
              {{ selectedList()[i] ? ref.championName(selectedList()[i]) : 'Ban ' + (i + 1) }}
            </div>
          }
        </div>
        <h2>Deck de {{ opponentName() }}</h2>
        <p class="muted">{{ s.opponent.deck?.length }} champions · bans révélés quand vous avez validé tous les deux</p>
        <div class="champ-grid">
          @for (d of s.opponent.deck ?? []; track d.championId) {
            <app-champion-card [championId]="d.championId" [banSelected]="selected().has(d.championId)"
              [banned]="selected().has(d.championId) || submittedSet().has(d.championId)" [disabled]="submitted()" (click)="toggle(d.championId)" />
          }
        </div>
      </section>
      <aside class="stack">
        <div class="card pink">
          <h3>{{ opponentName() }} {{ opponentDone() ? 'a banni' : 'bannit…' }}</h3>
          <p class="muted">Il choisit 3 champions dans ton deck.</p>
        </div>
        <div class="card">
          <div class="kicker muted">Ton deck</div>
          <div class="deck-list">
            @for (d of s.me.deck; track d.championId) {
              <span class="chip">{{ ref.championName(d.championId) }}</span>
            }
          </div>
          <p class="muted small">Il t'en restera au moins {{ s.me.deck.length - 3 }} : assez pour toute la série.</p>
        </div>
        @if (submitted()) {
          <div class="card cyan">Bans envoyés. En attente de {{ opponentName() }}…</div>
        } @else {
          <button class="btn primary big" (click)="submit()" [disabled]="busy() || selected().size !== 3">
            {{ selected().size < 3 ? 'Encore ' + (3 - selected().size) + ' ban(s)' : 'Valider mes bans' }}
          </button>
        }
      </aside>
    </div>
  `,
  styles: `
    .layout { grid-template-columns: minmax(0, 1fr) 300px; }
    .slots { gap: 12px; margin-bottom: 24px; }
    .slot { flex: 1; padding: 16px; border-radius: 12px; border: 1px dashed var(--line); text-align: center; font-family: var(--display); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
    .slot.filled { border: 1px solid var(--pink); color: var(--pink); background: var(--pink-dim); }
    p { margin: 6px 0 16px; }
    .small { font-size: 12px; }
    .deck-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  `,
})
export class BanPhaseComponent {
  protected readonly ref = inject(ReferenceService);
  private readonly hub = inject(HubService);
  private readonly toast = inject(ToastService);
  readonly state = input.required<SeriesState>();
  protected readonly selected = signal(new Set<number>());
  protected readonly selectedList = computed(() => (this.submitted() ? this.state().me.myBans : [...this.selected()]));
  protected readonly submittedSet = computed(() => new Set(this.state().me.myBans));
  protected readonly submitted = computed(() => this.state().me.myBans.length > 0);
  protected readonly busy = signal(false);
  protected readonly opponentName = computed(() => this.state().players.find((p) => p.slot !== this.state().mySlot)!.displayName);
  protected readonly opponentDone = computed(() => this.state().players.find((p) => p.slot !== this.state().mySlot)!.bansSubmitted);

  protected toggle(id: number) {
    if (this.submitted()) return;
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  async submit() {
    this.busy.set(true);
    try {
      await this.hub.invoke('SubmitBans', this.state().id, [...this.selected()]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
