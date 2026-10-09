import { AfterViewInit, Component, computed, ElementRef, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { Round, SeriesState } from '../../core/models';
import { ReferenceService } from '../../core/reference.service';
import { gameName } from '../../shared/round-recap.component';

/** Manches dont le tirage a déjà été montré (une seule fois par manche, pas aux tentatives rejouées). */
const shown = new Set<string>();

const ITEM = 96;
const GAP = 10;
const STEP = ITEM + GAP;
/** Position du champion tiré dans la bande : assez loin pour que la bande défile longtemps. */
const TARGET = 44;
const SPIN_MS = 5200;

/** Générateur pseudo-aléatoire (mulberry32) initialisé par un texte. */
function seededRandom(text: string): () => number {
  let a = [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PotEntry {
  championId: number;
  mine: boolean;
  consumed: boolean;
}

/**
 * Deck miroir : tirage du champion de la manche, façon roulette.
 * La bande défile sur les champions restants du pot puis ralentit jusqu'au champion tiré par le serveur,
 * qui est ensuite révélé en grand. Le résultat est déjà connu : l'animation ne fait que le mettre en scène.
 */
@Component({
  selector: 'app-deck-draw',
  template: `
    @if (open()) {
      <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="'Tirage de la manche ' + round().number">
        <div class="panel" [class.revealed]="phase() === 'reveal'">
          <div class="head">
            <div class="kicker">Manche {{ round().number }} · tirage au sort</div>
            @if (phase() === 'spin') {
              <button class="skip" (click)="reveal()">Passer</button>
            }
          </div>

          @if (phase() === 'spin') {
            <div class="window" #windowRef>
              <div class="reel" #reelRef>
                @for (id of reel(); track $index) {
                  <div class="slot" [class.target]="$index === target">
                    @if (ref.championImage(id); as src) {
                      <img [src]="src" [alt]="ref.championName(id)" />
                    } @else {
                      <span>{{ ref.championInitials(id) }}</span>
                    }
                  </div>
                }
              </div>
              <div class="marker" aria-hidden="true"></div>
            </div>
          } @else {
            <div class="reveal">
              @if (ref.championSplash(drawn()); as splash) {
                <img class="splash" [src]="splash" alt="" />
              }
              <div class="shade"></div>
              <div class="caption">
                <span class="owner">{{ ownerLabel() }}</span>
                <h2>{{ ref.championName(drawn()) }}</h2>
                <span class="muted">Vous jouez tous les deux ce champion.</span>
              </div>
            </div>
          }

          <div class="pot">
            <span class="label">Le pot</span>
            <div class="chips">
              @for (e of pot(); track $index) {
                <span class="chip" [class.mine]="e.mine" [class.theirs]="!e.mine" [class.used]="e.consumed"
                  [title]="(e.mine ? 'Ton deck' : 'Deck de ' + oppName()) + (e.consumed ? ' · déjà joué' : '')">
                  {{ ref.championName(e.championId) }}
                </span>
              }
            </div>
          </div>

          @if (phase() === 'reveal') {
            <button class="btn primary big go" (click)="close()">C'est parti</button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; padding: 24px; background: rgba(5, 7, 11, 0.86); backdrop-filter: blur(6px); animation: fade 0.25s ease-out; }
    .panel { width: min(860px, 100%); display: flex; flex-direction: column; gap: 22px; padding: 26px 28px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .skip { padding: 0; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
    .skip:hover { color: var(--text); }

    .window { position: relative; height: ${ITEM + 28}px; overflow: hidden; border-radius: 12px; background: #07090e; border: 1px solid var(--line);
      mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); }
    .reel { position: absolute; top: 14px; left: 0; display: flex; gap: ${GAP}px; will-change: transform; }
    .slot { width: ${ITEM}px; height: ${ITEM}px; flex-shrink: 0; border-radius: 12px; overflow: hidden; display: grid; place-items: center; background: var(--panel-2); border: 1px solid var(--line);
      font-family: var(--display); font-weight: 700; color: var(--muted); }
    .slot img { width: 100%; height: 100%; object-fit: cover; }
    .marker { position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; margin-left: -1.5px; background: var(--yellow); box-shadow: 0 0 14px var(--yellow); }
    .marker::before, .marker::after { content: ''; position: absolute; left: 50%; margin-left: -7px; border: 7px solid transparent; }
    .marker::before { top: 0; border-top-color: var(--yellow); }
    .marker::after { bottom: 0; border-bottom-color: var(--yellow); }

    .reveal { position: relative; height: 300px; border-radius: 12px; overflow: hidden; background: #07090e; animation: pop 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.15); }
    .splash { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 22%; animation: drift 6s ease-out forwards; }
    .shade { position: absolute; inset: 0; background: linear-gradient(0deg, rgba(5, 7, 11, 0.95), rgba(5, 7, 11, 0.15) 60%, transparent); }
    .caption { position: absolute; left: 24px; right: 24px; bottom: 20px; display: flex; flex-direction: column; gap: 4px; }
    .caption h2 { margin: 0; font-size: 56px; line-height: 1; color: var(--yellow); text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6); }
    .owner { font-family: var(--display); font-weight: 700; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text); }

    .pot { display: flex; flex-direction: column; gap: 10px; }
    .label { font-family: var(--display); font-weight: 700; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: #0a0d13; }
    .chip.mine { color: var(--cyan); border-color: rgba(0, 229, 255, 0.35); }
    .chip.theirs { color: var(--pink); border-color: rgba(255, 51, 102, 0.35); }
    .chip.used { opacity: 0.4; text-decoration: line-through; }
    .go { align-self: flex-end; }

    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: scale(0.94); } }
    @keyframes drift { from { transform: scale(1.12); } to { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .overlay, .reveal, .splash { animation: none; }
    }
  `,
})
export class DeckDrawComponent implements AfterViewInit, OnDestroy {
  protected readonly ref = inject(ReferenceService);
  readonly state = input.required<SeriesState>();
  readonly round = input.required<Round>();

  private readonly windowEl = viewChild<ElementRef<HTMLElement>>('windowRef');
  private readonly reelEl = viewChild<ElementRef<HTMLElement>>('reelRef');
  private animation: Animation | null = null;

  protected readonly target = TARGET;
  protected readonly phase = signal<'spin' | 'reveal'>('spin');
  private readonly dismissed = signal(false);

  protected readonly drawn = computed(() => this.round().assignments.find((a) => a.slot === this.state().mySlot)?.championId ?? null);
  protected readonly oppName = computed(() => gameName(this.state().players.find((p) => p.slot !== this.state().mySlot)!.riotId));

  /** Entrées des deux decks, les miennes d'abord. */
  protected readonly pot = computed<PotEntry[]>(() => {
    const s = this.state();
    const mine = s.me.deck.map((d) => ({ championId: d.championId, mine: true, consumed: d.consumed }));
    const theirs = (s.opponent.deck ?? []).map((d) => ({ championId: d.championId, mine: false, consumed: d.consumed }));
    return [...mine, ...theirs];
  });

  /**
   * Bande de la roulette : les champions encore en jeu dans le désordre, le tiré à la position cible.
   * Graine = id de la manche : la bande reste identique si l'état de la série est rafraîchi pendant le défilement.
   */
  protected readonly reel = computed(() => {
    const remaining = this.pot().filter((e) => !e.consumed).map((e) => e.championId);
    const pool = remaining.length ? remaining : [this.drawn()!];
    const next = seededRandom(this.round().id);
    const strip = Array.from({ length: TARGET + 6 }, () => pool[Math.floor(next() * pool.length)]);
    strip[TARGET] = this.drawn()!;
    return strip;
  });

  protected readonly ownerLabel = computed(() => {
    const id = this.drawn();
    const inMine = this.state().me.deck.some((d) => d.championId === id);
    const inTheirs = (this.state().opponent.deck ?? []).some((d) => d.championId === id);
    if (inMine && inTheirs) return 'Dans vos deux decks';
    return inMine ? 'Tiré dans ton deck' : `Tiré dans le deck de ${this.oppName()}`;
  });

  protected readonly open = computed(() => {
    const r = this.round();
    return !this.dismissed() && !!this.drawn() && r.attempt === 1 && !shown.has(r.id);
  });

  ngAfterViewInit() {
    if (!this.open()) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.reveal();
      return;
    }
    const win = this.windowEl()?.nativeElement;
    const reel = this.reelEl()?.nativeElement;
    if (!win || !reel) return;
    // Arrêt légèrement décentré sur le champion tiré, pour garder du suspense jusqu'au bout.
    const jitter = (Math.random() - 0.5) * ITEM * 0.5;
    const end = win.clientWidth / 2 - (TARGET * STEP + ITEM / 2) + jitter;
    this.animation = reel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${end}px)` }], {
      duration: SPIN_MS,
      easing: 'cubic-bezier(0.1, 0.75, 0.12, 1)',
      fill: 'forwards',
    });
    this.animation.finished.then(() => setTimeout(() => this.reveal(), 450)).catch(() => undefined);
  }

  ngOnDestroy() {
    this.animation?.cancel();
  }

  protected reveal() {
    this.animation?.cancel();
    this.animation = null;
    this.phase.set('reveal');
  }

  protected close() {
    shown.add(this.round().id);
    this.dismissed.set(true);
  }
}
