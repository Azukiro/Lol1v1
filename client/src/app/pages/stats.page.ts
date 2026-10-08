import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { ChampionMode, HistoryEntry, MODE_LABELS, SpellMode, SPELL_MODE_LABELS } from '../core/models';
import { ReferenceService } from '../core/reference.service';
import { AvatarComponent } from '../shared/avatar.component';
import { ChampIconComponent } from '../shared/champ-icon.component';
import { CONDITION_LABELS, ConditionCode } from '../../shared/rules-engine';
import {
  banStats, ChampionStats, championHighlights, championStats, headToHead, MIN_SAMPLE, ModeStats, modeStats,
  opponentHighlights, opponents, overview, Streak, WinLoss, winConditions, winRate,
} from '../../shared/stats';

type Tab = 'champions' | 'modes' | 'players';
type SortKey = 'played' | 'rate' | 'kills' | 'cs' | 'fb' | 'ft' | 'fastest';

@Component({
  selector: 'app-stats',
  imports: [DatePipe, DecimalPipe, RouterLink, AvatarComponent, ChampIconComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker">Tes performances</div>
          <h1>Stats</h1>
        </div>
        <nav class="tabs" role="tablist">
          @for (t of tabs; track t.id) {
            <button role="tab" [class.on]="activeTab() === t.id" [attr.aria-selected]="activeTab() === t.id" (click)="go(t.id)">{{ t.label }}</button>
          }
        </nav>
      </header>

      @if (error()) {
        <div class="error-text">{{ error() }}</div>
      } @else if (loading()) {
        <div class="empty">Chargement des stats…</div>
      } @else if (!entries().length) {
        <div class="empty">Pas encore de stats : joue une première série pour les voir apparaître.</div>
      } @else {
        <section class="overview">
          <div class="tile">
            <span class="label">Séries</span>
            <strong class="big">{{ pct(ov().series) }}</strong>
            <span class="muted small">{{ ov().series.wins }}V · {{ ov().series.played - ov().series.wins }}D</span>
          </div>
          <div class="tile">
            <span class="label">Manches</span>
            <strong class="big">{{ pct(ov().rounds) }}</strong>
            <span class="muted small">{{ ov().rounds.wins }}V · {{ ov().rounds.played - ov().rounds.wins }}D</span>
          </div>
          <div class="tile">
            <span class="label">Série en cours</span>
            <strong class="big" [class.good]="ov().streak?.wins" [class.bad]="ov().streak && !ov().streak!.wins">{{ streakLabel(ov().streak) }}</strong>
            <span class="muted small">{{ ov().streak ? (ov().streak!.wins ? 'victoire(s) d’affilée' : 'défaite(s) d’affilée') : 'aucune série terminée' }}</span>
          </div>
          <div class="tile">
            <span class="label">Comebacks</span>
            <strong class="big">{{ ov().comebacks }}</strong>
            <span class="muted small">séries gagnées après avoir été mené</span>
          </div>
        </section>

        @switch (activeTab()) {
          @case ('champions') {
            <section class="highlights">
              @for (h of champHighlights(); track h.title) {
                <div class="highlight" [class]="h.tone">
                  <span class="label">{{ h.title }}</span>
                  @if (h.stats; as c) {
                    <div class="row">
                      <app-champ-icon class="xl" [id]="c.championId" />
                      <div>
                        <strong class="name">{{ ref.championName(c.championId) }}</strong>
                        <div class="muted small">{{ h.detail }}</div>
                      </div>
                    </div>
                  } @else {
                    <span class="muted small">{{ h.empty }}</span>
                  }
                </div>
              }
            </section>

            <section class="card table-card">
              <table>
                <thead>
                  <tr>
                    <th class="left">Champion</th>
                    @for (col of columns; track col.key) {
                      <th>
                        <button class="sort" [class.on]="sortKey() === col.key" (click)="sortKey.set(col.key)">{{ col.label }}</button>
                      </th>
                    }
                    <th>Dernière</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of sortedChampions(); track c.championId) {
                    <tr>
                      <td class="left">
                        <div class="row champ">
                          <app-champ-icon [id]="c.championId" />
                          <strong>{{ ref.championName(c.championId) }}</strong>
                        </div>
                      </td>
                      <td>{{ c.played }}</td>
                      <td class="rate-cell">
                        <div class="rate">
                          <span [class.good]="winRate(c)! >= 50" [class.bad]="winRate(c)! < 50">{{ winRate(c) }} %</span>
                          <div class="bar"><i [style.width.%]="winRate(c)" [class.bad]="winRate(c)! < 50"></i></div>
                          <span class="muted small">{{ c.wins }}V {{ c.played - c.wins }}D</span>
                        </div>
                      </td>
                      <td>{{ c.avgKills | number: '1.0-1' }}</td>
                      <td>{{ c.avgCs | number: '1.0-0' }}</td>
                      <td>{{ c.firstBloodRate }} %</td>
                      <td>{{ c.firstTowerRate }} %</td>
                      <td>{{ c.fastestWin != null ? clock(c.fastestWin) : '—' }}</td>
                      <td class="muted">{{ c.lastPlayed | date: 'dd/MM' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>

            @if (bans().againstMe.length || bans().byMe.length) {
              <div class="grid two">
                <section class="card">
                  <h3>Bannis contre toi</h3>
                  <p class="muted small">Les champions que tes adversaires craignent.</p>
                  <div class="ban-list">
                    @for (b of bans().againstMe.slice(0, 6); track b.championId) {
                      <div class="ban"><app-champ-icon [id]="b.championId" /><span>{{ ref.championName(b.championId) }}</span><strong>×{{ b.count }}</strong></div>
                    } @empty {
                      <span class="muted small">Aucun ban pour l'instant.</span>
                    }
                  </div>
                </section>
                <section class="card">
                  <h3>Tes bans</h3>
                  <p class="muted small">Ce que tu refuses d'affronter.</p>
                  <div class="ban-list">
                    @for (b of bans().byMe.slice(0, 6); track b.championId) {
                      <div class="ban"><app-champ-icon [id]="b.championId" /><span>{{ ref.championName(b.championId) }}</span><strong>×{{ b.count }}</strong></div>
                    } @empty {
                      <span class="muted small">Aucun ban pour l'instant.</span>
                    }
                  </div>
                </section>
              </div>
            }
          }

          @case ('modes') {
            <div class="grid three">
              @for (group of modeGroups(); track group.title) {
                <section class="card">
                  <h3>{{ group.title }}</h3>
                  <div class="mode-list">
                    @for (m of group.rows; track m.key) {
                      <div class="mode">
                        <div class="row between">
                          <strong>{{ m.label }}</strong>
                          <span [class.good]="winRate(m.rounds)! >= 50" [class.bad]="winRate(m.rounds)! < 50">{{ winRate(m.rounds) }} %</span>
                        </div>
                        <div class="bar"><i [style.width.%]="winRate(m.rounds)" [class.bad]="winRate(m.rounds)! < 50"></i></div>
                        <div class="muted small">
                          {{ m.rounds.played }} manche(s) ·
                          séries {{ m.series.wins }}V {{ m.series.played - m.series.wins }}D
                          @if (m.avgDuration != null) {
                            · {{ clock(m.avgDuration) }} en moyenne
                          }
                        </div>
                      </div>
                    }
                  </div>
                </section>
              }
            </div>

            <div class="grid two">
              @for (c of conditionGroups(); track c.title) {
                <section class="card">
                  <h3>{{ c.title }}</h3>
                  <p class="muted small">{{ c.hint }}</p>
                  <div class="mode-list">
                    @for (s of c.rows; track s.condition) {
                      <div class="mode">
                        <div class="row between">
                          <span>{{ conditionLabel(s.condition) }}</span>
                          <span class="muted">{{ s.count }} · {{ s.percent }} %</span>
                        </div>
                        <div class="bar"><i [style.width.%]="s.percent" [class.bad]="c.bad"></i></div>
                      </div>
                    } @empty {
                      <span class="muted small">Pas encore de manche concernée.</span>
                    }
                  </div>
                </section>
              }
            </div>
          }

          @case ('players') {
            <div class="players">
              <aside class="card opp-list">
                @for (o of opponentList(); track o.riotId) {
                  <button class="opp" [class.on]="selected()?.opponent?.riotId === o.riotId" (click)="go('players', o.riotId)">
                    <app-avatar class="avatar neutral" [iconId]="o.iconId" [name]="o.name" />
                    <div class="grow">
                      <strong>{{ o.name }}</strong>
                      <div class="muted small">{{ o.series.wins }}V {{ o.series.played - o.series.wins }}D · {{ o.rounds.played }} manche(s)</div>
                    </div>
                    <span class="pct" [class.good]="winRate(o.rounds)! >= 50" [class.bad]="winRate(o.rounds)! < 50">{{ winRate(o.rounds) }} %</span>
                  </button>
                }
              </aside>

              @if (selected(); as h) {
                <section class="h2h">
                  <div class="card versus">
                    <app-avatar class="avatar neutral huge" [iconId]="h.opponent.iconId" [name]="h.opponent.name" />
                    <div class="grow">
                      <div class="kicker">Face à face</div>
                      <h2>{{ h.opponent.name }} <span class="muted riot">{{ h.opponent.riotId }}</span></h2>
                      <div class="row wrap chips">
                        <span class="chip" [class.green]="h.opponent.streak?.wins" [class.pink]="h.opponent.streak && !h.opponent.streak.wins">
                          {{ h.opponent.streak ? streakLabel(h.opponent.streak) + (h.opponent.streak.wins ? ' victoire(s) d’affilée' : ' défaite(s) d’affilée') : 'Aucune série terminée' }}
                        </span>
                        @if (h.favoriteMode; as m) {
                          <span class="chip">Mode préféré : {{ modeLabel[asMode(m.key)] }} · {{ winRate(m.rounds) }} %</span>
                        }
                      </div>
                    </div>
                    <div class="tally">
                      <div><strong class="big">{{ h.opponent.series.wins }}<span class="sep">:</span>{{ h.opponent.series.played - h.opponent.series.wins }}</strong><span class="muted small">séries</span></div>
                      <div><strong class="mid">{{ h.opponent.rounds.wins }}<span class="sep">:</span>{{ h.opponent.rounds.played - h.opponent.rounds.wins }}</strong><span class="muted small">manches</span></div>
                    </div>
                  </div>

                  <div class="card">
                    <div class="row between duel-head">
                      <strong class="me">Toi</strong>
                      <h3>Duel de stats</h3>
                      <strong class="them">{{ h.opponent.name }}</strong>
                    </div>
                    @for (d of duel(); track d.label) {
                      <div class="duel">
                        <span class="val" [class.lead]="d.me > d.them">{{ d.format(d.me) }}</span>
                        <div class="halves">
                          <div class="half left"><i [style.width.%]="d.meShare"></i></div>
                          <div class="half right"><i [style.width.%]="100 - d.meShare"></i></div>
                        </div>
                        <span class="val right" [class.lead]="d.them > d.me">{{ d.format(d.them) }}</span>
                        <span class="duel-label muted small">{{ d.label }}</span>
                      </div>
                    }
                  </div>

                  <div class="grid two">
                    <section class="card">
                      <h3>Tes champions contre lui</h3>
                      <div class="champ-records">
                        @for (c of h.myChampions.slice(0, 6); track c.championId) {
                          <div class="champ-record">
                            <app-champ-icon [id]="c.championId" />
                            <span class="grow">{{ ref.championName(c.championId) }}</span>
                            <span class="muted small">{{ c.wins }}V {{ c.played - c.wins }}D</span>
                            <strong [class.good]="winRate(c)! >= 50" [class.bad]="winRate(c)! < 50">{{ winRate(c) }} %</strong>
                          </div>
                        }
                      </div>
                    </section>
                    <section class="card">
                      <h3>Ses champions contre toi</h3>
                      <div class="champ-records">
                        @for (c of h.theirChampions.slice(0, 6); track c.championId) {
                          <div class="champ-record">
                            <app-champ-icon [id]="c.championId" />
                            <span class="grow">{{ ref.championName(c.championId) }}</span>
                            <span class="muted small">{{ c.wins }}V {{ c.played - c.wins }}D</span>
                            <strong [class.good]="winRate(c)! < 50" [class.bad]="winRate(c)! >= 50">{{ winRate(c) }} %</strong>
                          </div>
                        }
                      </div>
                    </section>
                  </div>

                  <section class="card">
                    <h3>Dernières séries</h3>
                    @for (e of h.recent; track e.series.id) {
                      <a class="recent" [routerLink]="['/series', e.series.id]" [class.win]="e.series.winnerSlot === e.series.mySlot" [class.loss]="e.series.winnerSlot && e.series.winnerSlot !== e.series.mySlot">
                        <strong class="score">{{ e.series.myWins }}<span class="sep">:</span>{{ e.series.opponentWins }}</strong>
                        <div class="row wrap chips">
                          <span class="chip">BO{{ e.series.bestOf }}</span>
                          <span class="chip">{{ modeLabel[asMode(e.series.championMode)] }}</span>
                          <span class="chip">{{ spellLabel[asSpell(e.series.spellMode)] }}</span>
                        </div>
                        <div class="row recent-champs">
                          @for (r of e.rounds; track r.number) {
                            <app-champ-icon class="sm" [class.win]="r.winnerSlot === e.series.mySlot" [class.loss]="r.winnerSlot !== e.series.mySlot" [id]="r.me.championId" />
                          }
                        </div>
                        <span class="spacer"></span>
                        <span class="muted small">{{ e.series.createdAt | date: 'dd/MM/yyyy' }}</span>
                      </a>
                    }
                  </section>
                </section>
              } @else {
                <div class="empty">{{ player() ? 'Pas encore de série contre ' + player() + '. Défie-le !' : 'Choisis un adversaire pour voir votre face à face.' }}</div>
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: `
    .page-head { align-items: flex-end; }
    .tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 12px; background: #0a0d13; border: 1px solid var(--line); }
    .tabs button { padding: 9px 18px; border: none; border-radius: 9px; background: none; color: var(--muted); cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; transition: color 0.15s, background 0.15s; }
    .tabs button:hover { color: var(--text); }
    .tabs button.on { color: var(--cyan); background: var(--cyan-dim); }

    .small { font-size: 12px; }
    .label { font-family: var(--display); font-weight: 700; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
    .good { color: var(--green); }
    .bad { color: var(--pink); }
    .between { justify-content: space-between; }
    .grow { flex: 1; min-width: 0; }
    .sep { color: var(--muted); margin: 0 2px; }
    .chips { gap: 6px; }
    h3 { margin-bottom: 4px; }
    .card > p { margin: 0 0 12px; }

    .overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 24px; }
    .tile { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); }
    .big { font-family: var(--display); font-size: 36px; line-height: 1.05; }
    .mid { font-family: var(--display); font-size: 24px; line-height: 1.05; }

    .highlights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
    .highlight { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); }
    .highlight.good { border-color: rgba(61, 220, 132, 0.45); background: linear-gradient(180deg, rgba(61, 220, 132, 0.08), var(--panel)); }
    .highlight.bad { border-color: rgba(255, 51, 102, 0.45); background: linear-gradient(180deg, rgba(255, 51, 102, 0.08), var(--panel)); }
    .highlight.cyan { border-color: rgba(25, 227, 255, 0.45); background: linear-gradient(180deg, rgba(25, 227, 255, 0.07), var(--panel)); }
    .highlight .name { font-family: var(--display); font-size: 18px; letter-spacing: 0.06em; text-transform: uppercase; }
    app-champ-icon.xl { width: 52px; height: 52px; border-radius: 11px; }
    app-champ-icon.sm { width: 28px; height: 28px; border-radius: 7px; }
    app-champ-icon.win { box-shadow: 0 0 0 2px var(--green); }
    app-champ-icon.loss { box-shadow: 0 0 0 2px var(--pink); }

    .table-card { padding: 6px 8px; margin-bottom: 20px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: center; white-space: nowrap; }
    th { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid var(--line); }
    td { border-bottom: 1px solid var(--line); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .left { text-align: left; }
    .champ strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; }
    .sort { border: none; background: none; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
    .sort:hover { color: var(--text); }
    .sort.on { color: var(--cyan); }
    .sort.on::after { content: ' ↓'; }
    .rate-cell { min-width: 190px; }
    .rate { display: grid; grid-template-columns: 46px 1fr auto; align-items: center; gap: 10px; text-align: left; font-weight: 700; }
    .bar { height: 6px; border-radius: 3px; background: #232b3b; overflow: hidden; }
    .bar i { display: block; height: 100%; border-radius: 3px; background: var(--green); }
    .bar i.bad { background: var(--pink); }

    .grid.two { grid-template-columns: 1fr 1fr; margin-bottom: 20px; }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 20px; }
    .ban-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .ban { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; background: #0a0d13; border: 1px solid var(--line); }
    .ban span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ban strong { color: var(--yellow); font-family: var(--display); }

    .mode-list { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
    .mode { display: flex; flex-direction: column; gap: 6px; }
    .mode strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; }

    .players { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
    .opp-list { padding: 8px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 16px; }
    .opp { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid transparent; border-radius: 10px; background: none; cursor: pointer; text-align: left; }
    .opp:hover { background: var(--panel-2); }
    .opp.on { border-color: rgba(25, 227, 255, 0.5); background: var(--cyan-dim); }
    .opp .avatar { width: 38px; height: 38px; }
    .pct { font-family: var(--display); font-weight: 700; font-size: 17px; }

    .h2h { display: flex; flex-direction: column; gap: 20px; }
    .h2h .grid.two { margin-bottom: 0; }
    .versus { display: flex; align-items: center; gap: 20px; background: linear-gradient(110deg, rgba(25, 227, 255, 0.07), var(--panel) 50%, rgba(255, 51, 102, 0.07)); }
    .avatar.huge { width: 72px; height: 72px; border-radius: 16px; font-size: 28px; border: 2px solid var(--pink); }
    .versus h2 { margin: 4px 0 10px; font-size: 26px; }
    .riot { font-family: var(--body); font-size: 14px; text-transform: none; letter-spacing: 0; font-weight: 500; }
    .tally { display: flex; gap: 28px; text-align: center; }
    .tally > div { display: flex; flex-direction: column; gap: 2px; }

    .duel-head { margin-bottom: 14px; }
    .duel-head .me { color: var(--cyan); font-family: var(--display); letter-spacing: 0.08em; text-transform: uppercase; }
    .duel-head .them { color: var(--pink); font-family: var(--display); letter-spacing: 0.08em; text-transform: uppercase; }
    .duel { display: grid; grid-template-columns: 64px 1fr 64px; align-items: center; gap: 12px; padding: 6px 0; }
    .duel .val { font-family: var(--display); font-weight: 700; font-size: 17px; color: var(--muted); }
    .duel .val.right { text-align: right; }
    .duel .val.lead { color: var(--text); }
    .duel-label { grid-column: 1 / -1; text-align: center; margin-top: -4px; }
    .halves { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .half { height: 8px; border-radius: 4px; background: #232b3b; overflow: hidden; display: flex; }
    .half.left { justify-content: flex-end; }
    .half.left i { background: var(--cyan); }
    .half.right i { background: var(--pink); }
    .half i { display: block; height: 100%; border-radius: 4px; }

    .champ-records { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .champ-record { display: flex; align-items: center; gap: 12px; }
    .champ-record strong { font-family: var(--display); min-width: 48px; text-align: right; }

    .recent { display: flex; align-items: center; gap: 16px; padding: 10px 12px; margin-top: 8px; border-radius: 10px; border: 1px solid var(--line); border-left: 3px solid var(--muted); background: #0a0d13; }
    .recent.win { border-left-color: var(--green); }
    .recent.loss { border-left-color: var(--pink); }
    .recent:hover { border-color: #3a465c; }
    .recent .score { font-family: var(--display); font-size: 22px; min-width: 44px; }
    .recent-champs { gap: 8px; }

    @media (max-width: 1100px) {
      .overview, .highlights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.two, .grid.three, .players { grid-template-columns: 1fr; }
      .opp-list { position: static; }
      .versus { flex-wrap: wrap; }
    }
  `,
})
export class StatsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly ref = inject(ReferenceService);
  protected readonly modeLabel = MODE_LABELS;
  protected readonly spellLabel = SPELL_MODE_LABELS;
  protected readonly winRate = winRate;

  /** Onglet et adversaire choisis, dans l'URL (?tab=players&player=Pseudo%23TAG). */
  readonly tab = input<string | undefined>(undefined);
  readonly player = input<string | undefined>(undefined);

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'champions', label: 'Champions' },
    { id: 'modes', label: 'Modes' },
    { id: 'players', label: 'Adversaires' },
  ];
  protected readonly columns: { key: SortKey; label: string }[] = [
    { key: 'played', label: 'Manches' },
    { key: 'rate', label: 'Victoires' },
    { key: 'kills', label: 'Kills moy.' },
    { key: 'cs', label: 'CS moy.' },
    { key: 'fb', label: 'First blood' },
    { key: 'ft', label: '1re tour' },
    { key: 'fastest', label: 'Plus rapide' },
  ];

  protected readonly entries = signal<HistoryEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly sortKey = signal<SortKey>('played');

  protected readonly activeTab = computed<Tab>(() => (this.tabs.some((t) => t.id === this.tab()) ? (this.tab() as Tab) : 'champions'));
  protected readonly ov = computed(() => overview(this.entries()));
  protected readonly champions = computed(() => championStats(this.entries()));
  protected readonly bans = computed(() => banStats(this.entries()));

  protected readonly champHighlights = computed(() => {
    const h = championHighlights(this.champions());
    const rec = (c: ChampionStats) => `${winRate(c)} % · ${c.wins}V ${c.played - c.wins}D`;
    return [
      { title: 'Meilleur taux de victoire', tone: 'good', stats: h.best, detail: h.best ? rec(h.best) : '', empty: `Joue un champion ${MIN_SAMPLE} manches pour le classer.` },
      { title: 'Le plus joué', tone: 'cyan', stats: h.mostPlayed, detail: h.mostPlayed ? `${h.mostPlayed.played} manche(s) · ${winRate(h.mostPlayed)} %` : '', empty: '' },
      { title: 'Bête noire', tone: 'bad', stats: h.worst, detail: h.worst ? rec(h.worst) : '', empty: 'Aucun champion maudit pour l’instant.' },
      { title: 'Victoire la plus rapide', tone: '', stats: h.fastest, detail: h.fastest?.fastestWin != null ? `Condition remplie à ${this.clock(h.fastest.fastestWin)}` : '', empty: 'Pas encore de victoire chronométrée.' },
    ];
  });

  protected readonly sortedChampions = computed(() => {
    const key = this.sortKey();
    const value = (c: ChampionStats): number => {
      switch (key) {
        case 'rate': return c.wins / c.played;
        case 'kills': return c.avgKills;
        case 'cs': return c.avgCs;
        case 'fb': return c.firstBloodRate;
        case 'ft': return c.firstTowerRate;
        case 'fastest': return c.fastestWin == null ? -Infinity : -c.fastestWin;
        default: return c.played;
      }
    };
    return [...this.champions()].sort((a, b) => value(b) - value(a) || b.played - a.played);
  });

  protected readonly modeGroups = computed(() => {
    const e = this.entries();
    const rows = (list: ModeStats[], label: (k: string) => string) => list.map((m) => ({ ...m, label: label(m.key) }));
    return [
      { title: 'Mode de champion', rows: rows(modeStats(e, (x) => x.series.championMode), (k) => MODE_LABELS[k as ChampionMode] ?? k) },
      { title: 'Format', rows: rows(modeStats(e, (x) => `BO${x.series.bestOf}`), (k) => k).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })) },
      { title: 'Sorts', rows: rows(modeStats(e, (x) => x.series.spellMode), (k) => SPELL_MODE_LABELS[k as SpellMode] ?? k) },
    ];
  });

  protected readonly conditionGroups = computed(() => [
    { title: 'Comment tu gagnes', hint: 'La condition qui t’a donné chaque manche gagnée.', rows: winConditions(this.entries(), true), bad: false },
    { title: 'Comment tu perds', hint: 'La condition remplie par ton adversaire quand il gagne.', rows: winConditions(this.entries(), false), bad: true },
  ]);

  protected readonly opponentList = computed(() => opponents(this.entries()));
  protected readonly selected = computed(() => {
    const riotId = this.player() ?? this.opponentList()[0]?.riotId;
    return riotId ? headToHead(this.entries(), riotId) : null;
  });

  protected readonly duel = computed(() => {
    const h = this.selected();
    if (!h) return [];
    const share = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
    const num = (digits: number) => (v: number) => v.toFixed(digits).replace('.', ',');
    const percent = (v: number) => `${v} %`;
    return [
      { label: 'Kills par manche', me: h.me.avgKills, them: h.them.avgKills, format: num(1) },
      { label: 'CS par manche', me: h.me.avgCs, them: h.them.avgCs, format: num(0) },
      { label: 'First blood', me: h.me.firstBloodRate, them: h.them.firstBloodRate, format: percent },
      { label: 'Première tour', me: h.me.firstTowerRate, them: h.them.firstTowerRate, format: percent },
    ].map((d) => ({ ...d, meShare: share(d.me, d.them) }));
  });

  async ngOnInit() {
    try {
      this.entries.set(await this.api.stats());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected go(tab: Tab, player?: string) {
    void this.router.navigate([], { queryParams: { tab, player: player ?? (tab === 'players' ? this.player() : null) ?? null }, replaceUrl: true });
  }

  protected pct(r: WinLoss) {
    const v = winRate(r);
    return v == null ? '—' : `${v} %`;
  }

  protected streakLabel(s: Streak | null) {
    return s ? `${s.wins ? 'V' : 'D'}${s.count}` : '—';
  }

  protected conditionLabel(code: string) {
    return CONDITION_LABELS[code as ConditionCode] ?? code;
  }

  protected asMode(key: string) {
    return key as ChampionMode;
  }

  protected asSpell(key: string) {
    return key as SpellMode;
  }

  protected clock(seconds: number) {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
