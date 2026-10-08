import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { GameTrackerService } from '../../core/game-tracker.service';
import { HubService } from '../../core/hub.service';
import { MODE_LABELS } from '../../core/models';
import { BanPhaseComponent, SetupPhaseComponent } from './prep.components';
import { LivePhaseComponent, LobbyPhaseComponent, PickPhaseComponent, SeriesRecapComponent } from './round.components';
import { LabObjectiveComponent } from '../../lab/lab-objective.component';

@Component({
  selector: 'app-series',
  imports: [SetupPhaseComponent, BanPhaseComponent, PickPhaseComponent, LobbyPhaseComponent, LivePhaseComponent, SeriesRecapComponent, LabObjectiveComponent],
  template: `
    <div class="page">
      @if (state(); as s) {
        <header class="page-head">
          <div>
            <div class="kicker">{{ kicker() }}</div>
            <h1>{{ title() }}</h1>
          </div>
          @if (phase() !== 'done') {
          <div class="score">
            <div>
              <div class="name">{{ me()!.displayName }}</div>
              <div class="pips me">@for (i of pips(); track $index) { <i [class.on]="$index < me()!.roundsWon"></i> }</div>
            </div>
            <span class="num me">{{ me()!.roundsWon }}</span><span class="sep">:</span><span class="num opp">{{ opp()!.roundsWon }}</span>
            <div>
              <div class="name">{{ opp()!.displayName }}</div>
              <div class="pips opp">@for (i of pips(); track $index) { <i [class.on]="$index < opp()!.roundsWon"></i> }</div>
            </div>
          </div>
          }
        </header>

        @switch (phase()) {
          @case ('setup') { <app-setup-phase [state]="s" /> }
          @case ('bans') { <app-ban-phase [state]="s" /> }
          @case ('pick') { <app-pick-phase [state]="s" [round]="round()!" /> }
          @case ('lobby') { <app-lobby-phase [state]="s" [round]="round()!" /> }
          @case ('live') {
            <app-live-phase [state]="s" [round]="round()!">
              @if (s.lab) { <app-lab-objective [state]="s" /> }
            </app-live-phase>
          }
          @case ('done') { <app-series-recap [state]="s" /> }
        }
      } @else {
        <div class="empty">{{ error() || 'Chargement de la série…' }}</div>
      }
    </div>
  `,
})
export class SeriesPage {
  private readonly hub = inject(HubService);
  private readonly tracker = inject(GameTrackerService);
  readonly id = input.required<string>();
  protected readonly error = signal('');

  protected readonly state = computed(() => this.hub.series()[this.id()] ?? null);
  protected readonly me = computed(() => this.state()?.players.find((p) => p.slot === this.state()!.mySlot));
  protected readonly opp = computed(() => this.state()?.players.find((p) => p.slot !== this.state()!.mySlot));
  protected readonly round = computed(() => {
    const s = this.state();
    return s?.rounds.find((r) => r.id === s.currentRoundId) ?? null;
  });
  protected readonly pips = computed(() => Array.from({ length: this.state()?.winsNeeded ?? 0 }));

  protected readonly phase = computed(() => {
    const s = this.state();
    if (!s) return 'loading';
    if (s.status === 'FINISHED' || s.status === 'ABORTED') return 'done';
    if (s.status === 'SETUP') return 'setup';
    if (s.status === 'BANS') return 'bans';
    switch (this.round()?.status) {
      case 'ASSIGNMENT':
        return 'pick';
      case 'LOBBY':
      case 'CHAMP_SELECT':
        return 'lobby';
      default:
        return 'live';
    }
  });

  protected readonly kicker = computed(() => {
    const s = this.state()!;
    const r = this.round();
    const base = `${s.lab ? 'Labo · Objectifs secrets · ' : ''}BO${s.bestOf} · ${MODE_LABELS[s.championMode]}`;
    if (s.status === 'SETUP' || s.status === 'BANS') return `Contre ${this.opp()!.displayName} · ${base} · Étape ${s.status === 'SETUP' ? 1 : 2}/2`;
    return r ? `Manche ${r.number}${r.attempt > 1 ? ` (tentative ${r.attempt})` : ''} · ${base}` : base;
  });

  protected readonly title = computed(() => {
    const s = this.state()!;
    switch (this.phase()) {
      case 'setup':
        return s.championMode === 'DECK' ? 'Compose ton deck' : 'Préparation';
      case 'bans':
        return 'Bannis 3 champions';
      case 'pick':
        return s.championMode === 'DECK' ? 'Pick aveugle' : 'Ton attribution';
      case 'lobby':
        return 'Sélection';
      case 'live':
        return this.round()?.status === 'DISPUTED' ? 'Litige' : 'Manche en cours';
      default:
        return 'Récapitulatif';
    }
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.tracker.setActive(id);
      if (this.hub.state() !== 'connected') return;
      this.hub.join(id).catch((e) => this.error.set(errorMessage(e)));
    });
  }
}
