import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { LolService } from '../core/lol.service';
import { ChampionMode, MODE_LABELS, SeriesConfig, SpellMode, SPELL_MODE_LABELS } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ConditionCode, describe, needsThreshold, validate, WinNode } from '../../shared/rules-engine';

interface Cond {
  condition: ConditionCode;
  threshold: number;
}
interface Item {
  op: 'AND' | 'OR';
  conds: Cond[]; // 1 condition = condition simple, plusieurs = groupe entre parenthèses
}

const CONDITIONS: { code: ConditionCode; label: string }[] = [
  { code: 'KILLS', label: 'Kills' },
  { code: 'FIRST_BLOOD', label: 'First blood' },
  { code: 'FIRST_TOWER', label: 'Première tour' },
  { code: 'CS', label: 'CS (minions)' },
];

@Component({
  selector: 'app-new-challenge',
  imports: [FormsModule],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker">Créer une série</div>
          <h1>Nouveau défi</h1>
        </div>
      </header>

      <div class="grid cols-main">
        <div class="stack gap">
          <section>
            <h2><span class="step">01</span> Adversaire</h2>
            <div class="row">
              <input class="input grow" placeholder="Pseudo#TAG" [(ngModel)]="opponent" name="opp" />
            </div>
            @if (friends().length) {
              <div class="row wrap recent">
                <span class="muted">Amis</span>
                @for (r of friends(); track r.riotId) {
                  <button class="chip" [class.cyan]="opponent === r.riotId" (click)="opponent = r.riotId">{{ r.riotId }}</button>
                }
              </div>
            }
            @if (recent().length) {
              <div class="row wrap recent">
                <span class="muted">Récents</span>
                @for (r of recent(); track r.userId) {
                  <button class="chip" [class.cyan]="opponent === r.riotId" (click)="opponent = r.riotId">{{ r.riotId }}</button>
                }
              </div>
            }
          </section>

          <section>
            <h2><span class="step">02</span> Format</h2>
            <div class="seg">
              @for (bo of bestOfs; track bo) {
                <button [class.on]="bestOf() === bo" (click)="bestOf.set(bo)">BO{{ bo }}</button>
              }
            </div>
          </section>

          <section>
            <h2><span class="step">03</span> Mode de champion</h2>
            <div class="options">
              <button class="option-card" [class.on]="mode() === 'MIRROR'" (click)="mode.set('MIRROR')">
                <strong>Miroir</strong><span>Le même champion pour les deux, tiré dans vos pools communs.</span>
              </button>
              <button class="option-card" [class.on]="mode() === 'RANDOM'" (click)="mode.set('RANDOM')">
                <strong>Aléatoire</strong><span>Un champion différent par joueur, tiré par le serveur.</span>
              </button>
              <button class="option-card" [class.on]="mode() === 'DECK'" (click)="mode.set('DECK')">
                <strong>Deck</strong><span>Chacun compose son deck, 3 bans puis pick aveugle.</span>
              </button>
            </div>
          </section>

          <section>
            <h2><span class="step">04</span> Sorts d'invocateur</h2>
            <div class="seg">
              <button [class.on]="spellMode() === 'FREE'" (click)="spellMode.set('FREE')">LIBRES</button>
              <button [class.on]="spellMode() === 'DECK_COMPOSED'" (click)="spellMode.set('DECK_COMPOSED')">DECK COMPOSÉ</button>
              <button [class.on]="spellMode() === 'DECK_RANDOM'" (click)="spellMode.set('DECK_RANDOM')">DECK ALÉATOIRE</button>
            </div>
            <p class="muted small">Sorts disponibles sur l'Abîme hurlant uniquement.</p>
          </section>

          <section>
            <h2><span class="step">05</span> Conditions de victoire</h2>
            <div class="stack">
              @for (item of items(); track $index; let i = $index) {
                @if (i > 0) {
                  <button class="op" (click)="toggleTopOp()">{{ topOp() === 'OR' ? 'OU' : 'ET' }}</button>
                }
                <div class="cond-block" [class.group]="item.conds.length > 1">
                  @for (c of item.conds; track $index; let j = $index) {
                    @if (j > 0) {
                      <button class="op inner" (click)="toggleGroupOp(i)">{{ item.op === 'OR' ? 'OU' : 'ET' }}</button>
                    }
                    <div class="row cond">
                      <select class="input" [ngModel]="c.condition" (ngModelChange)="setCond(i, j, $event)">
                        @for (opt of conditions; track opt.code) {
                          <option [value]="opt.code">{{ opt.label }}</option>
                        }
                      </select>
                      @if (needsThreshold(c.condition)) {
                        <span class="muted">≥</span>
                        <input class="input num" type="number" min="1" [ngModel]="c.threshold" (ngModelChange)="setThreshold(i, j, $event)" />
                      }
                      <span class="spacer"></span>
                      <button class="btn ghost small" title="Retirer" (click)="remove(i, j)">✕</button>
                    </div>
                  }
                  <button class="btn ghost small add-inner" (click)="addToGroup(i)">+ combiner avec…</button>
                </div>
              }
              <button class="btn ghost" (click)="addItem()">+ Ajouter une condition</button>
              @if (exprError()) {
                <div class="error-text">{{ exprError() }}</div>
              }
            </div>
          </section>
        </div>

        <aside>
          <div class="card cyan recap">
            <div class="kicker">Récapitulatif</div>
            <h3>{{ auth.user()?.displayName }} <span class="muted">vs</span> {{ opponentName() }}</h3>
            <dl>
              <dt>Format</dt><dd>BO{{ bestOf() }} <span class="muted">· {{ winsNeeded() }} victoire(s)</span></dd>
              <dt>Champion</dt><dd>{{ modeLabel[mode()] }}</dd>
              <dt>Sorts</dt><dd>{{ spellLabel[spellMode()] }}</dd>
            </dl>
            <p class="expr">{{ exprLabel() }}</p>
            @if (mode() === 'DECK') {
              <p class="muted small">Deck de {{ bestOf() + 3 }} champions minimum, puis 3 bans à l'aveugle.</p>
            }
            @if (spellMode() !== 'FREE') {
              <p class="muted small">{{ bestOf() * 2 }} jetons de sorts, 2 par manche.</p>
            }
            <p class="muted small">Abîme hurlant · 1v1 · Blind pick</p>
            @if (error()) {
              <div class="error-text">{{ error() }}</div>
            }
            <button class="btn primary big" (click)="send()" [disabled]="busy() || !!exprError() || !opponent.includes('#')">Envoyer le défi</button>
            <div class="save">
              <input class="input" placeholder="Nom de la config perso" maxlength="40" [(ngModel)]="presetName" name="presetName" (keydown.enter)="savePreset()" />
              <button class="btn" (click)="savePreset()" [disabled]="busy() || !!exprError() || !presetName.trim()">Enregistrer</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: `
    .gap { gap: 28px; }
    .step { color: var(--cyan); margin-right: 8px; }
    .grow { flex: 1; }
    .recent { margin-top: 10px; gap: 8px; }
    .recent .chip { cursor: pointer; text-transform: none; }
    .options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .small { font-size: 12px; }
    .cond-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
    .cond-block.group { border-color: rgba(255, 201, 77, 0.4); }
    .cond select { min-width: 200px; }
    .op { align-self: flex-start; padding: 4px 14px; border-radius: 8px; border: 1px solid rgba(255, 201, 77, 0.5); background: transparent; color: var(--yellow); font-family: var(--display); font-weight: 700; letter-spacing: 0.1em; cursor: pointer; }
    .op.inner { margin-left: 12px; }
    .add-inner { align-self: flex-start; color: var(--muted); }
    .recap { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 24px; }
    .recap h3 { font-size: 22px; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; }
    dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; align-self: center; }
    dd { margin: 0; font-family: var(--display); font-weight: 700; font-size: 17px; letter-spacing: 0.06em; }
    .save { display: flex; gap: 8px; }
    .save .input { flex: 1; }
    .expr { margin: 0; padding: 12px; border-radius: 10px; background: #0a0d13; font-weight: 600; }
    p { margin: 0; }
  `,
})
export class NewChallengePage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly bestOfs = [1, 3, 5, 7, 9, 11];
  protected readonly conditions = CONDITIONS;
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly needsThreshold = needsThreshold;

  /** Pré-rempli par « Revanche » (?opponent=Pseudo#TAG). */
  readonly opponentParam = input<string | undefined>(undefined, { alias: 'opponent' });
  /** Pré-configuration choisie sur l'accueil (?preset=id). */
  readonly presetParam = input<string | undefined>(undefined, { alias: 'preset' });
  private readonly lol = inject(LolService);
  protected readonly friends = signal<{ riotId: string }[]>([]);
  protected opponent = '';
  protected presetName = '';
  protected readonly recent = signal<{ userId: string; displayName: string; riotId: string }[]>([]);
  protected readonly bestOf = signal(5);
  protected readonly mode = signal<ChampionMode>('DECK');
  protected readonly spellMode = signal<SpellMode>('FREE');
  protected readonly topOp = signal<'AND' | 'OR'>('OR');
  protected readonly items = signal<Item[]>([
    { op: 'OR', conds: [{ condition: 'KILLS', threshold: 2 }] },
    { op: 'OR', conds: [{ condition: 'FIRST_TOWER', threshold: 1 }] },
  ]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly winsNeeded = computed(() => Math.ceil(this.bestOf() / 2));
  protected readonly expression = computed<WinNode | undefined>(() => {
    const nodes = this.items().map((item): WinNode => {
      const leaves = item.conds.map((c): WinNode => (needsThreshold(c.condition) ? { condition: c.condition, threshold: c.threshold } : { condition: c.condition }));
      return leaves.length === 1 ? leaves[0] : { op: item.op, children: leaves };
    });
    if (nodes.length === 0) return undefined;
    return nodes.length === 1 ? nodes[0] : { op: this.topOp(), children: nodes };
  });
  protected readonly exprError = computed(() => validate(this.expression()));
  protected readonly exprLabel = computed(() => {
    const e = this.expression();
    return e ? describe(e) : '—';
  });

  protected opponentName() {
    return this.opponent.split('#')[0] || '?';
  }

  async ngOnInit() {
    this.opponent = this.opponentParam() ?? '';
    const presetId = this.presetParam();
    if (presetId) {
      try {
        const { server, mine } = await this.api.presets();
        const preset = [...server, ...mine].find((x) => x.id === presetId);
        if (preset) this.apply(preset.config);
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }
    try {
      this.recent.set(await this.api.recentOpponents());
    } catch {
      /* facultatif */
    }
    void this.loadFriends();
  }

  /** Amis LoL ayant un compte sur l'app (nécessite le client LoL lancé). */
  private async loadFriends() {
    if (!this.lol.status().connected) return;
    try {
      const friends = await this.lol.friends();
      const registered = await this.api.lookupPlayers(friends.map((f) => f.puuid));
      this.friends.set(registered.map((r) => ({ riotId: r.riotId })));
    } catch {
      /* facultatif */
    }
  }

  /** Remplit le formulaire depuis une configuration (pré-config serveur ou perso). */
  private apply(config: SeriesConfig) {
    this.bestOf.set(config.bestOf);
    this.mode.set(config.championMode);
    this.spellMode.set(config.spellMode);
    const toCond = (n: WinNode): Cond => ({ condition: n.condition!, threshold: n.threshold ?? 1 });
    const expr = config.winExpression;
    if (expr.condition) {
      this.items.set([{ op: 'OR', conds: [toCond(expr)] }]);
      return;
    }
    this.topOp.set(expr.op ?? 'OR');
    this.items.set(
      (expr.children ?? []).map((child): Item =>
        child.condition
          ? { op: 'OR', conds: [toCond(child)] }
          : { op: child.op ?? 'AND', conds: (child.children ?? []).filter((c) => c.condition).map(toCond) },
      ),
    );
  }

  async savePreset() {
    const expr = this.expression();
    if (!expr) return;
    // window.prompt() n'existe pas dans Electron : le nom vient du champ du récapitulatif.
    const name = this.presetName.trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.createPreset(name, { bestOf: this.bestOf(), championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr });
      this.toast.success(`Config « ${name} » enregistrée : elle apparaît sur l'accueil.`);
      this.presetName = '';
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleTopOp() {
    this.topOp.update((o) => (o === 'OR' ? 'AND' : 'OR'));
  }

  protected toggleGroupOp(i: number) {
    this.items.update((list) => list.map((it, k) => (k === i ? { ...it, op: it.op === 'OR' ? 'AND' : 'OR' } : it)));
  }

  protected setCond(i: number, j: number, condition: ConditionCode) {
    this.patch(i, j, { condition, threshold: condition === 'CS' ? 50 : condition === 'KILLS' ? 2 : 1 });
  }

  protected setThreshold(i: number, j: number, value: number) {
    this.patch(i, j, { threshold: Number(value) });
  }

  protected addItem() {
    this.items.update((list) => [...list, { op: 'OR', conds: [{ condition: 'FIRST_BLOOD', threshold: 1 }] }]);
  }

  protected addToGroup(i: number) {
    this.items.update((list) =>
      list.map((it, k) => (k === i ? { op: it.conds.length === 1 ? (this.topOp() === 'OR' ? 'AND' : 'OR') : it.op, conds: [...it.conds, { condition: 'CS', threshold: 50 }] } : it)),
    );
  }

  protected remove(i: number, j: number) {
    this.items.update((list) =>
      list.map((it, k) => (k === i ? { ...it, conds: it.conds.filter((_, m) => m !== j) } : it)).filter((it) => it.conds.length > 0),
    );
  }

  private patch(i: number, j: number, change: Partial<Cond>) {
    this.items.update((list) => list.map((it, k) => (k === i ? { ...it, conds: it.conds.map((c, m) => (m === j ? { ...c, ...change } : c)) } : it)));
  }

  async send() {
    const expr = this.expression();
    if (!expr) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.invite(this.opponent.trim(), { bestOf: this.bestOf(), championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr });
      this.toast.success(`Défi envoyé à ${this.opponent}. Il expire dans 24 h.`);
      void this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
