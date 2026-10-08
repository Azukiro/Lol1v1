import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { LolService } from '../core/lol.service';
import { ChampionMode, MODE_LABELS, Preset, SeriesConfig, SpellMode, SPELL_MODE_LABELS } from '../core/models';
import { ToastService } from '../core/toast.service';
import { AvatarComponent } from '../shared/avatar.component';
import { SelectComponent, SelectOption } from '../shared/select.component';
import { ConditionCode, CS_STEP, describe, needsThreshold, validate, WinNode } from '../../shared/rules-engine';

interface Cond {
  condition: ConditionCode;
  threshold: number;
}
interface Item {
  op: 'AND' | 'OR';
  conds: Cond[]; // 1 condition = condition simple, plusieurs = groupe entre parenthèses
}

const CONDITIONS: { code: ConditionCode; label: string; hint: string }[] = [
  { code: 'KILLS', label: 'Kills', hint: 'Le premier à atteindre ce nombre de kills.' },
  { code: 'FIRST_BLOOD', label: 'First blood', hint: 'Le premier kill de la partie.' },
  { code: 'FIRST_TOWER', label: 'Première tour', hint: 'Le premier à détruire une tour.' },
  { code: 'CS', label: 'CS', hint: 'Le premier à atteindre ce nombre de minions.' },
];

const MODES: { id: ChampionMode; label: string; hint: string }[] = [
  { id: 'MIRROR', label: 'Miroir', hint: 'Le même champion pour les deux, tiré au sort.' },
  { id: 'RANDOM', label: 'Aléatoire', hint: 'Un champion différent chacun, tiré au sort.' },
  { id: 'DECK', label: 'Deck', hint: 'Chacun compose son deck, 3 bans, pick à l’aveugle.' },
];

const SPELL_MODES: { id: SpellMode; label: string; hint: string }[] = [
  { id: 'FREE', label: 'Libres', hint: 'Chacun prend les sorts qu’il veut.' },
  { id: 'DECK_COMPOSED', label: 'Deck composé', hint: 'Chacun choisit ses jetons de sorts, 2 utilisés par manche.' },
  { id: 'DECK_RANDOM', label: 'Deck aléatoire', hint: 'Les jetons de sorts sont tirés au sort.' },
];

interface Suggestion {
  riotId: string;
  iconId: number | null;
  source: 'Ami' | 'Récent';
}

@Component({
  selector: 'app-new-challenge',
  imports: [FormsModule, SelectComponent, AvatarComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker">Créer une série</div>
          <h1>Nouveau défi</h1>
        </div>
      </header>

      <div class="layout">
        <div class="form">
          @if (presets().length) {
            <section class="block">
              <div class="block-head">
                <h3>Partir d'une config</h3>
                <span class="muted small">Un clic remplit tout, ajuste ensuite si besoin.</span>
              </div>
              <div class="presets">
                @for (p of presets(); track p.id) {
                  <button class="preset" [class.on]="appliedPreset() === p.id" [class.mine]="!p.builtIn" (click)="usePreset(p)">
                    <strong>{{ p.name }}</strong>
                    <span class="muted small">BO{{ p.config.bestOf }} · {{ modeLabel[p.config.championMode] }}</span>
                  </button>
                }
              </div>
            </section>
          }

          <section class="block">
            <div class="block-head"><h3>Adversaire</h3></div>
            <input class="input opp-input" placeholder="Pseudo#TAG" [ngModel]="opponent()" (ngModelChange)="opponent.set($event)" name="opp" autocomplete="off" />
            @if (suggestions().length) {
              <div class="people">
                @for (p of suggestions(); track p.riotId) {
                  <button class="person" [class.on]="opponent() === p.riotId" (click)="opponent.set(p.riotId)">
                    <app-avatar class="avatar neutral" [iconId]="p.iconId" [name]="p.riotId" />
                    <span class="grow"><strong>{{ gameName(p.riotId) }}</strong><span class="muted">#{{ tagLine(p.riotId) }}</span></span>
                    <span class="tag">{{ p.source }}</span>
                  </button>
                }
              </div>
            }
          </section>

          <section class="block">
            <div class="block-head">
              <h3>Format</h3>
              <span class="muted small">Premier à {{ winsNeeded() }} victoire{{ winsNeeded() > 1 ? 's' : '' }}</span>
            </div>
            <div class="seg">
              @for (bo of bestOfs; track bo) {
                <button [class.on]="bestOf() === bo" (click)="edit(bestOf, bo)">BO{{ bo }}</button>
              }
            </div>
          </section>

          <section class="block">
            <div class="block-head"><h3>Champions</h3></div>
            <div class="choices">
              @for (m of modes; track m.id) {
                <button class="choice" [class.on]="mode() === m.id" (click)="edit(mode, m.id)">
                  <strong>{{ m.label }}</strong>
                  <span>{{ m.hint }}</span>
                </button>
              }
            </div>
          </section>

          <section class="block">
            <div class="block-head"><h3>Sorts d'invocateur</h3></div>
            <div class="seg">
              @for (m of spellModes; track m.id) {
                <button [class.on]="spellMode() === m.id" (click)="edit(spellMode, m.id)">{{ m.label }}</button>
              }
            </div>
            <p class="muted small hint">{{ spellHint() }} Sorts de l'Abîme hurlant uniquement.</p>
          </section>

          <section class="block">
            <div class="block-head">
              <h3>Pour gagner une manche</h3>
              @if (!advanced()) {
                <div class="seg small-seg">
                  <button [class.on]="topOp() === 'OR'" (click)="edit(topOp, 'OR')">Une suffit</button>
                  <button [class.on]="topOp() === 'AND'" (click)="edit(topOp, 'AND')">Toutes</button>
                </div>
              }
            </div>

            @if (!advanced()) {
              <div class="objectives">
                @for (c of conditions; track c.code) {
                  @let on = isActive(c.code);
                  <div class="objective" [class.on]="on">
                    <button class="switch" role="switch" [attr.aria-checked]="on" [attr.aria-label]="c.label" (click)="toggleCondition(c.code)"><i></i></button>
                    <div class="obj-label" (click)="toggleCondition(c.code)">
                      <strong>{{ c.label }}</strong>
                      <span class="muted small">{{ c.hint }}</span>
                    </div>
                    @if (range(c.code); as r) {
                      @let value = on ? threshold(c.code) : defaultThreshold(c.code);
                      <input class="slider" type="range" [min]="r.min" [max]="r.max" [step]="r.step" [value]="value"
                             [style.--fill]="((value - r.min) / (r.max - r.min)) * 100 + '%'" [attr.aria-label]="c.label + ' à atteindre'"
                             (input)="setValue(c.code, $any($event.target).valueAsNumber)" />
                      <span class="value">{{ value }}</span>
                    } @else {
                      <span class="slider-spacer"></span>
                      <span class="value">{{ on ? '✓' : '' }}</span>
                    }
                  </div>
                }
              </div>
              <button class="link" (click)="advanced.set(true)">Combinaisons avancées (ET / OU imbriqués)…</button>
            } @else {
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
                        <app-select [options]="condOptions(i, j)" [value]="c.condition" (valueChange)="setCond(i, j, $event)" />
                        @if (needsThreshold(c.condition)) {
                          <span class="muted">≥</span>
                          <input class="input num" type="number" [min]="stepOf(c.condition)" [step]="stepOf(c.condition)" [ngModel]="c.threshold" (ngModelChange)="setThreshold(i, j, $event)" />
                        }
                        <span class="spacer"></span>
                        <button class="btn ghost small" title="Retirer" (click)="remove(i, j)">✕</button>
                      </div>
                    }
                    @if (freeCode(groupCodes(i))) {
                      <button class="btn ghost small add-inner" (click)="addToGroup(i)">+ combiner avec…</button>
                    }
                  </div>
                }
                @if (freeCode(topCodes())) {
                  <button class="btn ghost" (click)="addItem()">+ Ajouter une condition</button>
                }
                @if (simpleCompatible()) {
                  <button class="link" (click)="advanced.set(false)">← Revenir au mode simple</button>
                }
              </div>
            }
          </section>
        </div>

        <aside>
          <div class="card cyan recap">
            <div class="kicker">Récapitulatif</div>
            <h3>{{ auth.user()?.displayName }} <span class="muted">vs</span> {{ opponentName() }}</h3>
            <ul class="summary">
              <li><span class="muted">Format</span><strong>BO{{ bestOf() }}</strong><span class="muted small">premier à {{ winsNeeded() }}</span></li>
              <li><span class="muted">Champions</span><strong>{{ modeLabel[mode()] }}</strong></li>
              <li><span class="muted">Sorts</span><strong>{{ spellLabel[spellMode()] }}</strong></li>
            </ul>
            <div class="win-rule">
              <span class="muted small">Une manche est gagnée par le premier qui remplit :</span>
              <strong>{{ exprLabel() }}</strong>
            </div>
            @if (mode() === 'DECK') {
              <p class="muted small">Deck de {{ bestOf() + 3 }} champions minimum, puis 3 bans à l'aveugle.</p>
            }
            @if (spellMode() !== 'FREE') {
              <p class="muted small">{{ bestOf() * 2 }} jetons de sorts, 2 par manche.</p>
            }
            @if (error()) {
              <div class="error-text">{{ error() }}</div>
            }
            <button class="btn primary big" (click)="send()" [disabled]="busy() || !!blocker()">Envoyer le défi</button>
            @if (blocker(); as b) {
              <span class="muted small center">{{ b }}</span>
            }
            @if (saving()) {
              <div class="save">
                <input class="input" placeholder="Nom de la config" maxlength="40" [(ngModel)]="presetName" name="presetName" (keydown.enter)="savePreset()" />
                <button class="btn" (click)="savePreset()" [disabled]="busy() || !!exprError() || !presetName.trim()">OK</button>
              </div>
            } @else {
              <button class="link center" (click)="saving.set(true)">Enregistrer ces réglages comme config</button>
            }
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; align-items: start; }
    .form { display: flex; flex-direction: column; gap: 14px; }
    .block { padding: 18px 20px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); }
    .block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .block-head h3 { font-size: 15px; letter-spacing: 0.12em; }
    .small { font-size: 12px; }
    .grow { flex: 1; min-width: 0; }
    .hint { margin: 10px 0 0; }
    p { margin: 0; }

    .presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 14px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .preset strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; }
    .preset:hover { border-color: #3a465c; }
    .preset.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .preset.mine.on { border-color: var(--yellow); background: rgba(255, 201, 77, 0.1); }

    .opp-input { width: 100%; font-size: 15px; }
    .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 12px; }
    .person { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .person:hover { border-color: #3a465c; }
    .person.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .person .avatar { width: 30px; height: 30px; border-radius: 8px; font-size: 13px; }
    .person .grow { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

    .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .choice { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .choice strong { font-family: var(--display); font-size: 17px; letter-spacing: 0.08em; text-transform: uppercase; }
    .choice span { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .choice:hover { border-color: #3a465c; }
    .choice.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .choice.on strong { color: var(--cyan); }

    .small-seg button { padding: 6px 12px; font-size: 13px; }

    .objectives { display: flex; flex-direction: column; gap: 6px; }
    .objective { display: grid; grid-template-columns: 44px minmax(180px, 260px) minmax(0, 1fr) 56px; align-items: center; gap: 16px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; transition: border-color 0.15s, background 0.15s; }
    .objective.on { border-color: rgba(255, 201, 77, 0.45); background: rgba(255, 201, 77, 0.06); }
    .obj-label { display: flex; flex-direction: column; gap: 2px; cursor: pointer; min-width: 0; }
    .obj-label strong { font-family: var(--display); font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; }
    .objective:not(.on) .obj-label strong { color: var(--muted); }

    .switch { position: relative; width: 40px; height: 22px; padding: 0; border-radius: 11px; border: 1px solid var(--line); background: var(--panel-2); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
    .switch i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: transform 0.15s, background 0.15s; }
    .objective.on .switch { background: var(--yellow); border-color: var(--yellow); }
    .objective.on .switch i { transform: translateX(18px); background: #1a1300; }
    .switch:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

    .slider { --fill: 0%; width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer; -webkit-appearance: none; appearance: none; }
    .slider::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--track-on, #3a465c) var(--fill), #232b3b var(--fill)); }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -6px; border-radius: 50%; border: 3px solid #0a0d13; background: var(--muted); box-shadow: 0 0 0 1px var(--line); transition: transform 0.1s; }
    .slider:hover::-webkit-slider-thumb { transform: scale(1.12); }
    .objective.on .slider { --track-on: var(--yellow); }
    .objective.on .slider::-webkit-slider-thumb { background: var(--yellow); box-shadow: 0 0 10px rgba(255, 201, 77, 0.5); }
    .slider:focus-visible { outline: none; }
    .slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--cyan); }
    .value { font-family: var(--display); font-weight: 700; font-size: 20px; text-align: right; color: var(--muted); }
    .objective.on .value { color: var(--yellow); }

    .link { margin-top: 12px; padding: 0; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
    .link:hover { color: var(--cyan); }
    .center { align-self: center; text-align: center; }

    .cond-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #0a0d13; }
    .cond-block.group { border-color: rgba(255, 201, 77, 0.4); }
    .op { align-self: flex-start; padding: 4px 14px; border-radius: 8px; border: 1px solid rgba(255, 201, 77, 0.5); background: transparent; color: var(--yellow); font-family: var(--display); font-weight: 700; letter-spacing: 0.1em; cursor: pointer; }
    .op.inner { margin-left: 12px; }
    .add-inner { align-self: flex-start; color: var(--muted); }

    .recap { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 24px; }
    .recap h3 { font-size: 22px; }
    .summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .summary li { display: grid; grid-template-columns: 90px auto 1fr; align-items: baseline; gap: 10px; }
    .summary li > span:first-child { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .summary strong { font-family: var(--display); font-size: 17px; letter-spacing: 0.06em; }
    .win-rule { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: #0a0d13; border: 1px solid rgba(255, 201, 77, 0.3); }
    .win-rule strong { color: var(--yellow); }
    .save { display: flex; gap: 8px; }
    .save .input { flex: 1; }

    @media (max-width: 1250px) {
      .objective { grid-template-columns: 44px minmax(0, 1fr) 56px; }
      .objective .slider, .objective .slider-spacer { grid-column: 2 / 3; }
      .objective .value { grid-row: 1; grid-column: 3; }
    }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .recap { position: static; }
      .choices { grid-template-columns: 1fr; }
    }
  `,
})
export class NewChallengePage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lol = inject(LolService);

  protected readonly bestOfs = [1, 3, 5, 7, 9, 11];
  protected readonly conditions = CONDITIONS;
  protected readonly modes = MODES;
  protected readonly spellModes = SPELL_MODES;
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly needsThreshold = needsThreshold;

  /** Pré-rempli par « Revanche » (?opponent=Pseudo#TAG). */
  readonly opponentParam = input<string | undefined>(undefined, { alias: 'opponent' });
  /** Pré-configuration choisie sur l'accueil (?preset=id). */
  readonly presetParam = input<string | undefined>(undefined, { alias: 'preset' });

  protected readonly presets = signal<Preset[]>([]);
  protected readonly appliedPreset = signal<string | null>(null);
  protected readonly friends = signal<Suggestion[]>([]);
  protected readonly recent = signal<Suggestion[]>([]);
  protected readonly opponent = signal('');
  protected presetName = '';
  protected readonly saving = signal(false);
  protected readonly bestOf = signal(5);
  protected readonly mode = signal<ChampionMode>('DECK');
  protected readonly spellMode = signal<SpellMode>('FREE');
  protected readonly topOp = signal<'AND' | 'OR'>('OR');
  protected readonly items = signal<Item[]>([
    { op: 'OR', conds: [{ condition: 'KILLS', threshold: 2 }] },
    { op: 'OR', conds: [{ condition: 'FIRST_TOWER', threshold: 1 }] },
  ]);
  /** Éditeur avancé (groupes ET / OU imbriqués). */
  protected readonly advanced = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly winsNeeded = computed(() => Math.ceil(this.bestOf() / 2));
  protected readonly spellHint = computed(() => SPELL_MODES.find((m) => m.id === this.spellMode())?.hint ?? '');
  /** Amis puis adversaires récents, sans doublon. */
  protected readonly suggestions = computed(() => {
    const seen = new Set<string>();
    return [...this.friends(), ...this.recent()].filter((s) => !seen.has(s.riotId) && !!seen.add(s.riotId)).slice(0, 8);
  });
  /** L'éditeur simple ne sait représenter que des conditions à plat (une seule opération). */
  protected readonly simpleCompatible = computed(() => this.items().every((it) => it.conds.length === 1));

  protected readonly expression = computed<WinNode | undefined>(() => {
    const nodes = this.items().map((item): WinNode => {
      const leaves = item.conds.map((c): WinNode => (needsThreshold(c.condition) ? { condition: c.condition, threshold: c.threshold } : { condition: c.condition }));
      return leaves.length === 1 ? leaves[0] : { op: item.op, children: leaves };
    });
    if (nodes.length === 0) return undefined;
    return nodes.length === 1 ? nodes[0] : { op: this.topOp(), children: nodes };
  });
  protected readonly exprError = computed(() => (this.items().length ? validate(this.expression()) : 'Choisis au moins une condition de victoire.'));
  protected readonly exprLabel = computed(() => {
    const e = this.expression();
    return e ? describe(e) : '—';
  });
  /** Raison pour laquelle le défi ne peut pas encore partir. */
  protected readonly blocker = computed(() => {
    if (!this.opponent().includes('#')) return 'Choisis un adversaire (Pseudo#TAG).';
    return this.exprError();
  });

  protected opponentName() {
    return this.opponent().split('#')[0] || '?';
  }

  protected gameName(riotId: string) {
    return riotId.split('#')[0];
  }

  protected tagLine(riotId: string) {
    return riotId.split('#')[1] ?? '';
  }

  async ngOnInit() {
    this.opponent.set(this.opponentParam() ?? '');
    try {
      const { server, mine } = await this.api.presets();
      this.presets.set([...server, ...mine]);
      const preset = this.presets().find((x) => x.id === this.presetParam());
      if (preset) this.usePreset(preset);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    try {
      const recent = await this.api.recentOpponents();
      this.recent.set(recent.map((r) => ({ riotId: r.riotId, iconId: null, source: 'Récent' })));
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
      this.friends.set(registered.map((r) => ({ riotId: r.riotId, iconId: r.profileIconId, source: 'Ami' })));
    } catch {
      /* facultatif */
    }
  }

  protected usePreset(p: Preset) {
    this.apply(p.config);
    this.appliedPreset.set(p.id);
  }

  /** Modification manuelle : la config de départ n'est plus appliquée telle quelle. */
  protected edit<T>(target: { set(value: T): void }, value: T) {
    target.set(value);
    this.appliedPreset.set(null);
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
    } else {
      this.topOp.set(expr.op ?? 'OR');
      this.items.set(
        (expr.children ?? []).map((child): Item =>
          child.condition
            ? { op: 'OR', conds: [toCond(child)] }
            : { op: child.op ?? 'AND', conds: (child.children ?? []).filter((c) => c.condition).map(toCond) },
        ),
      );
    }
    this.advanced.set(!this.simpleCompatible());
  }

  // ---------------------------------------------------------------------
  // Éditeur simple : une carte par condition, toutes reliées par la même opération.
  // ---------------------------------------------------------------------

  protected isActive(code: ConditionCode) {
    return this.items().some((it) => it.conds[0].condition === code);
  }

  protected threshold(code: ConditionCode) {
    return this.items().find((it) => it.conds[0].condition === code)?.conds[0].threshold ?? 0;
  }

  protected stepOf(code: ConditionCode) {
    return code === 'CS' ? CS_STEP : 1;
  }

  /** Plage du curseur (null : condition sans seuil). */
  protected range(code: ConditionCode) {
    if (code === 'KILLS') return { min: 1, max: 10, step: 1 };
    if (code === 'CS') return { min: CS_STEP, max: 300, step: CS_STEP };
    return null;
  }

  protected defaultThreshold(code: ConditionCode) {
    return this.cond(code).threshold;
  }

  /** Bouger le curseur d'un objectif inactif l'active avec cette valeur. */
  protected setValue(code: ConditionCode, value: number) {
    if (!this.isActive(code)) this.toggleCondition(code);
    this.appliedPreset.set(null);
    this.items.update((list) => list.map((it) => (it.conds[0].condition === code ? { ...it, conds: [{ ...it.conds[0], threshold: value }] } : it)));
  }

  protected toggleCondition(code: ConditionCode) {
    this.appliedPreset.set(null);
    if (this.isActive(code)) {
      this.items.update((list) => list.filter((it) => it.conds[0].condition !== code));
      return;
    }
    // Garde l'ordre du catalogue pour un libellé stable.
    const order = (c: ConditionCode) => CONDITIONS.findIndex((x) => x.code === c);
    this.items.update((list) => [...list, { op: 'OR' as const, conds: [this.cond(code)] }].sort((a, b) => order(a.conds[0].condition) - order(b.conds[0].condition)));
  }

  // ---------------------------------------------------------------------
  // Éditeur avancé
  // ---------------------------------------------------------------------

  protected toggleTopOp() {
    this.edit(this.topOp, this.topOp() === 'OR' ? 'AND' : 'OR');
  }

  protected toggleGroupOp(i: number) {
    this.appliedPreset.set(null);
    this.items.update((list) => list.map((it, k) => (k === i ? { ...it, op: it.op === 'OR' ? 'AND' : 'OR' } : it)));
  }

  protected setCond(i: number, j: number, condition: ConditionCode) {
    this.patch(i, j, this.cond(condition));
  }

  protected setThreshold(i: number, j: number, value: number) {
    this.patch(i, j, { threshold: Number(value) });
  }

  /** Conditions des blocs simples, frères directs dans l'expression racine. */
  protected readonly topCodes = computed(() => new Set(this.items().filter((it) => it.conds.length === 1).map((it) => it.conds[0].condition)));

  protected groupCodes(i: number): Set<ConditionCode> {
    return new Set(this.items()[i]?.conds.map((c) => c.condition));
  }

  /** Conditions déjà prises par les frères de (i, j) : une même condition deux fois au même niveau n'a pas de sens. */
  protected takenBySiblings(i: number, j: number): Set<ConditionCode> {
    const item = this.items()[i];
    const own = item.conds[j].condition;
    const taken = item.conds.length === 1 ? new Set(this.topCodes()) : new Set(item.conds.filter((_, m) => m !== j).map((c) => c.condition));
    taken.delete(own);
    return taken;
  }

  protected condOptions(i: number, j: number): SelectOption<ConditionCode>[] {
    const taken = this.takenBySiblings(i, j);
    return this.conditions.map((c) => ({ value: c.code, label: c.label, disabled: taken.has(c.code) }));
  }

  protected freeCode(taken: Set<ConditionCode>): ConditionCode | undefined {
    return this.conditions.find((c) => !taken.has(c.code))?.code;
  }

  private cond(condition: ConditionCode): Cond {
    return { condition, threshold: condition === 'CS' ? 50 : condition === 'KILLS' ? 2 : 1 };
  }

  protected addItem() {
    const code = this.freeCode(this.topCodes());
    if (!code) return;
    this.appliedPreset.set(null);
    this.items.update((list) => [...list, { op: 'OR', conds: [this.cond(code)] }]);
  }

  protected addToGroup(i: number) {
    const code = this.freeCode(this.groupCodes(i));
    if (!code) return;
    this.appliedPreset.set(null);
    this.items.update((list) =>
      list.map((it, k) => (k === i ? { op: it.conds.length === 1 ? (this.topOp() === 'OR' ? 'AND' : 'OR') : it.op, conds: [...it.conds, this.cond(code)] } : it)),
    );
  }

  protected remove(i: number, j: number) {
    this.appliedPreset.set(null);
    this.items.update((list) =>
      list.map((it, k) => (k === i ? { ...it, conds: it.conds.filter((_, m) => m !== j) } : it)).filter((it) => it.conds.length > 0),
    );
  }

  private patch(i: number, j: number, change: Partial<Cond>) {
    this.appliedPreset.set(null);
    this.items.update((list) => list.map((it, k) => (k === i ? { ...it, conds: it.conds.map((c, m) => (m === j ? { ...c, ...change } : c)) } : it)));
  }

  // ---------------------------------------------------------------------

  async savePreset() {
    const expr = this.expression();
    // window.prompt() n'existe pas dans Electron : le nom vient du champ du récapitulatif.
    const name = this.presetName.trim();
    if (!expr || !name || this.busy()) return;
    this.busy.set(true);
    try {
      const preset = await this.api.createPreset(name, { bestOf: this.bestOf(), championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr });
      this.toast.success(`Config « ${name} » enregistrée : elle apparaît sur l'accueil.`);
      this.presets.update((list) => [...list, preset]);
      this.appliedPreset.set(preset.id);
      this.presetName = '';
      this.saving.set(false);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async send() {
    const expr = this.expression();
    if (!expr || this.blocker()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.invite(this.opponent().trim(), { bestOf: this.bestOf(), championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr });
      this.toast.success(`Défi envoyé à ${this.opponent()}. Il expire dans 24 h.`);
      void this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
