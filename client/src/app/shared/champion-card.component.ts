import { Component, computed, inject, input } from '@angular/core';
import { ReferenceService } from '../core/reference.service';

@Component({
  selector: 'app-champion-card',
  template: `
    <div class="art">
      @if (image(); as src) {
        <img [src]="src" [alt]="name()" loading="lazy" />
      } @else {
        <span class="initials">{{ initials() }}</span>
      }
      @if (role()) {
        <span class="role">{{ role() }}</span>
      }
      @if (free()) {
        <span class="tag">GRATUIT</span>
      }
      @if (banned()) {
        <span class="band banned">BANNI</span>
      } @else if (played()) {
        <span class="band played">JOUÉ</span>
      }
    </div>
    <div class="name">{{ name() }}</div>
  `,
  host: { class: 'champ-card', '[class.selected]': 'selected()', '[class.ban-selected]': 'banSelected()', '[class.disabled]': 'disabled()' },
})
export class ChampionCardComponent {
  private readonly ref = inject(ReferenceService);
  readonly championId = input.required<number>();
  readonly selected = input(false);
  readonly banSelected = input(false);
  readonly disabled = input(false);
  readonly banned = input(false);
  readonly played = input(false);
  readonly free = input(false);

  protected readonly name = computed(() => this.ref.championName(this.championId()));
  protected readonly initials = computed(() => this.ref.championInitials(this.championId()));
  protected readonly image = computed(() => (this.ref.version(), this.ref.championImage(this.championId())));
  protected readonly role = computed(() => (this.ref.version(), this.ref.role(this.championId())));
}

@Component({
  selector: 'app-spell-icon',
  template: `
    @if (image(); as src) {
      <img [src]="src" [alt]="name()" />
    }
    <span>{{ name() }}</span>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 3px; border-radius: 8px; border: 1px solid var(--line); background: #0a0d13; font-size: 13px; font-weight: 600; }
    img { width: 22px; height: 22px; border-radius: 5px; }
  `,
})
export class SpellIconComponent {
  private readonly ref = inject(ReferenceService);
  readonly spellId = input.required<number | null>();
  protected readonly name = computed(() => (this.ref.version(), this.ref.spellName(this.spellId())));
  protected readonly image = computed(() => (this.ref.version(), this.ref.spellImage(this.spellId())));
}
