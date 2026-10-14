import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TitleBarComponent } from './layout/title-bar.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TitleBarComponent],
  template: `
    <app-title-bar />
    <div class="view"><router-outlet /></div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .view { flex: 1; min-height: 0; overflow: auto; }
  `,
})
export class App {}
