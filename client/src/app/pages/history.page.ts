import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { MODE_LABELS, SeriesSummary, SPELL_MODE_LABELS } from '../core/models';

@Component({
  selector: 'app-history',
  imports: [RouterLink, DatePipe],
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
      <div class="card">
        @for (s of series(); track s.id) {
          <a class="list-item" [routerLink]="['/series', s.id]">
            <div class="avatar" [class.win]="s.winnerSlot === s.mySlot" [class.loss]="s.winnerSlot && s.winnerSlot !== s.mySlot" [class.neutral]="!s.winnerSlot">
              {{ s.status === 'FINISHED' ? (s.winnerSlot === s.mySlot ? 'V' : 'D') : '…' }}
            </div>
            <div class="grow">
              <strong>{{ s.opponentName }}</strong> <span class="muted">{{ s.opponentRiotId }}</span>
              <div class="muted small">BO{{ s.bestOf }} · {{ modeLabel[s.championMode] }} · {{ spellLabel[s.spellMode] }} · {{ s.winExpressionLabel }}</div>
            </div>
            <span class="muted small">{{ s.createdAt | date: 'dd/MM/yyyy' }}</span>
            <span class="chip" [class.cyan]="s.status === 'FINISHED' && s.winnerSlot === s.mySlot" [class.pink]="s.status === 'FINISHED' && s.winnerSlot !== s.mySlot">
              {{ s.status === 'FINISHED' ? 'Terminée' : s.status === 'ABORTED' ? 'Interrompue' : 'En cours' }}
            </span>
            <strong class="score-txt">{{ s.myWins }}:{{ s.opponentWins }}</strong>
          </a>
        } @empty {
          <div class="muted">Aucune série pour l'instant.</div>
        }
      </div>
    </div>
  `,
  styles: `
    .grow { flex: 1; }
    .small { font-size: 12px; }
    .score-txt { font-family: var(--display); font-size: 22px; min-width: 50px; text-align: right; }
  `,
})
export class HistoryPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly series = signal<SeriesSummary[]>([]);
  protected readonly error = signal('');

  async ngOnInit() {
    try {
      this.series.set(await this.api.series());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
