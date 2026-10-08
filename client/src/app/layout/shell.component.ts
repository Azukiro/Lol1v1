import { Component, computed, effect, ElementRef, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, AuthService } from '../core/api.service';
import { GameTrackerService } from '../core/game-tracker.service';
import { HubService } from '../core/hub.service';
import { ReferenceService } from '../core/reference.service';
import { ToastService } from '../core/toast.service';
import { LolService } from '../core/lol.service';
import { AvatarComponent } from '../shared/avatar.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvatarComponent, ConfirmDialogComponent],
  host: { '(document:click)': 'closeMenu($event)', '(document:keydown.escape)': 'menuOpen.set(false)' },
  template: `
    <div class="shell">
      <nav class="rail">
        <span class="logo">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M5 4l14 16M19 4L5 20M8 4H4v4M16 4h4v4" />
          </svg>
        </span>
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
        <div class="profile">
          <button class="me" [class.open]="menuOpen()" (click)="menuOpen.set(!menuOpen())" title="Mon profil" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()">
            <app-avatar [iconId]="myIcon()" [name]="auth.user()?.displayName ?? ''" />
          </button>
          @if (menuOpen()) {
            <div class="menu" role="menu">
              <div class="who">
                <app-avatar class="mini" [iconId]="myIcon()" [name]="auth.user()?.displayName ?? ''" />
                <div>
                  <strong>{{ auth.user()?.displayName }}</strong>
                  <div class="muted small">{{ auth.user()?.riotAccount?.riotId ?? 'Compte Riot non lié' }}</div>
                </div>
              </div>
              <button class="item danger" role="menuitem" (click)="logout()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
                Se déconnecter
              </button>
            </div>
          }
        </div>
      </nav>
      <main class="content">
        @if (lol.update(); as u) {
          <div class="update" [class.ready]="u.state === 'ready'">
            @if (u.state === 'ready') {
              <span>Mise à jour <strong>{{ u.version }}</strong> prête. Elle s'installera à la fermeture de l'app.</span>
              <button class="btn small primary" (click)="lol.installUpdate()" [disabled]="inGame()">{{ inGame() ? 'Après la partie' : 'Redémarrer maintenant' }}</button>
            } @else {
              <span class="muted">Téléchargement de la mise à jour {{ u.version }}…</span>
            }
          </div>
        }
        <router-outlet />
      </main>
    </div>
    <app-confirm-dialog />
    <div class="toasts">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.tone" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .shell { display: flex; height: 100%; }
    .rail { width: 72px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; background: #080a0f; border-right: 1px solid var(--line); }
    .rail a, .rail .logo, .rail .me { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: var(--muted); }
    .rail a:hover { color: var(--text); background: var(--panel); }
    .rail a.on { color: var(--cyan); background: var(--cyan-dim); }
    .rail .logo { background: var(--cyan); color: #04141a; margin-bottom: 14px; box-shadow: 0 0 18px rgba(25, 227, 255, 0.4); }
    .rail .me app-avatar { width: 100%; height: 100%; }
    .profile { position: relative; }
    .rail .me.open { box-shadow: 0 0 0 3px var(--cyan-dim), 0 0 16px rgba(25, 227, 255, 0.4); }
    .menu { position: absolute; z-index: 40; left: calc(100% + 14px); bottom: 0; width: 240px; padding: 8px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--panel-2); box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55); animation: pop 0.12s ease-out; }
    .who { display: flex; align-items: center; gap: 10px; padding: 8px 8px 12px; border-bottom: 1px solid var(--line); margin-bottom: 6px; }
    .who .mini { width: 36px; height: 36px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
    .who strong { font-family: var(--display); letter-spacing: 0.06em; text-transform: uppercase; }
    .small { font-size: 12px; }
    .item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: none; border-radius: 8px; background: none; cursor: pointer; text-align: left; }
    .item:hover { background: var(--panel); }
    .item.danger { color: var(--pink); }
    .item.danger:hover { background: var(--pink-dim); }
    @keyframes pop { from { opacity: 0; transform: translateX(-4px); } }
    .rail .me { overflow: hidden; padding: 0; border: 2px solid var(--cyan); background: transparent; color: var(--cyan); font-family: var(--display); font-weight: 700; cursor: pointer; border-radius: 50%; }
    .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--pink); }
    .conn.ok { background: var(--green); box-shadow: 0 0 8px var(--green); }
    .content { flex: 1; overflow: auto; }
    .update { display: flex; align-items: center; gap: 16px; justify-content: center; padding: 8px 16px; background: var(--panel-2); border-bottom: 1px solid var(--line); font-size: 13px; }
    .update.ready { background: var(--cyan-dim); border-bottom-color: rgba(25, 227, 255, 0.4); }
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
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private sub?: Subscription;
  protected readonly menuOpen = signal(false);

  protected readonly activeSeriesId = this.tracker.activeSeriesId;
  protected readonly lol = inject(LolService);
  /** Pas de redémarrage pendant une partie : l'app suit la manche en cours. */
  protected readonly inGame = computed(() => ['InProgress', 'GameStart', 'ChampSelect', 'Reconnect'].includes(this.lol.gameflow().phase));
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
      if (name === 'InvitationReceived' || invitation.status === 'ACCEPTED') this.lol.attention();
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

  protected closeMenu(event: Event) {
    const profile = this.host.nativeElement.querySelector('.profile');
    if (profile && !profile.contains(event.target as Node)) this.menuOpen.set(false);
  }

  async logout() {
    this.menuOpen.set(false);
    if (!(await this.confirm.ask({ title: 'Se déconnecter ?', text: 'Tu devras te reconnecter pour défier tes amis.', confirmLabel: 'Se déconnecter', danger: true }))) return;
    await this.hub.disconnect();
    this.tracker.setActive(null);
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
