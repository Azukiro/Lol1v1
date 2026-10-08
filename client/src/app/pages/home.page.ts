import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, AuthService, errorMessage } from '../core/api.service';
import { GameTrackerService } from '../core/game-tracker.service';
import { HubService } from '../core/hub.service';
import { LolService } from '../core/lol.service';
import { HistoryEntry, Invitation, MODE_LABELS, Preset, SeriesSummary, SPELL_MODE_LABELS } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ConfirmService } from '../core/confirm.service';
import { ReferenceService } from '../core/reference.service';
import { ChampIconComponent } from '../shared/champ-icon.component';
import { championHighlights, championStats, MIN_SAMPLE, opponentHighlights, opponents, overview, WinLoss, winRate } from '../../shared/stats';
import { AvatarComponent } from '../shared/avatar.component';
import { QuickChallengeComponent } from '../shared/quick-challenge.component';
import { describe } from '../../shared/rules-engine';

@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe, NgTemplateOutlet, AvatarComponent, ChampIconComponent, QuickChallengeComponent],
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

      <section class="presets">
        <h2>Configs prêtes</h2>
        <div class="strip">
          @for (p of presets(); track p.id) {
            <article class="preset" [class.mine]="!p.builtIn" tabindex="0" (click)="usePreset(p)" (keydown.enter)="usePreset(p)">
              @if (!p.builtIn) {
                <div class="row">
                  <span class="chip yellow">Perso</span>
                  <span class="spacer"></span>
                  <button class="del" title="Supprimer" (click)="deletePreset(p, $event)">✕</button>
                </div>
              }
              <h3>{{ p.name }}</h3>
              <div class="row wrap chips">
                <span class="chip">{{ modeLabel[p.config.championMode] }}</span>
                <span class="chip">{{ spellLabel[p.config.spellMode] }}</span>
              </div>
              <p class="muted small">{{ p.builtIn ? p.description : rule(p) }}</p>
            </article>
          } @empty {
            <div class="muted">Chargement des configs…</div>
          }
        </div>
      </section>

      <div class="grid two">
        <div class="stack">
          <h2>Invitations</h2>
          @for (inv of received(); track inv.id) {
            <article class="card pink invite">
              <app-avatar class="avatar loss big" [iconId]="inv.from.profileIconId" [name]="inv.from.displayName" />
              <div class="grow">
                <h3>{{ inv.from.displayName }} te défie</h3>
                <div class="row wrap chips">
                  <span class="chip">BO{{ inv.config.bestOf }}</span>
                  <span class="chip">{{ modeLabel[inv.config.championMode] }}</span>
                  <span class="chip">{{ spellLabel[inv.config.spellMode] }}</span>
                </div>
                <div class="muted small">{{ condLabel(inv.configLabel) }} · expire {{ inv.expiresAt | date: 'dd/MM HH:mm' }}</div>
              </div>
              <div class="stack actions">
                <button class="btn danger-fill" (click)="accept(inv)" [disabled]="busy()">Accepter</button>
                <button class="btn" (click)="decline(inv)" [disabled]="busy()">Refuser</button>
              </div>
            </article>
          }
          @for (inv of sent(); track inv.id) {
            <article class="card sent">
              <app-avatar class="avatar neutral" [iconId]="inv.to.profileIconId" [name]="inv.to.displayName" />
              <div class="grow">
                <div class="who"><span class="dot wait"></span>Défi envoyé à <strong>{{ inv.to.displayName }}</strong> <span class="muted">{{ inv.to.riotId }}</span></div>
                <div class="row wrap chips">
                  <span class="chip">BO{{ inv.config.bestOf }}</span>
                  <span class="chip">{{ modeLabel[inv.config.championMode] }}</span>
                  <span class="chip">{{ spellLabel[inv.config.spellMode] }}</span>
                </div>
                <div class="muted small">{{ condLabel(inv.configLabel) }} · expire {{ inv.expiresAt | date: 'dd/MM HH:mm' }}</div>
              </div>
            </article>
          }
          @if (!received().length && !sent().length) {
            <div class="empty">Aucune invitation en attente.</div>
          }
        </div>

        <div class="stack">
          <h2>Séries en cours</h2>
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
              <div class="row between">
                <div class="stack tight">
                  <div class="row wrap chips">
                    <span class="chip">BO{{ s.bestOf }}</span>
                    <span class="chip">{{ modeLabel[s.championMode] }}</span>
                    <span class="chip">{{ spellLabel[s.spellMode] }}</span>
                  </div>
                  <span class="muted small">{{ s.winExpressionLabel }}</span>
                </div>
                <span class="btn outline small">{{ s.status === 'SETUP' ? 'Préparer' : s.status === 'BANS' ? 'Bannir' : 'Continuer' }} →</span>
              </div>
            </a>
          } @empty {
            <div class="empty">Aucune série en cours. Choisis une config ci-dessus pour défier un ami.</div>
          }
        </div>
      </div>

      @if (statsEntries().length) {
        <section class="stats">
          <div class="row">
            <h2>Stats</h2>
            <span class="spacer"></span>
            <a class="btn ghost small" routerLink="/stats">Toutes les stats →</a>
          </div>
          <div class="stat-tiles">
            <a class="stat-tile" routerLink="/stats" [queryParams]="{ tab: 'modes' }">
              <span class="label">Taux de victoire</span>
              <strong class="big">{{ pct(statsOverview().series) }}</strong>
              <span class="muted small">
                {{ statsOverview().series.wins }}V {{ statsOverview().series.played - statsOverview().series.wins }}D en séries ·
                {{ pct(statsOverview().rounds) }} des manches
              </span>
            </a>
            <a class="stat-tile good" routerLink="/stats" [queryParams]="{ tab: 'champions' }">
              <span class="label">{{ bestChampion()?.title ?? 'Meilleur champion' }}</span>
              @if (bestChampion(); as b) {
                <div class="row">
                  <app-champ-icon class="xl" [id]="b.stats.championId" />
                  <div>
                    <strong class="name">{{ ref.championName(b.stats.championId) }}</strong>
                    <div class="muted small">{{ winRate(b.stats) }} % · {{ b.stats.played }} manche(s)</div>
                  </div>
                </div>
              }
            </a>
            <a class="stat-tile cyan" routerLink="/stats" [queryParams]="{ tab: 'players', player: favorite()?.riotId }">
              <span class="label">Ta victime préférée</span>
              @if (favorite(); as o) {
                <ng-container *ngTemplateOutlet="opp; context: { $implicit: o }" />
              } @else {
                <span class="muted small">Affronte un joueur {{ minSample }} manches pour le classer.</span>
              }
            </a>
            <a class="stat-tile bad" routerLink="/stats" [queryParams]="{ tab: 'players', player: nemesis()?.riotId }">
              <span class="label">Ta némésis</span>
              @if (nemesis(); as o) {
                <ng-container *ngTemplateOutlet="opp; context: { $implicit: o }" />
              } @else {
                <span class="muted small">Personne ne te domine pour l’instant.</span>
              }
            </a>
          </div>
        </section>
      }

      @if (launching(); as p) {
        <app-quick-challenge [preset]="p" (closed)="launching.set(null)" (sent)="refresh()" />
      }

      <ng-template #opp let-o>
        <div class="row">
          <app-avatar class="avatar neutral xl" [iconId]="o.iconId" [name]="o.name" />
          <div>
            <strong class="name">{{ o.name }}</strong>
            <div class="muted small">{{ o.rounds.wins }}:{{ o.rounds.played - o.rounds.wins }} en manches · {{ winRate(o.rounds) }} %</div>
          </div>
        </div>
      </ng-template>
    </div>
  `,
  styles: `
    .link { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
    .link p { margin: 6px 0 0; }
    .presets { margin-bottom: 32px; }
    .presets h2 { margin: 0; }
    .strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; padding-top: 14px; }
    .preset { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); cursor: pointer; transition: border-color 0.15s, transform 0.1s; }
    .preset:hover, .preset:focus-visible { border-color: var(--cyan); outline: none; transform: translateY(-2px); }
    .preset.mine:hover, .preset.mine:focus-visible { border-color: var(--yellow); }
    .preset h3 { font-size: 20px; }
    .preset p { margin: 0; line-height: 1.4; }
    .del { border: none; background: none; color: var(--muted); cursor: pointer; padding: 2px 6px; }
    .del:hover { color: var(--pink); }
    .two { grid-template-columns: 1fr 1fr; align-items: start; }
    .invite { display: flex; align-items: center; gap: 16px; }
    .invite .avatar.big { width: 52px; height: 52px; font-size: 20px; border: 2px solid var(--pink); }
    .invite h3 { font-size: 18px; margin-bottom: 8px; }
    .invite .chips { margin-bottom: 8px; }
    .actions { gap: 8px; }
    .chips { gap: 6px; }
    .grow { flex: 1; min-width: 0; }
    .small { font-size: 12px; }
    .sent { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
    .sent .who { margin-bottom: 8px; }
    .sent .chips { margin-bottom: 6px; }
    .tight { gap: 6px; }
    .current { display: flex; flex-direction: column; gap: 14px;
      background: linear-gradient(110deg, rgba(25, 227, 255, 0.07), var(--panel) 50%, rgba(255, 51, 102, 0.07)); }
    .current:hover { border-color: #3a465c; }
    .between { justify-content: space-between; }
    a.disabled { pointer-events: none; opacity: 0.5; }
    .stats { margin-top: 32px; }
    .stats h2 { margin: 0; }
    .stat-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
    .stat-tile { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); transition: border-color 0.15s, transform 0.1s; }
    .stat-tile:hover { border-color: #3a465c; transform: translateY(-2px); }
    .stat-tile.good { border-color: rgba(61, 220, 132, 0.4); background: linear-gradient(180deg, rgba(61, 220, 132, 0.07), var(--panel)); }
    .stat-tile.cyan { border-color: rgba(25, 227, 255, 0.4); background: linear-gradient(180deg, rgba(25, 227, 255, 0.06), var(--panel)); }
    .stat-tile.bad { border-color: rgba(255, 51, 102, 0.4); background: linear-gradient(180deg, rgba(255, 51, 102, 0.07), var(--panel)); }
    .label { font-family: var(--display); font-weight: 700; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
    .big { font-family: var(--display); font-size: 36px; line-height: 1.05; }
    .name { font-family: var(--display); font-size: 18px; letter-spacing: 0.06em; text-transform: uppercase; }
    .xl { width: 52px; height: 52px; border-radius: 11px; }
    @media (max-width: 1100px) { .stat-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 1100px) { .two { grid-template-columns: 1fr; } }
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
  private readonly confirm = inject(ConfirmService);
  private sub?: Subscription;

  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly series = signal<SeriesSummary[]>([]);
  protected readonly presets = signal<Preset[]>([]);
  protected readonly busy = signal(false);
  protected readonly launching = signal<Preset | null>(null);
  protected readonly ref = inject(ReferenceService);
  protected readonly winRate = winRate;
  protected readonly minSample = MIN_SAMPLE;
  protected readonly statsEntries = signal<HistoryEntry[]>([]);
  protected readonly statsOverview = computed(() => overview(this.statsEntries()));
  protected readonly bestChampion = computed(() => {
    const h = championHighlights(championStats(this.statsEntries()));
    if (h.best) return { title: 'Meilleur champion', stats: h.best };
    return h.mostPlayed ? { title: 'Champion le plus joué', stats: h.mostPlayed } : null;
  });
  private readonly opponentHl = computed(() => opponentHighlights(opponents(this.statsEntries())));
  protected readonly favorite = computed(() => this.opponentHl().favorite);
  protected readonly nemesis = computed(() => this.opponentHl().nemesis);

  protected readonly riotLinked = computed(() => !!this.auth.user()?.riotAccount);
  protected readonly riotMismatch = computed(() => {
    const id = this.lol.status().identity;
    const linked = this.auth.user()?.riotAccount;
    return !!id && !!linked && id.puuid !== linked.puuid;
  });
  protected readonly received = computed(() => this.invitations().filter((i) => i.to.userId === this.auth.user()?.id));
  protected readonly sent = computed(() => this.invitations().filter((i) => i.from.userId === this.auth.user()?.id));
  protected readonly running = computed(() => this.series().filter((s) => s.status !== 'FINISHED' && s.status !== 'ABORTED'));
  protected readonly subtitle = computed(() => {
    const parts = [];
    if (this.received().length) parts.push(this.received().length > 1 ? `${this.received().length} invitations t'attendent` : 'Une invitation t’attend');
    if (this.running().length) parts.push(this.running().length > 1 ? `${this.running().length} séries sont en cours` : 'une série est en cours');
    return parts.length ? parts.join(' et ') + '.' : 'Défie un ami sur l’Abîme hurlant.';
  });

  ngOnInit() {
    void this.refresh();
    // Stats secondaires : un échec ne doit pas gêner l'accueil.
    void this.api.stats().then((e) => this.statsEntries.set(e)).catch(() => undefined);
    void this.loadPresets();
    this.sub = this.hub.invitations$.subscribe(() => void this.refresh());
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  protected pips(s: SeriesSummary) {
    return Array.from({ length: Math.ceil(s.bestOf / 2) });
  }

  protected pct(r: WinLoss) {
    const v = winRate(r);
    return v == null ? '—' : `${v} %`;
  }

  /** Libellé de config sans BO / mode / sorts (déjà affichés en puces) : ne garde que les conditions. */
  protected condLabel(label: string) {
    return label.split(' · ').slice(3).join(' · ');
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

  async loadPresets() {
    try {
      const { server, mine } = await this.api.presets();
      this.presets.set([...server, ...mine]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /** Config prête : ouvre le lancement rapide (adversaire + format). */
  protected usePreset(p: Preset) {
    if (!this.riotLinked()) {
      this.toast.info('Lie d’abord ton compte Riot pour défier un ami.');
      return;
    }
    this.launching.set(p);
  }

  protected rule(p: Preset) {
    return describe(p.config.winExpression);
  }

  async deletePreset(p: Preset, event: Event) {
    event.stopPropagation();
    if (!(await this.confirm.ask({ title: 'Supprimer la config ?', text: `« ${p.name} » sera retirée de tes configs prêtes.`, confirmLabel: 'Supprimer', danger: true }))) return;
    try {
      await this.api.deletePreset(p.id);
      this.presets.update((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async linkRiot() {
    const id = this.lol.status().identity;
    if (!id) return;
    this.busy.set(true);
    try {
      await this.api.linkRiot({ puuid: id.puuid, gameName: id.gameName, tagLine: id.tagLine, region: id.region, profileIconId: id.profileIconId });
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
