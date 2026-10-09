import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { LolService } from '../core/lol.service';
import {
  ChampionMode,
  formatGameTime,
  MODE_LABELS,
  SeriesConfig,
  SpellMode,
  SPELL_MODE_LABELS,
} from '../core/models';
import { ToastService } from '../core/toast.service';
import { LabApiService } from './lab-api.service';
import { LabObjective, LabTier, ObjectiveTier, TIER_LABELS } from './lab.models';

/**
 * Labo : modes de jeu expérimentaux, à l'écart du flux « Nouveau défi ».
 * Premier mode : objectifs secrets.
 */
@Component({
  selector: 'app-lab',
  imports: [FormsModule],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker yellow">Expérimental</div>
          <h1>Labo</h1>
          <p>Modes de jeu en test. Ils peuvent changer, être rééquilibrés ou disparaître.</p>
        </div>
      </header>

      <div class="grid cols-main">
        <div class="stack gap">
          <section>
            <h2><span class="step">01</span> Mode</h2>
            <div class="options">
              <button class="option-card on">
                <strong>Objectifs secrets</strong>
                <span
                  >Chacun reçoit un objectif tiré dans le même palier, sans connaître celui de
                  l'adversaire. Le premier qui remplit le sien gagne la manche.</span
                >
              </button>
            </div>
            <ul class="rules muted small">
              <li>
                Objectif révélé au chargement de la partie, après le verrouillage des champions.
              </li>
              <li>
                Le même objectif peut tomber aux deux joueurs : impossible d'exclure une hypothèse.
              </li>
              <li>Pas de « premier X » : un objectif reste atteignable jusqu'au bout.</li>
              <li>
                Au temps limite, la meilleure progression l'emporte. Égalité : manche rejouée.
              </li>
              <li>L'objectif adverse est révélé à la fin de chaque manche.</li>
            </ul>
          </section>

          <section>
            <h2><span class="step">02</span> Adversaire</h2>
            <input class="input wide" placeholder="Pseudo#TAG" [(ngModel)]="opponent" name="opp" />
            @if (friends().length || recent().length) {
              <div class="row wrap recent">
                @for (r of suggestions(); track r) {
                  <button class="chip" [class.cyan]="opponent === r" (click)="opponent = r">
                    {{ r }}
                  </button>
                }
              </div>
            }
          </section>

          <section>
            <h2><span class="step">03</span> Format</h2>
            <div class="seg">
              @for (bo of bestOfs; track bo) {
                <button [class.on]="bestOf() === bo" (click)="bestOf.set(bo)">BO{{ bo }}</button>
              }
            </div>
            <div class="seg spaced">
              @for (m of championModes; track m) {
                <button [class.on]="mode() === m" (click)="mode.set(m)">{{ modeLabel[m] }}</button>
              }
            </div>
            <div class="seg spaced">
              @for (m of spellModes; track m) {
                <button [class.on]="spellMode() === m" (click)="spellMode.set(m)">
                  {{ spellLabel[m] }}
                </button>
              }
            </div>
          </section>

          <section>
            <h2><span class="step">04</span> Palier d'objectifs</h2>
            <div class="seg">
              @for (t of tierChoices; track t.value) {
                <button [class.on]="tier() === t.value" (click)="tier.set(t.value)">
                  {{ t.label }}
                </button>
              }
            </div>
            <p class="muted small">
              Tous les objectifs d'un palier visent la même durée de manche. « Aléatoire » tire un
              palier à chaque manche.
            </p>
            <div class="tiers">
              @for (t of catalog(); track t.tier) {
                <div class="card tier" [class.dim]="tier() !== null && tier() !== t.tier">
                  <div class="row">
                    <strong class="display">{{ tierLabel[t.tier] }}</strong
                    ><span class="spacer"></span
                    ><span class="muted small">limite {{ fmt(t.timeLimit) }}</span>
                  </div>
                  @for (o of t.objectives; track o.id) {
                    <div class="obj">
                      <span>{{ o.label }}</span
                      ><span class="muted small">≈ {{ o.estimatedMinutes }} min</span>
                    </div>
                  }
                </div>
              }
            </div>
          </section>

          <section>
            <h2><span class="step">05</span> Tirage d'essai</h2>
            <div class="row">
              <button class="btn" (click)="tryDraw()" [disabled]="busy()">Tirer une manche</button>
              @if (trial(); as d) {
                <div class="trial">
                  <span class="chip yellow">{{ tierLabel[d.tier] }}</span>
                  <span><span class="accent">Toi</span> {{ d.a.label }}</span>
                  <span><span class="danger">Adversaire</span> {{ d.b.label }}</span>
                </div>
              }
            </div>
          </section>
        </div>

        <aside>
          <div class="card cyan recap">
            <div class="kicker">Récapitulatif</div>
            <h3>
              {{ auth.user()?.displayName }} <span class="muted">vs</span>
              {{ opponent.split('#')[0] || '?' }}
            </h3>
            <dl>
              <dt>Mode</dt>
              <dd>Objectifs secrets</dd>
              <dt>Format</dt>
              <dd>BO{{ bestOf() }}</dd>
              <dt>Champion</dt>
              <dd>{{ modeLabel[mode()] }}</dd>
              <dt>Sorts</dt>
              <dd>{{ spellLabel[spellMode()] }}</dd>
              <dt>Palier</dt>
              <dd>{{ tier() ? tierLabel[tier()!] : 'Aléatoire' }}</dd>
            </dl>
            <p class="muted small">Abîme hurlant · 1v1 · Blind pick</p>
            @if (error()) {
              <div class="error-text">{{ error() }}</div>
            }
            <button
              class="btn primary big"
              (click)="send()"
              [disabled]="busy() || !opponent.includes('#')"
            >
              Envoyer le défi labo
            </button>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: `
    .gap {
      gap: 28px;
    }
    .step {
      color: var(--cyan);
      margin-right: 8px;
    }
    .small {
      font-size: 12px;
    }
    p {
      margin: 8px 0 0;
    }
    .options {
      display: grid;
      grid-template-columns: minmax(0, 420px);
    }
    .rules {
      margin: 12px 0 0;
      padding-left: 18px;
      line-height: 1.6;
    }
    .wide {
      width: 100%;
      max-width: 420px;
    }
    .recent {
      margin-top: 10px;
      gap: 8px;
    }
    .recent .chip {
      cursor: pointer;
      text-transform: none;
    }
    .spaced {
      margin-top: 10px;
      display: flex;
    }
    .tiers {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .tier {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: opacity 0.2s;
    }
    .tier.dim {
      opacity: 0.45;
    }
    .display {
      font-family: var(--display);
      letter-spacing: 0.08em;
    }
    .obj {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 14px;
    }
    .trial {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      font-weight: 600;
    }
    .recap {
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: sticky;
      top: 24px;
    }
    .recap h3 {
      font-size: 22px;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 16px;
      margin: 0;
    }
    dt {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      align-self: center;
    }
    dd {
      margin: 0;
      font-family: var(--display);
      font-weight: 700;
      font-size: 17px;
      letter-spacing: 0.06em;
    }
  `,
})
export class LabPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly labApi = inject(LabApiService);
  private readonly lol = inject(LolService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Pré-rempli par « Revanche » (?opponent=Pseudo#TAG). */
  readonly opponentParam = input<string | undefined>(undefined, { alias: 'opponent' });

  protected readonly bestOfs = [1, 3, 5, 7];
  protected readonly championModes: ChampionMode[] = ['MIRROR', 'RANDOM', 'DECK', 'MIRROR_DECK'];
  protected readonly spellModes: SpellMode[] = ['FREE', 'DECK_COMPOSED', 'DECK_RANDOM'];
  protected readonly tierChoices: { value: ObjectiveTier | null; label: string }[] = [
    { value: 'SHORT', label: 'Court' },
    { value: 'MEDIUM', label: 'Moyen' },
    { value: 'LONG', label: 'Long' },
    { value: null, label: 'Aléatoire' },
  ];
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly tierLabel = TIER_LABELS;
  protected readonly fmt = formatGameTime;

  protected opponent = '';
  protected readonly friends = signal<string[]>([]);
  protected readonly recent = signal<string[]>([]);
  protected readonly suggestions = computed(() => [
    ...new Set([...this.friends(), ...this.recent()]),
  ]);
  protected readonly bestOf = signal(3);
  protected readonly mode = signal<ChampionMode>('MIRROR');
  protected readonly spellMode = signal<SpellMode>('FREE');
  protected readonly tier = signal<ObjectiveTier | null>('MEDIUM');
  protected readonly catalog = signal<LabTier[]>([]);
  protected readonly trial = signal<{
    tier: ObjectiveTier;
    a: LabObjective;
    b: LabObjective;
  } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  async ngOnInit() {
    this.opponent = this.opponentParam() ?? '';
    try {
      this.catalog.set(await this.labApi.catalog());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    try {
      this.recent.set((await this.api.recentOpponents()).map((r) => r.riotId));
    } catch {
      /* facultatif */
    }
    if (this.lol.status().connected) {
      try {
        const friends = await this.lol.friends();
        this.friends.set(
          (await this.api.lookupPlayers(friends.map((f) => f.puuid))).map((r) => r.riotId),
        );
      } catch {
        /* facultatif */
      }
    }
  }

  async tryDraw() {
    try {
      this.trial.set(await this.labApi.draw(this.tier()));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async send() {
    this.busy.set(true);
    this.error.set('');
    const config: SeriesConfig = {
      bestOf: this.bestOf(),
      championMode: this.mode(),
      spellMode: this.spellMode(),
      lab: { mode: 'SECRET_OBJECTIVES', tier: this.tier() },
    };
    try {
      await this.api.invite(this.opponent.trim(), config);
      this.toast.success(`Défi labo envoyé à ${this.opponent}. Il expire dans 24 h.`);
      void this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
