import { Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';

export interface SelectOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Liste déroulante aux couleurs de l'app (le <select> natif ne se stylise pas sous Windows). */
@Component({
  selector: 'app-select',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown)': 'onKey($event)',
  },
  template: `
    <button type="button" class="trigger" [class.open]="open()" (click)="toggle()" aria-haspopup="listbox" [attr.aria-expanded]="open()">
      <span>{{ selected()?.label ?? placeholder() }}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    @if (open()) {
      <ul class="menu" role="listbox">
        @for (opt of options(); track $index; let k = $index) {
          <li role="option" [attr.aria-selected]="opt.value === value()" [attr.aria-disabled]="opt.disabled || null"
              [class.on]="opt.value === value()" [class.active]="k === active()" [class.disabled]="opt.disabled"
              (mouseenter)="active.set(k)" (click)="pick(opt)">
            {{ opt.label }}
            @if (opt.disabled) {
              <span class="note">déjà utilisée</span>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; min-width: 200px; }
    .trigger { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; border-radius: 10px; border: 1px solid var(--line); background: #0a0d13; color: var(--text); cursor: pointer; text-align: left; transition: border-color 0.15s; }
    .trigger:hover { border-color: #3a465c; }
    .trigger.open, .trigger:focus-visible { border-color: var(--cyan); outline: none; }
    .trigger svg { color: var(--muted); transition: transform 0.15s; flex-shrink: 0; }
    .trigger.open svg { transform: rotate(180deg); color: var(--cyan); }
    .menu { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: 6px; list-style: none; border-radius: 10px; border: 1px solid var(--line); background: var(--panel-2); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); animation: drop 0.12s ease-out; }
    li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 7px; cursor: pointer; }
    li.active { background: var(--panel); }
    li.on { color: var(--cyan); background: var(--cyan-dim); }
    li.disabled { color: var(--muted); opacity: 0.55; cursor: not-allowed; background: none; }
    .note { font-size: 11px; }
    @keyframes drop { from { opacity: 0; transform: translateY(-4px); } }
  `,
})
export class SelectComponent<T> {
  readonly options = input.required<SelectOption<T>[]>();
  readonly value = input<T>();
  readonly placeholder = input('Choisir…');
  readonly valueChange = output<T>();

  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle() {
    this.open.update((o) => !o);
    this.active.set(this.options().findIndex((o) => o.value === this.value()));
  }

  protected pick(opt: SelectOption<T>) {
    if (opt.disabled) return;
    this.open.set(false);
    if (opt.value !== this.value()) this.valueChange.emit(opt.value);
  }

  protected onDocumentClick(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected onKey(event: KeyboardEvent) {
    if (!this.open()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.toggle();
      }
      return;
    }
    const opts = this.options();
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.open.set(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      let k = this.active();
      for (let n = 0; n < opts.length; n++) {
        k = (k + step + opts.length) % opts.length;
        if (!opts[k].disabled) break;
      }
      this.active.set(k);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const opt = opts[this.active()];
      if (opt) this.pick(opt);
    }
  }
}
