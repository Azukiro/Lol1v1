import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { OpponentsService, OpponentSuggestion } from '../core/opponents.service';
import { ChampionMode, MODE_LABELS, Preset, PresetConfig, SpellMode, SPELL_MODE_LABELS } from '../core/models';
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
  { code: 'FIRST_TOWER', label: 'Première tour', hint: 'Le premier à détruire une tour.' },
  { code: 'CS', label: 'CS', hint: 'Le premier à atteindre ce nombre de minions.' },
];

/** Rôles du 2v2, dans l'ordre de saisie. */
type TeamRole = 'teammate' | 'opponent' | 'opponent2';
const TEAM_ROLES: { id: TeamRole; label: string }[] = [
  { id: 'teammate', label: 'Coéquipier' },
  { id: 'opponent', label: 'Adversaire 1' },
  { id: 'opponent2', label: 'Adversaire 2' },
];

/** Modes jouables en 2v2 (les decks et bans restent des duels). */
const TEAM_MODES: ChampionMode[] = ['MIRROR', 'RANDOM'];
const TEAM_HINTS: Partial<Record<ChampionMode, string>> = {
  MIRROR: 'Deux champions tirés au sort : chaque équipe joue la même paire.',
  RANDOM: 'Un champion différent pour chacun des 4, tiré au sort.',
};

const MODES: { id: ChampionMode; label: string; hint: string }[] = [
  { id: 'MIRROR', label: 'Miroir', hint: 'Le même champion pour les deux, tiré au sort.' },
  { id: 'RANDOM', label: 'Aléatoire', hint: 'Un champion différent chacun, tiré au sort.' },
  { id: 'DECK', label: 'Deck', hint: 'Chacun compose son deck, 3 bans, pick à l’aveugle.' },
  { id: 'MIRROR_DECK', label: 'Deck miroir', hint: 'Chacun met quelques champions dans le pot, chaque manche en tire un pour les deux.' },
];

const SPELL_MODES: { id: SpellMode; label: string; hint: string }[] = [
  { id: 'FREE', label: 'Libres', hint: 'Chacun prend les sorts qu’il veut.' },
  { id: 'DECK_COMPOSED', label: 'Deck composé', hint: 'Chacun choisit ses jetons de sorts, 2 utilisés par manche.' },
  { id: 'DECK_RANDOM', label: 'Deck aléatoire', hint: 'Les jetons de sorts sont tirés au sort.' },
];

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
                    <span class="muted small">{{ modeLabel[p.config.championMode] }} · {{ spellLabel[p.config.spellMode] }}</span>
                  </button>
                }
              </div>
            </section>
          }

          <section class="block">
            <div class="block-head">
              <h3>{{ teamSize() > 1 ? 'Joueurs' : 'Adversaire' }}</h3>
              <div class="seg" role="radiogroup" aria-label="Mode de jeu">
                <button role="radio" [attr.aria-checked]="teamSize() === 1" [class.on]="teamSize() === 1" (click)="setTeamSize(1)">1v1</button>
                <button role="radio" [attr.aria-checked]="teamSize() === 2" [class.on]="teamSize() === 2" (click)="setTeamSize(2)">2v2</button>
              </div>
            </div>
            @if (teamSize() > 1) {
              <div class="team-fields">
                @for (r of teamRoles; track r.id) {
                  <label class="team-field" [class.active]="activeRole() === r.id" [class.mate]="r.id === 'teammate'">
                    <span class="kicker">{{ r.label }}</span>
                    <input class="input" placeholder="Pseudo#TAG" [ngModel]="roleValue(r.id)" (ngModelChange)="setRole(r.id, $event)" (focus)="activeRole.set(r.id)"
                      [name]="r.id" autocomplete="off" />
                  </label>
                }
              </div>
              <p class="muted small hint">Toi et ton coéquipier contre les deux adversaires. La série démarre quand les trois ont accepté.</p>
            } @else {
              <input class="input opp-input" placeholder="Pseudo#TAG" [ngModel]="opponent()" (ngModelChange)="opponent.set($event)" name="opp" autocomplete="off" />
            }
            @if (suggestions().length) {
              <div class="people">
                @for (p of suggestions(); track p.riotId) {
                  <button class="person" [class.on]="isChosen(p.riotId)" (click)="choose(p.riotId)">
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
                <button class="choice" [class.on]="mode() === m.id" [disabled]="!modeAllowed(m.id)" (click)="edit(mode, m.id)">
                  <strong>{{ m.label }}</strong>
                  <span>{{ modeAllowed(m.id) ? modeHint(m) : '1v1 uniquement.' }}</span>
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
              <span class="muted small">Clique sur OU / ET pour changer le lien entre deux conditions.</span>
            </div>
            @if (teamSize() > 1) {
              <p class="muted small team-note">En 2v2, tout compte par équipe : kills et tours de chacun, CS des deux joueurs cumulés.</p>
            }
            <div class="stack">
              @for (item of items(); track $index; let i = $index) {
                @if (i > 0) {
                  <div class="op-switch" role="radiogroup" aria-label="Lien entre les conditions">
                    <button role="radio" [attr.aria-checked]="topOp() === 'OR'" [class.on]="topOp() === 'OR'" (click)="setTopOp('OR')">OU</button>
                    <button role="radio" [attr.aria-checked]="topOp() === 'AND'" [class.on]="topOp() === 'AND'" (click)="setTopOp('AND')">ET</button>
                    <span class="muted small">{{ topOp() === 'OR' ? 'une seule suffit' : 'toutes sont requises' }}</span>
                  </div>
                }
                <div class="cond-block" [class.group]="item.conds.length > 1">
                  @for (c of item.conds; track $index; let j = $index) {
                    @if (j > 0) {
                      <div class="op-switch inner" role="radiogroup" aria-label="Lien dans le groupe">
                        <button role="radio" [attr.aria-checked]="item.op === 'OR'" [class.on]="item.op === 'OR'" (click)="setGroupOp(i, 'OR')">OU</button>
                        <button role="radio" [attr.aria-checked]="item.op === 'AND'" [class.on]="item.op === 'AND'" (click)="setGroupOp(i, 'AND')">ET</button>
                      </div>
                    }
                    <div class="row cond">
                      <app-select [options]="condOptions(i, j)" [value]="c.condition" (valueChange)="setCond(i, j, $event)" />
                      @if (needsThreshold(c.condition)) {
                        <span class="muted">≥</span>
                        <input class="input num" type="number" [min]="stepOf(c.condition)" [step]="stepOf(c.condition)" [ngModel]="c.threshold" (ngModelChange)="setThreshold(i, j, $event)" />
                        @if (c.condition === 'CS') {
                          <span class="muted small">par dizaines</span>
                        }
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
              @if (items().length && exprError(); as err) {
                <div class="error-text">{{ err }}</div>
              }
            </div>
          </section>
        </div>

        <aside>
          <div class="card cyan recap">
            <div class="kicker">Récapitulatif</div>
            <h3>{{ myTeamName() }} <span class="muted">vs</span> {{ opponentName() }}</h3>
            <ul class="summary">
              <li><span class="muted">Format</span><strong>{{ teamSize() > 1 ? '2v2 · ' : '' }}BO{{ bestOf() }}</strong><span class="muted small">premier à {{ winsNeeded() }}</span></li>
              <li><span class="muted">Champions</span><strong>{{ modeLabel[mode()] }}</strong></li>
              <li><span class="muted">Sorts</span><strong>{{ spellLabel[spellMode()] }}</strong></li>
            </ul>
            <div class="win-rule">
              <span class="muted small">Une manche est gagnée par {{ teamSize() > 1 ? 'la première équipe qui remplit' : 'le premier qui remplit' }} :</span>
              <strong>{{ exprLabel() }}</strong>
            </div>
            @if (mode() === 'DECK') {
              <p class="muted small">Deck de {{ bestOf() + 3 }} champions minimum, puis 3 bans à l'aveugle.</p>
            }
            @if (mode() === 'MIRROR_DECK') {
              <p class="muted small">{{ winsNeeded() }} champion{{ winsNeeded() > 1 ? 's' : '' }} chacun, tirés au sort à chaque manche et joués par les deux.</p>
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
    .team-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .team-field { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; transition: border-color 0.15s; }
    .team-field .kicker { color: var(--pink); }
    .team-field.mate .kicker { color: var(--cyan); }
    .team-field.active { border-color: #3a465c; }
    .team-field .input { width: 100%; }
    .team-note { margin: -4px 0 12px; }
    .choice:disabled { opacity: 0.45; cursor: not-allowed; }
    .choice:disabled:hover { border-color: var(--line); }
    .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 12px; }
    .person { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .person:hover { border-color: #3a465c; }
    .person.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .person .avatar { width: 30px; height: 30px; border-radius: 8px; font-size: 13px; }
    .person .grow { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

    .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .choice { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .choice strong { font-family: var(--display); font-size: 17px; letter-spacing: 0.08em; text-transform: uppercase; }
    .choice span { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .choice:hover { border-color: #3a465c; }
    .choice.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .choice.on strong { color: var(--cyan); }



    .link { padding: 0; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
    .link:hover { color: var(--cyan); }
    .center { align-self: center; text-align: center; }

    .cond-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #0a0d13; }
    .cond-block.group { border-color: rgba(255, 201, 77, 0.4); }
    .op-switch { display: inline-flex; align-items: center; align-self: flex-start; }
    .op-switch button { padding: 5px 14px; border: 1px solid rgba(255, 201, 77, 0.35); background: transparent; color: var(--muted); font-family: var(--display); font-weight: 700; letter-spacing: 0.1em; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
    .op-switch button:first-child { border-radius: 8px 0 0 8px; }
    .op-switch button:nth-child(2) { border-radius: 0 8px 8px 0; border-left: none; }
    .op-switch button:hover:not(.on) { color: var(--text); border-color: rgba(255, 201, 77, 0.6); }
    .op-switch button.on { background: var(--yellow); border-color: var(--yellow); color: #1a1300; }
    .op-switch span { margin-left: 10px; }
    .op-switch.inner { margin-left: 12px; }
    .add-inner { align-self: flex-start; color: var(--muted); }

    aside { position: sticky; top: 24px; align-self: start; }
    .recap { display: flex; flex-direction: column; gap: 14px; }
    .recap h3 { font-size: 22px; }
    .summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .summary li { display: grid; grid-template-columns: 90px auto 1fr; align-items: baseline; gap: 10px; }
    .summary li > span:first-child { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .summary strong { font-family: var(--display); font-size: 17px; letter-spacing: 0.06em; }
    .win-rule { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: #0a0d13; border: 1px solid rgba(255, 201, 77, 0.3); }
    .win-rule strong { color: var(--yellow); }
    .save { display: flex; gap: 8px; }
    .save .input { flex: 1; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      aside { position: static; }
      .choices { grid-template-columns: 1fr; }
      .team-fields { grid-template-columns: 1fr; }
    }
  `,
})
export class NewChallengePage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly opponents = inject(OpponentsService);

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
  /** Format choisi au lancement rapide (?bo=5). */
  readonly bestOfParam = input<string | undefined>(undefined, { alias: 'bo' });
  /** Revanche 2v2 : ?format=2v2&teammate=…&opponent=…&opponent2=…. */
  readonly formatParam = input<string | undefined>(undefined, { alias: 'format' });
  readonly teammateParam = input<string | undefined>(undefined, { alias: 'teammate' });
  readonly opponent2Param = input<string | undefined>(undefined, { alias: 'opponent2' });

  protected readonly teamRoles = TEAM_ROLES;
  /** Joueurs par équipe : 1 (1v1) ou 2 (2v2). */
  protected readonly teamSize = signal(1);
  protected readonly teammate = signal('');
  protected readonly opponent2 = signal('');
  /** 2v2 : champ que remplit un clic sur une suggestion. */
  protected readonly activeRole = signal<TeamRole>('teammate');

  protected readonly presets = signal<Preset[]>([]);
  protected readonly appliedPreset = signal<string | null>(null);
  /** Amis puis adversaires récents, sans doublon. */
  protected readonly suggestions = signal<OpponentSuggestion[]>([]);
  protected readonly opponent = signal('');
  protected presetName = '';
  protected readonly saving = signal(false);
  protected readonly bestOf = signal(5);
  protected readonly mode = signal<ChampionMode>('DECK');
  protected readonly spellMode = signal<SpellMode>('FREE');
  protected readonly topOp = signal<'AND' | 'OR'>('OR');
  protected readonly items = signal<Item[]>([
    { op: 'OR', conds: [{ condition: 'KILLS', threshold: 1 }] },
    { op: 'OR', conds: [{ condition: 'FIRST_TOWER', threshold: 1 }] },
  ]);

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly winsNeeded = computed(() => Math.ceil(this.bestOf() / 2));
  protected readonly spellHint = computed(() => SPELL_MODES.find((m) => m.id === this.spellMode())?.hint ?? '');


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
    if (this.teamSize() > 1) {
      const ids = [this.teammate(), this.opponent(), this.opponent2()].map((x) => x.trim());
      if (!this.teammate().includes('#')) return 'Choisis ton coéquipier (Pseudo#TAG).';
      if (!this.opponent().includes('#') || !this.opponent2().includes('#')) return 'Choisis deux adversaires (Pseudo#TAG).';
      if (new Set(ids.map((x) => x.toLowerCase())).size !== 3) return 'Trois joueurs différents.';
      if (!this.modeAllowed(this.mode())) return 'En 2v2 : mode Miroir ou Aléatoire.';
    } else if (!this.opponent().includes('#')) return 'Choisis un adversaire (Pseudo#TAG).';
    return this.exprError();
  });

  protected opponentName() {
    const name = (id: string) => id.split('#')[0] || '?';
    return this.teamSize() > 1 ? `${name(this.opponent())} & ${name(this.opponent2())}` : name(this.opponent());
  }

  protected myTeamName() {
    const me = this.auth.user()?.displayName ?? '';
    return this.teamSize() > 1 ? `${me} & ${this.teammate().split('#')[0] || '?'}` : me;
  }

  protected modeAllowed(mode: ChampionMode) {
    return this.teamSize() === 1 || TEAM_MODES.includes(mode);
  }

  protected modeHint(m: { id: ChampionMode; hint: string }) {
    return (this.teamSize() > 1 && TEAM_HINTS[m.id]) || m.hint;
  }

  protected setTeamSize(size: number) {
    this.teamSize.set(size);
    if (!this.modeAllowed(this.mode())) this.edit(this.mode, 'MIRROR');
  }

  private roleSignal(role: TeamRole) {
    return role === 'teammate' ? this.teammate : role === 'opponent' ? this.opponent : this.opponent2;
  }

  protected roleValue(role: TeamRole) {
    return this.roleSignal(role)();
  }

  protected setRole(role: TeamRole, value: string) {
    this.roleSignal(role).set(value);
  }

  protected isChosen(riotId: string) {
    return this.teamSize() > 1 ? TEAM_ROLES.some((r) => this.roleValue(r.id) === riotId) : this.opponent() === riotId;
  }

  /** Suggestion cliquée : en 2v2, remplit le champ actif puis passe au suivant encore vide. */
  protected choose(riotId: string) {
    if (this.teamSize() === 1) {
      this.opponent.set(riotId);
      return;
    }
    const current = TEAM_ROLES.find((r) => this.roleValue(r.id) === riotId);
    if (current) {
      this.setRole(current.id, '');
      this.activeRole.set(current.id);
      return;
    }
    this.setRole(this.activeRole(), riotId);
    const next = TEAM_ROLES.find((r) => !this.roleValue(r.id));
    if (next) this.activeRole.set(next.id);
  }

  protected gameName(riotId: string) {
    return riotId.split('#')[0];
  }

  protected tagLine(riotId: string) {
    return riotId.split('#')[1] ?? '';
  }

  async ngOnInit() {
    this.opponent.set(this.opponentParam() ?? '');
    if (this.formatParam() === '2v2') {
      this.setTeamSize(2);
      this.teammate.set(this.teammateParam() ?? '');
      this.opponent2.set(this.opponent2Param() ?? '');
    }
    const bo = Number(this.bestOfParam());
    if (this.bestOfs.includes(bo)) this.bestOf.set(bo);
    try {
      const { server, mine } = await this.api.presets();
      this.presets.set([...server, ...mine]);
      const preset = this.presets().find((x) => x.id === this.presetParam());
      if (preset) this.usePreset(preset);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    this.suggestions.set(await this.opponents.suggestions());
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

  /** Remplit le formulaire depuis une config prête (le format reste celui choisi). */
  private apply(config: PresetConfig) {
    this.mode.set(config.championMode);
    this.spellMode.set(config.spellMode);
    const toCond = (n: WinNode): Cond => ({ condition: n.condition!, threshold: n.threshold ?? 1 });
    const expr = config.winExpression;
    if (!expr) return;
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

  }


  protected stepOf(code: ConditionCode) {
    return code === 'CS' ? CS_STEP : 1;
  }

  protected setTopOp(op: 'AND' | 'OR') {
    this.edit(this.topOp, op);
  }

  protected setGroupOp(i: number, op: 'AND' | 'OR') {
    this.appliedPreset.set(null);
    this.items.update((list) => list.map((it, k) => (k === i ? { ...it, op } : it)));
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

  /**
   * Conditions déjà prises au même niveau que (i, j) : deux fois la même côte à côte, l'une rend l'autre inutile.
   * Les cas plus subtils (« Tour OU (Kills ET Tour) ») sont signalés par la validation de la règle.
   */
  protected condOptions(i: number, j: number): SelectOption<ConditionCode>[] {
    const item = this.items()[i];
    const own = item.conds[j].condition;
    const taken = item.conds.length === 1 ? this.topCodes() : this.groupCodes(i);
    const options = this.conditions.map((c) => ({ value: c.code, label: c.label, disabled: c.code !== own && taken.has(c.code) }));
    // First blood n'est plus proposé (= Kills ≥ 1), mais reste lisible dans une ancienne config.
    return own === 'FIRST_BLOOD' ? [{ value: own, label: 'First blood' }, ...options] : options;
  }

  protected freeCode(taken: Set<ConditionCode>): ConditionCode | undefined {
    return this.conditions.find((c) => !taken.has(c.code))?.code;
  }

  private cond(condition: ConditionCode): Cond {
    return { condition, threshold: condition === 'CS' ? 50 : 1 };
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
      const preset = await this.api.createPreset(name, { championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr });
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
      const config = { bestOf: this.bestOf(), championMode: this.mode(), spellMode: this.spellMode(), winExpression: expr };
      if (this.teamSize() > 1) {
        await this.api.inviteTeams(this.teammate().trim(), [this.opponent().trim(), this.opponent2().trim()], config);
        this.toast.success(`Défi 2v2 envoyé aux trois joueurs. Il démarre quand tous ont accepté (expire dans 24 h).`);
      } else {
        await this.api.invite(this.opponent().trim(), config);
        this.toast.success(`Défi envoyé à ${this.opponent()}. Il expire dans 24 h.`);
      }
      void this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
