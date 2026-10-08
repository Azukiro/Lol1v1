import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HistoryRound } from '../core/models';
import { ReferenceService } from '../core/reference.service';
import { ChampIconComponent } from './champ-icon.component';

/** Ligne de récapitulatif d'une manche : mes champion / sorts / stats, verdict, puis l'adversaire en miroir. */
@Component({
  selector: 'app-round-recap',
  imports: [NgTemplateOutlet, ChampIconComponent],
  host: { '[class.win]': 'won()', '[class.loss]': '!won()' },
  template: `
    <div class="num">
      <span class="muted small">Manche</span>
      <strong>{{ round().number }}</strong>
    </div>
    <ng-container *ngTemplateOutlet="player; context: { $implicit: round().me, mine: true }" />
    <div class="verdict">
      <span class="chip" [class.green]="won()" [class.pink]="!won()">{{ won() ? 'Victoire' : 'Défaite' }}</span>
      @if (round().winningLabel) {
        <span class="small">{{ round().winningLabel }}</span>
      }
      @if (round().winningTime != null) {
        <span class="muted small">à {{ clock(round().winningTime!) }}</span>
      }
    </div>
    <ng-container *ngTemplateOutlet="player; context: { $implicit: round().opponent, mine: false }" />

    <ng-template #player let-p let-mine="mine">
      <div class="player" [class.mirror]="!mine">
        <app-champ-icon class="portrait" [id]="p.championId" />
        <div class="spells">
          @for (id of [p.spell1Id, p.spell2Id]; track $index) {
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
    :host { display: grid; grid-template-columns: 56px minmax(0, 1fr) 180px minmax(0, 1fr); align-items: center; gap: 16px; padding: 10px 14px; border-radius: 10px; background: rgba(8, 10, 15, 0.55); border: 1px solid var(--line); border-left: 3px solid var(--line); }
    :host(.win) { border-left-color: var(--green); }
    :host(.loss) { border-left-color: var(--pink); }
    .small { font-size: 12px; }
    .num { display: flex; flex-direction: column; align-items: center; }
    .num strong { font-family: var(--display); font-size: 22px; line-height: 1; }
    .verdict { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }

    .player { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .player.mirror { flex-direction: row-reverse; text-align: right; }
    .player.mirror .badges { justify-content: flex-end; }
    .portrait { width: 48px; height: 48px; border-radius: 10px; }
    .spells { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
    .spells img, .spells i { width: 22px; height: 22px; border-radius: 5px; display: block; background: var(--panel-2); }
    .info { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .info strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .badge { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; background: #0a0d13; border: 1px solid var(--line); color: var(--text); }
    .badge.pink { color: var(--pink); border-color: rgba(255, 51, 102, 0.45); }
    .badge.yellow { color: var(--yellow); border-color: rgba(255, 201, 77, 0.45); }

    @media (max-width: 1100px) {
      :host { grid-template-columns: 44px 1fr; }
      .verdict { grid-column: 2; flex-direction: row; justify-content: flex-start; }
      .player.mirror { grid-column: 2; flex-direction: row; text-align: left; }
      .player.mirror .badges { justify-content: flex-start; }
    }
  `,
})
export class RoundRecapComponent {
  protected readonly ref = inject(ReferenceService);
  readonly round = input.required<HistoryRound>();
  readonly mySlot = input.required<string>();
  protected readonly won = computed(() => this.round().winnerSlot === this.mySlot());

  protected clock(seconds: number) {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
