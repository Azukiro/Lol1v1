import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { GameTrackerService } from '../core/game-tracker.service';
import { HubService } from '../core/hub.service';
import { LolService } from '../core/lol.service';
import { Invitation, MODE_LABELS, SeriesSummary, SPELL_MODE_LABELS } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker" [class.danger]="!lol.status().connected">
            <span class="dot" [class.ok]="lol.status().connected" [class.ko]="!lol.status().connected"></span>
            @if (lol.status().connected) {
              Client LoL connecté · {{ lol.status().identity?.gameName }}#{{ lol.status().identity?.tagLine }}
            } @else {
              {{ lol.status().error ?? 'Client LoL non détecté' }}
            }
          </div>
          <h1>Prêt pour le duel ?</h1>
          <p>{{ subtitle() }}</p>
        </div>
        <a class="btn primary" routerLink="/new" [class.disabled]="!riotLinked()">+ Nouveau défi</a>
      </header>

      @if (!riotLinked()) {
        <section class="card pink link">
          <div>
            <h3>Lie ton compte Riot</h3>
            <p class="muted">Ton Riot ID et ton PUUID sont lus dans le client LoL lancé. Tes amis pourront ensuite te défier par ton pseudo.</p>
          </div>
          <button class="btn danger-fill" (click)="linkRiot()" [disabled]="!lol.status().connected || busy()">Lier mon compte Riot</button>
        </section>
      } @else if (riotMismatch()) {
        <section class="card pink link">
          <div>
            <h3>Compte LoL différent</h3>
            <p class="muted">Le client LoL est connecté avec {{ lol.status().identity?.gameName }}#{{ lol.status().identity?.tagLine }},
              ton compte est lié à {{ auth.user()?.riotAccount?.riotId }}.</p>
          </div>
          <button class="btn outline" (click)="linkRiot()" [disabled]="busy()">Lier ce compte à la place</button>
        </section>
      }

      <div class="grid cols-main">
        <div class="stack">
          @for (inv of received(); track inv.id) {
            <h2>Invitation reçue</h2>
            <article class="card pink invite">
              <div class="avatar loss big">{{ inv.from.displayName.charAt(0).toUpperCase() }}</div>
              <div class="grow">
                <h3>{{ inv.from.displayName }} te défie</h3>
                <div class="row wrap chips">
                  <span class="chip">BO{{ inv.config.bestOf }}</span>
                  <span class="chip">{{ modeLabel[inv.config.championMode] }}</span>
                  <span class="chip">{{ spellLabel[inv.config.spellMode] }}</span>
                </div>
                <div class="muted small">{{ condLabel(inv) }} · expire {{ inv.expiresAt | date: 'dd/MM HH:mm' }}</div>
              </div>
              <button class="btn" (click)="decline(inv)" [disabled]="busy()">Refuser</button>
              <button class="btn danger-fill" (click)="accept(inv)" [disabled]="busy()">Accepter</button>
            </article>
          }

          @for (inv of sent(); track inv.id) {
            <article class="card sent">
              <span class="dot wait"></span>
              <span>Défi envoyé à <strong>{{ inv.to.displayName }}</strong> ({{ inv.to.riotId }}) · {{ inv.configLabel }}</span>
            </article>
          }

          <h2>Série en cours</h2>
          @for (s of running(); track s.id) {
            <a class="card current" [routerLink]="['/series', s.id]">
              <div class="score">
                <div>
                  <div class="name">{{ auth.user()?.displayName }}</div>
                  <div class="pips me">@for (i of pips(s); track $index) { <i [class.on]="$index < s.myWins"></i> }</div>
                </div>
                <span class="num me">{{ s.myWins }}</span><span class="sep">:</span><span class="num opp">{{ s.opponentWins }}</span>
                <div>
                  <div class="name">{{ s.opponentName }}</div>
                  <div class="pips opp">@for (i of pips(s); track $index) { <i [class.on]="$index < s.opponentWins"></i> }</div>
                </div>
              </div>
              <span class="muted">BO{{ s.bestOf }} · {{ modeLabel[s.championMode] }} · {{ s.winExpressionLabel }}</span>
              <span class="btn outline">{{ s.status === 'SETUP' ? 'Préparer' : s.status === 'BANS' ? 'Bannir' : 'Continuer' }} →</span>
            </a>
          } @empty {
            <div class="empty">Aucune série en cours. Lance un défi à un ami !</div>
          }
        </div>

        <aside class="stack">
          <h2>Historique</h2>
          <div class="card">
            @for (s of finished().slice(0, 5); track s.id) {
              <a class="list-item" [routerLink]="['/series', s.id]">
                <div class="avatar" [class.win]="s.winnerSlot === s.mySlot" [class.loss]="s.winnerSlot !== s.mySlot">
                  {{ s.winnerSlot === s.mySlot ? 'V' : 'D' }}
                </div>
                <div class="grow">
                  <strong>{{ s.opponentName }}</strong>
                  <div class="muted small">BO{{ s.bestOf }} · {{ modeLabel[s.championMode] }} · {{ s.createdAt | date: 'dd/MM' }}</div>
                </div>
                <strong [class.accent]="s.winnerSlot === s.mySlot" [class.danger]="s.winnerSlot !== s.mySlot">{{ s.myWins }}:{{ s.opponentWins }}</strong>
              </a>
            } @empty {
              <div class="muted">Pas encore de série terminée.</div>
            }
          </div>

          <div class="card pool">
            <div class="kicker muted">Ton pool</div>
            @if (pool(); as p) {
              <div class="row"><span class="big-num">{{ p.owned.length + p.free.length }}</span><strong>champions jouables</strong></div>
              <div class="muted small">dont <span class="yellow">{{ p.free.length }} gratuits</span> cette semaine · lu à {{ poolAt() | date: 'HH:mm' }}</div>
            } @else {
              <div class="muted">{{ lol.status().connected ? 'Lecture…' : 'Lance le client LoL pour lire ton pool.' }}</div>
            }
            <button class="btn" (click)="readPool()" [disabled]="!lol.status().connected">Actualiser</button>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: `
    .link { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
    .link p { margin: 6px 0 0; }
    .invite { display: flex; align-items: center; gap: 16px; }
    .invite .avatar.big { width: 56px; height: 56px; font-size: 22px; border: 2px solid var(--pink); }
    .invite h3 { font-size: 20px; margin-bottom: 8px; }
    .chips { gap: 6px; margin-bottom: 8px; }
    .grow { flex: 1; min-width: 0; }
    .small { font-size: 12px; }
    .sent { display: flex; align-items: center; gap: 8px; padding: 14px 18px; }
    .current { display: flex; align-items: center; gap: 24px; justify-content: space-between;
      background: linear-gradient(110deg, rgba(25, 227, 255, 0.07), var(--panel) 50%, rgba(255, 51, 102, 0.07)); }
    .current:hover { border-color: #3a465c; }
    .pool { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
    .big-num { font-family: var(--display); font-weight: 700; font-size: 44px; color: var(--cyan); }
    a.disabled { pointer-events: none; opacity: 0.5; }
  `,
})
export class HomePage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly lol = inject(LolService);
  private readonly api = inject(ApiService);
  private readonly hub = inject(HubService);
  private readonly tracker = inject(GameTrackerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private sub?: Subscription;

  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly series = signal<SeriesSummary[]>([]);
  protected readonly pool = signal<{ owned: number[]; free: number[] } | null>(null);
  protected readonly poolAt = signal<Date | null>(null);
  protected readonly busy = signal(false);

  protected readonly riotLinked = computed(() => !!this.auth.user()?.riotAccount);
  protected readonly riotMismatch = computed(() => {
    const id = this.lol.status().identity;
    const linked = this.auth.user()?.riotAccount;
    return !!id && !!linked && id.puuid !== linked.puuid;
  });
  protected readonly received = computed(() => this.invitations().filter((i) => i.to.userId === this.auth.user()?.id));
  protected readonly sent = computed(() => this.invitations().filter((i) => i.from.userId === this.auth.user()?.id));
  protected readonly running = computed(() => this.series().filter((s) => s.status !== 'FINISHED' && s.status !== 'ABORTED'));
  protected readonly finished = computed(() => this.series().filter((s) => s.status === 'FINISHED'));
  protected readonly subtitle = computed(() => {
    const parts = [];
    if (this.received().length) parts.push(this.received().length > 1 ? `${this.received().length} invitations t'attendent` : 'Une invitation t’attend');
    if (this.running().length) parts.push('une série est en cours');
    return parts.length ? parts.join(' et ') + '.' : 'Défie un ami sur l’Abîme hurlant.';
  });

  ngOnInit() {
    void this.refresh();
    if (this.lol.status().connected) void this.readPool();
    this.sub = this.hub.invitations$.subscribe(() => void this.refresh());
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  protected pips(s: SeriesSummary) {
    return Array.from({ length: Math.ceil(s.bestOf / 2) });
  }

  protected condLabel(inv: Invitation) {
    return inv.configLabel.split(' · ').slice(3).join(' · ');
  }

  async refresh() {
    try {
      const [inv, series] = await Promise.all([this.api.invitations(), this.api.series()]);
      this.invitations.set(inv);
      this.series.set(series);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async readPool() {
    try {
      this.pool.set(await this.lol.pool());
      this.poolAt.set(new Date());
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async linkRiot() {
    const id = this.lol.status().identity;
    if (!id) return;
    this.busy.set(true);
    try {
      await this.api.linkRiot({ puuid: id.puuid, gameName: id.gameName, tagLine: id.tagLine, region: id.region });
      await this.auth.refresh();
      this.toast.success(`Compte Riot ${id.gameName}#${id.tagLine} lié.`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async accept(inv: Invitation) {
    this.busy.set(true);
    try {
      const res = await this.api.accept(inv.id);
      if (res.seriesId) {
        this.tracker.setActive(res.seriesId);
        await this.hub.join(res.seriesId);
        void this.router.navigate(['/series', res.seriesId]);
      }
    } catch (e) {
      this.toast.error(errorMessage(e));
      void this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  async decline(inv: Invitation) {
    this.busy.set(true);
    try {
      await this.api.decline(inv.id);
      await this.refresh();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
