import { Component, computed, effect, inject, OnDestroy, OnInit, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, AuthService } from '../core/api.service';
import { GameTrackerService } from '../core/game-tracker.service';
import { HubService } from '../core/hub.service';
import { ReferenceService } from '../core/reference.service';
import { ToastService } from '../core/toast.service';
import { LolService } from '../core/lol.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvatarComponent],
  template: `
    <div class="shell">
      <nav class="rail">
        <a class="logo" routerLink="/" title="Accueil">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M5 4l14 16M19 4L5 20M8 4H4v4M16 4h4v4" />
          </svg>
        </a>
        <a routerLink="/" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }" title="Accueil">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></svg>
        </a>
        <a routerLink="/new" routerLinkActive="on" title="Nouveau défi">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
        </a>
        @if (activeSeriesId(); as id) {
          <a [routerLink]="['/series', id]" routerLinkActive="on" title="Série en cours">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4l14 16M19 4L5 20" /></svg>
          </a>
        }
        <a routerLink="/friends" routerLinkActive="on" title="Amis">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></svg>
        </a>
        <a routerLink="/history" routerLinkActive="on" title="Historique">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
        </a>
        <span class="spacer"></span>
        <span class="conn" [class.ok]="hub.state() === 'connected'" [title]="'Serveur arbitre : ' + hub.state()"></span>
        <button class="me" (click)="logout()" [title]="'Se déconnecter (' + (auth.user()?.displayName ?? '') + ')'">
          <app-avatar [iconId]="myIcon()" [name]="auth.user()?.displayName ?? ''" />
        </button>
      </nav>
      <main class="content"><router-outlet /></main>
    </div>
    <div class="toasts">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.tone" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .shell { display: flex; height: 100vh; }
    .rail { width: 72px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; background: #080a0f; border-right: 1px solid var(--line); }
    .rail a, .rail .me { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: var(--muted); }
    .rail a:hover { color: var(--text); background: var(--panel); }
    .rail a.on { color: var(--cyan); background: var(--cyan-dim); }
    .rail .logo { background: var(--cyan); color: #04141a; margin-bottom: 14px; box-shadow: 0 0 18px rgba(25, 227, 255, 0.4); }
    .rail .logo:hover { background: var(--cyan); color: #04141a; }
    .rail .me app-avatar { width: 100%; height: 100%; }
    .rail .me { overflow: hidden; padding: 0; border: 2px solid var(--cyan); background: transparent; color: var(--cyan); font-family: var(--display); font-weight: 700; cursor: pointer; border-radius: 50%; }
    .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--pink); }
    .conn.ok { background: var(--green); box-shadow: 0 0 8px var(--green); }
    .content { flex: 1; overflow: auto; }
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly hub = inject(HubService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly tracker = inject(GameTrackerService);
  private readonly reference = inject(ReferenceService);
  private readonly router = inject(Router);
  private sub?: Subscription;

  protected readonly activeSeriesId = this.tracker.activeSeriesId;
  private readonly lol = inject(LolService);
  /** Icône du client LoL connecté si c'est le compte lié, sinon celle enregistrée sur le serveur. */
  protected readonly myIcon = computed(() => {
    const id = this.lol.status().identity;
    const linked = this.auth.user()?.riotAccount;
    return id && linked && id.puuid === linked.puuid ? id.profileIconId : (linked?.profileIconId ?? null);
  });

  constructor() {
    // Icône changée dans LoL : on met à jour celle enregistrée sur le serveur (visible par les adversaires).
    effect(() => {
      const id = this.lol.status().identity;
      const linked = this.auth.user()?.riotAccount;
      if (!id || !linked || id.puuid !== linked.puuid || id.profileIconId === linked.profileIconId) return;
      untracked(() =>
        this.api
          .linkRiot({ puuid: id.puuid, gameName: id.gameName, tagLine: id.tagLine, region: id.region, profileIconId: id.profileIconId })
          .then(() => this.auth.refresh())
          .catch(() => undefined),
      );
    });
  }

  async ngOnInit() {
    // Réveille le service (Render endormi) pendant que le joueur navigue.
    void this.api.health().catch(() => undefined);
    void this.reference.load();
    this.sub = this.hub.invitations$.subscribe(({ name, invitation }) => {
      if (name === 'InvitationReceived') this.toast.info(`${invitation.from.displayName} te défie : ${invitation.configLabel}`);
      if (name === 'InvitationUpdated' && invitation.status === 'ACCEPTED' && invitation.seriesId) {
        this.toast.success(`${invitation.to.displayName} a accepté ton défi !`);
        void this.router.navigate(['/series', invitation.seriesId]);
      }
      if (name === 'InvitationUpdated' && invitation.status === 'DECLINED') this.toast.info(`${invitation.to.displayName} a refusé ton défi.`);
    });
    try {
      await this.hub.connect();
      // Reprend la série en cours, s'il y en a une.
      const running = (await this.api.series()).find((s) => s.status !== 'FINISHED' && s.status !== 'ABORTED');
      if (running && !this.tracker.activeSeriesId()) {
        this.tracker.setActive(running.id);
        await this.hub.join(running.id);
      }
    } catch {
      this.toast.error('Serveur injoignable : il se réveille peut-être (≈ 1 min sur l’offre gratuite).');
      setTimeout(() => this.retry(), 15000);
    }
  }

  private async retry() {
    try {
      await this.hub.connect();
    } catch {
      setTimeout(() => this.retry(), 15000);
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async logout() {
    if (!confirm('Se déconnecter ?')) return;
    await this.hub.disconnect();
    this.tracker.setActive(null);
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
