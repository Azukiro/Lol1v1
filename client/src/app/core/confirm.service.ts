import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  text?: string;
  confirmLabel?: string;
  /** Action destructive : bouton de confirmation en rose. */
  danger?: boolean;
}

/** Fenêtre de confirmation de l'app, à la place du confirm() natif de Windows. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);
  private resolve?: (ok: boolean) => void;

  ask(request: ConfirmRequest): Promise<boolean> {
    this.resolve?.(false);
    this.current.set(request);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  close(ok: boolean) {
    this.resolve?.(ok);
    this.resolve = undefined;
    this.current.set(null);
  }
}
