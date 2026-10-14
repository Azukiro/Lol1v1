import { Component, computed, inject, input } from '@angular/core';
import { ReferenceService } from '../core/reference.service';

/** Icône d'invocateur LoL (Data Dragon), ou initiale du pseudo si inconnue. */
@Component({
  selector: 'app-avatar',
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="name()" />
    } @else {
      {{ initial() }}
    }
  `,
  styles: `
    :host { display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
    img { width: 100%; height: 100%; object-fit: cover; }
  `,
})
export class AvatarComponent {
  private readonly ref = inject(ReferenceService);
  readonly iconId = input<number | null | undefined>(null);
  readonly name = input('');

  protected readonly src = computed(() => (this.ref.version(), this.ref.profileIcon(this.iconId())));
  protected readonly initial = computed(() => (this.name() || '?').charAt(0).toUpperCase());
}
