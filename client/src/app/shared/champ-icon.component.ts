import { Component, computed, inject, input } from '@angular/core';
import { ReferenceService } from '../core/reference.service';

/** Portrait carré d'un champion (Data Dragon), initiales si l'image est inconnue. Taille fixée par le parent. */
@Component({
  selector: 'app-champ-icon',
  host: { '[title]': 'name()' },
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="name()" />
    } @else {
      {{ ref.championInitials(id()) }}
    }
  `,
  styles: `
    :host { width: 40px; height: 40px; border-radius: 9px; overflow: hidden; flex-shrink: 0; display: grid; place-items: center; background: var(--panel-2); font-family: var(--display); font-weight: 700; font-size: 13px; color: var(--muted); }
    img { width: 100%; height: 100%; object-fit: cover; }
  `,
})
export class ChampIconComponent {
  protected readonly ref = inject(ReferenceService);
  readonly id = input<number | null | undefined>(null);
  protected readonly src = computed(() => (this.ref.version(), this.ref.championImage(this.id())));
  protected readonly name = computed(() => this.ref.championName(this.id()));
}
