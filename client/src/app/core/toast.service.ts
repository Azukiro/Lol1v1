import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  info(text: string) {
    this.push(text, 'info');
  }
  success(text: string) {
    this.push(text, 'success');
  }
  error(text: string) {
    this.push(text, 'error');
  }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(text: string, tone: Toast['tone']) {
    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => this.dismiss(id), tone === 'error' ? 8000 : 5000);
  }
}
