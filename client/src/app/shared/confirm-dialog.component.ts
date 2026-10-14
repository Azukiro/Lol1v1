import { afterRenderEffect, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  host: { '(document:keydown.escape)': 'confirm.current() && confirm.close(false)' },
  template: `
    @if (confirm.current(); as c) {
      <div class="backdrop" (click)="confirm.close(false)">
        <div class="dialog" [class.danger]="c.danger" role="alertdialog" aria-modal="true" [attr.aria-label]="c.title" (click)="$event.stopPropagation()">
          <h3>{{ c.title }}</h3>
          @if (c.text) {
            <p class="muted">{{ c.text }}</p>
          }
          <div class="actions">
            <button class="btn" (click)="confirm.close(false)">Annuler</button>
            <button #ok class="btn" [class.primary]="!c.danger" [class.danger-fill]="c.danger" (click)="confirm.close(true)">{{ c.confirmLabel ?? 'Confirmer' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px; background: rgba(4, 6, 10, 0.7); backdrop-filter: blur(3px); animation: fade 0.12s ease-out; }
    .dialog { width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 24px; border-radius: var(--radius); border: 1px solid rgba(25, 227, 255, 0.5); background: linear-gradient(180deg, rgba(25, 227, 255, 0.06), var(--panel)); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); animation: pop 0.14s ease-out; }
    .dialog.danger { border-color: rgba(255, 51, 102, 0.6); background: linear-gradient(180deg, rgba(255, 51, 102, 0.08), var(--panel)); }
    h3 { font-size: 20px; }
    p { margin: 0; line-height: 1.45; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
    .actions .btn { font-size: 14px; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  private readonly ok = viewChild<ElementRef<HTMLButtonElement>>('ok');

  constructor() {
    // Entrée confirme, Échap annule : le focus va sur le bouton de confirmation à l'ouverture.
    afterRenderEffect(() => this.ok()?.nativeElement.focus());
  }
}
