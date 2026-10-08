import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <form class="card cyan box" (ngSubmit)="submit()">
        <div class="kicker">LoL 1v1</div>
        <h1>{{ mode() === 'login' ? 'Connexion' : 'Créer un compte' }}</h1>
        <p class="muted">Des séries de 1v1 entre amis, arbitrées automatiquement.</p>

        @if (mode() === 'register') {
          <div class="field">
            <label for="name">Pseudo</label>
            <input id="name" class="input" name="name" [(ngModel)]="displayName" required autocomplete="nickname" />
          </div>
        }
        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="email" />
        </div>
        <div class="field">
          <label for="pwd">Mot de passe</label>
          <input id="pwd" class="input" type="password" name="pwd" [(ngModel)]="password" required minlength="8"
            [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'" />
        </div>
        @if (error()) {
          <div class="error-text">{{ error() }}</div>
        }
        <button class="btn primary big" [disabled]="busy()">{{ mode() === 'login' ? 'Se connecter' : 'Créer mon compte' }}</button>
        <button type="button" class="btn ghost" (click)="toggle()">
          {{ mode() === 'login' ? 'Pas encore de compte ? Inscription' : 'Déjà un compte ? Connexion' }}
        </button>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: 100%; display: grid; place-items: center; padding: 24px;
      background: radial-gradient(circle at 20% 20%, rgba(25, 227, 255, 0.08), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255, 51, 102, 0.08), transparent 40%); }
    .box { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 16px; padding: 32px; }
    h1 { font-size: 36px; }
    p { margin: 0; }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected email = '';
  protected password = '';
  protected displayName = '';

  toggle() {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set('');
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.mode() === 'login') await this.auth.login(this.email, this.password);
      else await this.auth.register(this.email, this.password, this.displayName);
      void this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
