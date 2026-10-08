import { Component, computed, inject, input } from '@angular/core';
import { GameTrackerService } from '../core/game-tracker.service';
import { formatGameTime, SeriesState } from '../core/models';
import { conditionValue, progress } from '../../shared/lab';
import { describe, emptyFacts, leaves, WinNode } from '../../shared/rules-engine';
import { TIER_LABELS } from './lab.models';

/**
 * Labo « objectifs secrets » : panneau affiché dans l'écran live à la place des conditions communes.
 * Montre son propre objectif et sa progression, les stats brutes de l'adversaire (son objectif reste caché).
 */
@Component({
  selector: 'app-lab-objective',
  template: `
    @let lab = state().lab!;
    @let cur = lab.current;
    <div class="card cyan">
      <div class="row">
        <h2>Ton objectif secret</h2>
        <span class="spacer"></span>
        @if (cur) {
          <span class="chip yellow">{{ tierLabel[cur.tier] }}</span>
        }
      </div>
      @if (cur?.mine; as mine) {
        <p class="objective">{{ mine.label }}</p>
        <div class="conds">
          @for (leaf of myLeaves(); track $index) {
            <div class="bar-row">
              <span class="who">{{ label(leaf) }}</span>
              <div class="bar">
                <i class="me" [style.transform]="'scaleX(' + leafPct(leaf) + ')'"></i>
              </div>
              <span class="val">{{ leafText(leaf) }}</span>
            </div>
          }
        </div>
        <div class="row foot">
          <span class="muted small">Progression {{ pct(myProgress()) }}</span
          ><span class="spacer"></span>
          <span class="muted small"
            >Temps limite {{ fmt(cur!.timeLimit) }} · {{ remaining() }}</span
          >
        </div>
      } @else {
        <p class="muted">Révélé au chargement de la partie.</p>
      }
    </div>

    <div class="card">
      <div class="row">
        <h2>{{ oppName() }}</h2>
        <span class="spacer"></span><span class="chip pink">Objectif inconnu</span>
      </div>
      <div class="stats">
        <div>
          <span class="num">{{ oppStats().kills }}</span
          ><span class="muted small">kills</span>
        </div>
        <div>
          <span class="num">{{ oppStats().cs }}</span
          ><span class="muted small">CS</span>
        </div>
        <div>
          <span class="num">{{ oppStats().towers }}</span
          ><span class="muted small">tours</span>
        </div>
      </div>
      <p class="muted small">Devine ce qu'il cherche à ses mouvements, et empêche-le.</p>
    </div>

    @if (lab.history.length) {
      <div class="card">
        <h3>Objectifs révélés</h3>
        @for (h of lab.history; track h.roundId) {
          <div class="list-item reveal">
            <strong class="m">M{{ h.number }}{{ h.attempt > 1 ? '.' + h.attempt : '' }}</strong>
            <span><span class="accent">Toi</span> {{ h.mine.label }}</span>
            <span
              ><span class="danger">{{ oppName() }}</span> {{ h.opponent.label }}</span
            >
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    h2 {
      margin: 0;
    }
    p {
      margin: 8px 0 0;
    }
    .small {
      font-size: 12px;
    }
    .objective {
      font-family: var(--display);
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--cyan);
    }
    .conds {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 110px 1fr 70px;
      gap: 10px;
      align-items: center;
    }
    .who {
      font-weight: 600;
      font-size: 13px;
    }
    .bar {
      height: 8px;
      border-radius: 4px;
      background: #222a38;
      overflow: hidden;
    }
    .bar i {
      display: block;
      width: 100%;
      height: 100%;
      transform-origin: left;
      transition: transform 0.3s;
    }
    .bar i.me {
      background: var(--cyan);
    }
    .val {
      text-align: right;
      font-family: var(--display);
      font-weight: 700;
    }
    .foot {
      margin-top: 12px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    .stats div {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px;
      border-radius: 10px;
      background: #0a0d13;
      border: 1px solid var(--line);
    }
    .num {
      font-family: var(--display);
      font-size: 28px;
      font-weight: 700;
    }
    .reveal {
      gap: 16px;
      flex-wrap: wrap;
    }
    .m {
      font-family: var(--display);
      width: 44px;
    }
  `,
})
export class LabObjectiveComponent {
  private readonly tracker = inject(GameTrackerService);
  readonly state = input.required<SeriesState>();
  protected readonly tierLabel = TIER_LABELS;
  protected readonly fmt = formatGameTime;

  private readonly local = computed(() => this.tracker.localProgress());
  private readonly mine = computed(() => this.state().lab?.current?.mine ?? null);
  protected readonly myLeaves = computed(() =>
    this.mine() ? leaves(this.mine()!.expression) : [],
  );
  protected readonly oppName = computed(
    () =>
      this.state().players.find((p) => p.slot !== this.state().mySlot)?.displayName ?? 'Adversaire',
  );

  /** Valeur serveur (arbitrée) ou vue locale (plus réactive), la plus avancée des deux. */
  protected readonly myProgress = computed(() => {
    const m = this.mine();
    if (!m) return 0;
    const localValue = this.local() ? progress(m.expression, this.local()!.self) : 0;
    return Math.max(this.state().lab?.current?.myProgress ?? 0, localValue);
  });

  protected readonly oppStats = computed(() => {
    const s = this.state();
    const server = s.live?.progress[s.mySlot === 'A' ? 'B' : 'A'];
    const facts = this.local()?.opponent ?? emptyFacts();
    return {
      kills: Math.max(server?.kills ?? 0, facts.killTimes.length),
      cs: Math.max(server?.cs ?? 0, conditionValue({ condition: 'CS' }, facts)),
      towers: facts.towerTimes.length,
    };
  });

  protected readonly remaining = computed(() => {
    const cur = this.state().lab?.current;
    if (!cur) return '';
    const time = Math.max(this.local()?.gameTime ?? 0, cur.gameClock);
    const left = cur.timeLimit - time;
    return left > 0 ? `encore ${formatGameTime(left)}` : 'atteint';
  });

  protected label(leaf: WinNode) {
    return describe(leaf);
  }

  private leafValue(leaf: WinNode) {
    const s = this.state();
    const server = s.live?.progress[s.mySlot];
    const facts = this.local()?.self ?? emptyFacts();
    const local = conditionValue(leaf, facts);
    if (leaf.condition === 'KILLS') return Math.max(server?.kills ?? 0, local);
    if (leaf.condition === 'CS') return Math.max(server?.cs ?? 0, local);
    return local;
  }

  protected leafPct(leaf: WinNode) {
    return Math.min(1, this.leafValue(leaf) / Math.max(1, leaf.threshold ?? 1));
  }

  protected leafText(leaf: WinNode) {
    return `${this.leafValue(leaf)}/${leaf.threshold ?? 1}`;
  }

  protected pct(p: number) {
    return `${Math.round(p * 100)} %`;
  }
}
