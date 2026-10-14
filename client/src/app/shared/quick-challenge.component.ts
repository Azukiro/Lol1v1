import { afterRenderEffect, Component, computed, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { MODE_LABELS, Preset, SPELL_MODE_LABELS } from '../core/models';
import { OpponentsService, OpponentSuggestion } from '../core/opponents.service';
import { ToastService } from '../core/toast.service';
import { AvatarComponent } from './avatar.component';
import { describe } from '../../shared/rules-engine';

/** Lancement d'une config prête : il ne reste qu'à choisir l'adversaire et le format. */
@Component({
  selector: 'app-quick-challenge',
  imports: [FormsModule, AvatarComponent],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    @let p = preset();
    <div class="backdrop" (click)="closed.emit()">
      <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="'Lancer ' + p.name" (click)="$event.stopPropagation()">
        <header>
          <div class="kicker">{{ p.builtIn ? 'Config prête' : 'Ta config' }}</div>
          <h2>{{ p.name }}</h2>
          <div class="row wrap chips">
            <span class="chip">{{ modeLabel[p.config.championMode] }}</span>
            <span class="chip">{{ spellLabel[p.config.spellMode] }}</span>
            <span class="rule">{{ rule() }}</span>
          </div>
        </header>

        <section>
          <h3>Adversaire</h3>
          <input #opp class="input" placeholder="Pseudo#TAG" [ngModel]="opponent()" (ngModelChange)="opponent.set($event)" name="opp" autocomplete="off" (keydown.enter)="send()" />
          @if (suggestions().length) {
            <div class="people">
              @for (s of suggestions(); track s.riotId) {
                <button class="person" [class.on]="opponent() === s.riotId" (click)="opponent.set(s.riotId)">
                  <app-avatar class="avatar neutral" [iconId]="s.iconId" [name]="s.riotId" />
                  <span class="grow"><strong>{{ s.riotId.split('#')[0] }}</strong><span class="muted">#{{ s.riotId.split('#')[1] }}</span></span>
                  <span class="tag">{{ s.source }}</span>
                </button>
              }
            </div>
          }
        </section>

        <section>
          <div class="row between">
            <h3>Format</h3>
            <span class="muted small">Premier à {{ winsNeeded() }} victoire{{ winsNeeded() > 1 ? 's' : '' }}</span>
          </div>
          <div class="seg">
            @for (bo of bestOfs; track bo) {
              <button [class.on]="bestOf() === bo" (click)="bestOf.set(bo)">BO{{ bo }}</button>
            }
          </div>
        </section>

        @if (error()) {
          <div class="error-text">{{ error() }}</div>
        }
        <footer>
          <button class="link" (click)="customize()">Personnaliser…</button>
          <span class="spacer"></span>
          <button class="btn" (click)="closed.emit()">Annuler</button>
          <button class="btn primary" (click)="send()" [disabled]="busy() || !ready()">Envoyer le défi</button>
        </footer>
      </div>
    </div>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 24px; background: rgba(4, 6, 10, 0.7); backdrop-filter: blur(3px); animation: fade 0.12s ease-out; }
    .dialog { width: min(640px, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 20px; padding: 24px 26px; border-radius: var(--radius); border: 1px solid rgba(25, 227, 255, 0.5); background: linear-gradient(180deg, rgba(25, 227, 255, 0.06), var(--panel)); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); animation: pop 0.14s ease-out; }
    header h2 { margin: 4px 0 10px; font-size: 28px; }
    h3 { font-size: 14px; letter-spacing: 0.12em; margin-bottom: 10px; }
    .chips { gap: 6px; }
    .rule { color: var(--yellow); font-weight: 600; font-size: 13px; margin-left: 4px; }
    .small { font-size: 12px; }
    .between { justify-content: space-between; }
    .grow { flex: 1; min-width: 0; }
    .input { width: 100%; font-size: 15px; }
    .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 10px; }
    .person { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .person:hover { border-color: #3a465c; }
    .person.on { border-color: var(--cyan); background: var(--cyan-dim); }
    .person .avatar { width: 30px; height: 30px; border-radius: 8px; font-size: 13px; }
    .person .grow { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    footer { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
    .link { padding: 0; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
    .link:hover { color: var(--cyan); }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
  `,
})
export class QuickChallengeComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly opponents = inject(OpponentsService);
  private readonly oppInput = viewChild<ElementRef<HTMLInputElement>>('opp');

  readonly preset = input.required<Preset>();
  readonly closed = output<void>();
  readonly sent = output<void>();

  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly bestOfs = [1, 3, 5, 7, 9, 11];
  protected readonly opponent = signal('');
  protected readonly bestOf = signal(3);
  protected readonly suggestions = signal<OpponentSuggestion[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly winsNeeded = computed(() => Math.ceil(this.bestOf() / 2));
  protected readonly rule = computed(() => describe(this.preset().config.winExpression));
  protected readonly ready = computed(() => this.opponent().trim().includes('#'));

  constructor() {
    afterRenderEffect(() => this.oppInput()?.nativeElement.focus());
  }

  async ngOnInit() {
    this.suggestions.set(await this.opponents.suggestions());
  }

  protected customize() {
    const queryParams: Record<string, string | number> = { preset: this.preset().id, bo: this.bestOf() };
    if (this.opponent().trim()) queryParams['opponent'] = this.opponent().trim();
    this.closed.emit();
    void this.router.navigate(['/new'], { queryParams });
  }

  protected async send() {
    if (!this.ready() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const to = this.opponent().trim();
    try {
      await this.api.invite(to, { bestOf: this.bestOf(), ...this.preset().config });
      this.toast.success(`Défi « ${this.preset().name} » envoyé à ${to}. Il expire dans 24 h.`);
      this.sent.emit();
      this.closed.emit();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
