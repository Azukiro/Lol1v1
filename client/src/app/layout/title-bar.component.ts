import { Component, inject } from '@angular/core';
import { appConfig as runtimeConfig } from '../core/api.service';
import { LolService } from '../core/lol.service';

/** Barre de titre de la fenêtre sans cadre : zone de déplacement et boutons réduire / agrandir / fermer. */
@Component({
  selector: 'app-title-bar',
  template: `
    @if (lol.window; as win) {
      <!-- Double-clic sur la zone de déplacement : Windows agrandit / restaure tout seul. -->
      <header class="bar">
        <span class="title">LoL 1v1 <span class="version">v{{ version }}</span></span>
        <div class="controls">
          <button title="Réduire" (click)="win.minimize()">
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1 6h10" stroke="currentColor" stroke-width="1.2" /></svg>
          </button>
          <button [title]="lol.maximized() ? 'Restaurer' : 'Agrandir'" (click)="win.toggleMaximize()">
            @if (lol.maximized()) {
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="3.5" width="7" height="7" rx="1" /><path d="M3.5 3.5V2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
            } @else {
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="1.5" width="9" height="9" rx="1" /></svg>
            }
          </button>
          <button class="close" title="Fermer" (click)="win.close()">
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.2" /></svg>
          </button>
        </div>
      </header>
    }
  `,
  styles: `
    .bar { height: 34px; flex-shrink: 0; display: flex; align-items: stretch; justify-content: space-between; background: #080a0f; border-bottom: 1px solid var(--line); -webkit-app-region: drag; user-select: none; }
    .title { display: flex; align-items: center; gap: 8px; padding-left: 16px; font-family: var(--display); font-weight: 700; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
    .version { font-family: var(--body); font-weight: 500; font-size: 11px; letter-spacing: 0.02em; text-transform: none; opacity: 0.7; }
    .controls { display: flex; -webkit-app-region: no-drag; }
    .controls button { width: 46px; display: grid; place-items: center; border: none; background: none; color: var(--muted); cursor: pointer; transition: background 0.12s, color 0.12s; }
    .controls button:hover { background: var(--panel-2); color: var(--text); }
    .controls button.close:hover { background: var(--pink); color: #fff; }
  `,
})
export class TitleBarComponent {
  protected readonly lol = inject(LolService);
  protected readonly version = runtimeConfig.version || 'dev';
}
