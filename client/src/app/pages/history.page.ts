import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { HistoryEntry, HistoryPlayerRound, HistoryRound, MODE_LABELS, SeriesSummary, SPELL_MODE_LABELS } from '../core/models';
import { ReferenceService } from '../core/reference.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-history',
  imports: [RouterLink, DatePipe, NgTemplateOutlet, AvatarComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker">Tes duels</div>
          <h1>Historique</h1>
        </div>
      </header>
      @if (error()) {
        <div class="error-text">{{ error() }}</div>
      }
      <div class="list">
        @for (e of entries(); track e.series.id) {
          <article class="tile" [class]="outcome(e.series)" [class.open]="expanded() === e.series.id">
            <button class="head" (click)="toggle(e.series.id)" [attr.aria-expanded]="expanded() === e.series.id">
              <app-avatar class="avatar neutral opp" [iconId]="e.series.opponentProfileIconId" [name]="e.series.opponentName" />
              <div class="who">
                <div><strong>{{ e.series.opponentName }}</strong> <span class="muted">{{ e.series.opponentRiotId }}</span></div>
                <div class="row wrap chips">
                  <span class="chip">BO{{ e.series.bestOf }}</span>
                  <span class="chip">{{ modeLabel[e.series.championMode] }}</span>
                  <span class="chip">{{ spellLabel[e.series.spellMode] }}</span>
                  <span class="muted small cond">{{ e.series.winExpressionLabel }}</span>
                </div>
              </div>
              <div class="champs">
                @for (r of e.rounds; track r.number) {
                  <span class="champ" [class.win]="won(e.series, r)" [class.loss]="!won(e.series, r)" [title]="'Manche ' + r.number + ' : ' + ref.championName(r.me.championId)">
                    @if (ref.championImage(r.me.championId); as img) {
                      <img [src]="img" [alt]="ref.championName(r.me.championId)" />
                    } @else {
                      {{ ref.championInitials(r.me.championId) }}
                    }
                  </span>
                }
              </div>
              <div class="end">
                <span class="muted small">{{ e.series.createdAt | date: 'dd/MM/yyyy' }}</span>
                <span class="result">{{ resultLabel(e.series) }}</span>
              </div>
              <strong class="score">{{ e.series.myWins }}<span class="sep">:</span>{{ e.series.opponentWins }}</strong>
              <svg class="chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>

            @if (expanded() === e.series.id) {
              <div class="recap">
                @for (r of e.rounds; track r.number) {
                  <div class="round" [class.win]="won(e.series, r)" [class.loss]="!won(e.series, r)">
                    <div class="num">
                      <span class="muted small">Manche</span>
                      <strong>{{ r.number }}</strong>
                    </div>
                    <ng-container *ngTemplateOutlet="player; context: { $implicit: r.me, mine: true }" />
                    <div class="verdict">
                      <span class="chip" [class.green]="won(e.series, r)" [class.pink]="!won(e.series, r)">{{ won(e.series, r) ? 'Victoire' : 'Défaite' }}</span>
                      @if (r.winningLabel) {
                        <span class="small">{{ r.winningLabel }}</span>
                      }
                      @if (r.winningTime != null) {
                        <span class="muted small">à {{ clock(r.winningTime) }}</span>
                      }
                    </div>
                    <ng-container *ngTemplateOutlet="player; context: { $implicit: r.opponent, mine: false }" />
                  </div>
                } @empty {
                  <div class="muted small">Aucune manche jouée.</div>
                }
                <div class="row more">
                  <a class="btn ghost small" routerLink="/stats" [queryParams]="{ tab: 'players', player: e.series.opponentRiotId }">Face à face avec {{ e.series.opponentName }} →</a>
                  <a class="btn ghost small" [routerLink]="['/series', e.series.id]">Voir la série →</a>
                </div>
              </div>
            }
          </article>
        } @empty {
          @if (!loading()) {
            <div class="empty">Aucune série terminée pour l'instant.</div>
          }
        }
      </div>
    </div>

    <ng-template #player let-p let-mine="mine">
      <div class="player" [class.mirror]="!mine">
        <span class="portrait">
          @if (ref.championImage(p.championId); as img) {
            <img [src]="img" [alt]="ref.championName(p.championId)" />
          } @else {
            {{ ref.championInitials(p.championId) }}
          }
        </span>
        <div class="spells">
          @for (id of spells(p); track $index) {
            @if (ref.spellImage(id); as img) {
              <img [src]="img" [alt]="ref.spellName(id)" [title]="ref.spellName(id)" />
            } @else {
              <i></i>
            }
          }
        </div>
        <div class="info">
          <strong>{{ ref.championName(p.championId) }}</strong>
          <div class="badges">
            <span class="badge" title="Kills">⚔ {{ p.kills }}</span>
            <span class="badge" title="CS (par dizaines)">CS {{ p.cs }}</span>
            @if (p.firstBlood) {
              <span class="badge pink" title="First blood">First blood</span>
            }
            @if (p.firstTower) {
              <span class="badge yellow" title="Première tour">1re tour</span>
            }
          </div>
        </div>
      </div>
    </ng-template>
  `,
  styles: `
    .list { display: flex; flex-direction: column; gap: 12px; }
    .tile { --tone: var(--muted); --tint: transparent; border: 1px solid var(--line); border-left: 4px solid var(--tone); border-radius: var(--radius); overflow: hidden;
      background: linear-gradient(90deg, var(--tint), var(--panel) 45%); transition: border-color 0.15s; }
    .tile.win { --tone: var(--green); --tint: rgba(61, 220, 132, 0.14); }
    .tile.loss { --tone: var(--pink); --tint: rgba(255, 51, 102, 0.14); }
    .tile:hover, .tile.open { border-color: #3a465c; border-left-color: var(--tone); }

    .head { width: 100%; display: flex; align-items: center; gap: 18px; padding: 14px 18px; border: none; background: none; cursor: pointer; text-align: left; }
    .opp { width: 44px; height: 44px; border-radius: 10px; }
    .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .who strong { font-size: 15px; }
    .chips { gap: 6px; }
    .cond { margin-left: 4px; }
    .small { font-size: 12px; }

    .champs { display: flex; gap: 6px; }
    .champ { width: 40px; height: 40px; border-radius: 9px; overflow: hidden; display: grid; place-items: center; background: var(--panel-2); font-family: var(--display); font-weight: 700; font-size: 13px; color: var(--muted); }
    .champ img { width: 100%; height: 100%; object-fit: cover; }
    .champ.win { box-shadow: 0 0 0 2px var(--green); background: rgba(61, 220, 132, 0.2); }
    .champ.loss { box-shadow: 0 0 0 2px var(--pink); background: var(--pink-dim); }
    .champ.loss img { opacity: 0.7; filter: saturate(0.6); }

    .end { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 90px; }
    .result { font-family: var(--display); font-weight: 700; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tone); }
    .score { font-family: var(--display); font-size: 30px; min-width: 64px; text-align: right; color: var(--text); }
    .score .sep { color: var(--muted); margin: 0 2px; }
    .chevron { color: var(--muted); transition: transform 0.2s, color 0.15s; flex-shrink: 0; }
    .head:hover .chevron { color: var(--text); }
    .open .chevron { transform: rotate(180deg); color: var(--tone); }

    .recap { display: flex; flex-direction: column; gap: 8px; padding: 4px 18px 16px; animation: unfold 0.18s ease-out; }
    .round { display: grid; grid-template-columns: 56px minmax(0, 1fr) 180px minmax(0, 1fr); align-items: center; gap: 16px; padding: 10px 14px; border-radius: 10px; background: rgba(8, 10, 15, 0.55); border: 1px solid var(--line); }
    .num { display: flex; flex-direction: column; align-items: center; }
    .num strong { font-family: var(--display); font-size: 22px; line-height: 1; }
    .verdict { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }

    .player { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .player.mirror { flex-direction: row-reverse; text-align: right; }
    .player.mirror .badges { justify-content: flex-end; }
    .portrait { width: 48px; height: 48px; flex-shrink: 0; border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: var(--panel-2); font-family: var(--display); font-weight: 700; color: var(--muted); }
    .portrait img { width: 100%; height: 100%; object-fit: cover; }
    .spells { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
    .spells img, .spells i { width: 22px; height: 22px; border-radius: 5px; display: block; background: var(--panel-2); }
    .info { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .info strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .badge { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; background: #0a0d13; border: 1px solid var(--line); color: var(--text); }
    .badge.pink { color: var(--pink); border-color: rgba(255, 51, 102, 0.45); }
    .badge.yellow { color: var(--yellow); border-color: rgba(255, 201, 77, 0.45); }
    .more { align-self: flex-end; margin-top: 4px; }
    @keyframes unfold { from { opacity: 0; transform: translateY(-4px); } }

    @media (max-width: 1100px) {
      .round { grid-template-columns: 44px 1fr; }
      .verdict { grid-column: 2; flex-direction: row; justify-content: flex-start; }
      .player.mirror { grid-column: 2; flex-direction: row; text-align: left; }
      .player.mirror .badges { justify-content: flex-start; }
      .champs { display: none; }
    }
  `,
})
export class HistoryPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly ref = inject(ReferenceService);
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly entries = signal<HistoryEntry[]>([]);
  protected readonly expanded = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  async ngOnInit() {
    try {
      this.entries.set(await this.api.history());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string) {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected outcome(s: SeriesSummary) {
    if (s.status !== 'FINISHED' || !s.winnerSlot) return 'tile aborted';
    return s.winnerSlot === s.mySlot ? 'tile win' : 'tile loss';
  }

  protected resultLabel(s: SeriesSummary) {
    if (s.status !== 'FINISHED' || !s.winnerSlot) return 'Interrompue';
    return s.winnerSlot === s.mySlot ? 'Victoire' : 'Défaite';
  }

  protected won(s: SeriesSummary, r: HistoryRound) {
    return r.winnerSlot === s.mySlot;
  }

  protected spells(p: HistoryPlayerRound) {
    return [p.spell1Id, p.spell2Id];
  }

  protected clock(seconds: number) {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
