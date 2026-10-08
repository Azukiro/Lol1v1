import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { LolService } from '../core/lol.service';
import type { LolFriend } from '../../shared/ipc';
import { AvatarComponent } from '../shared/avatar.component';

interface FriendRow extends LolFriend {
  riotId: string;
  appName: string | null;
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'ko' | 'off' }> = {
  chat: { label: 'En ligne', tone: 'ok' },
  away: { label: 'Absent', tone: 'wait' },
  dnd: { label: 'Occupé', tone: 'ko' },
  mobile: { label: 'Mobile', tone: 'wait' },
  offline: { label: 'Hors ligne', tone: 'off' },
};

const GAME_STATUS: Record<string, string> = {
  inGame: 'En partie',
  championSelect: 'En sélection',
  inQueue: 'En file',
  hosting_NORMAL: 'Dans un salon',
  hosting_RANKED_SOLO_5x5: 'Dans un salon',
};

/** Amis lus dans le client LoL, croisés avec les comptes de l'app pour les défier en un clic. */
@Component({
  selector: 'app-friends',
  imports: [FormsModule, RouterLink, AvatarComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="kicker">Liste d'amis LoL</div>
          <h1>Amis</h1>
          <p>{{ subtitle() }}</p>
        </div>
        <input class="input search" placeholder="Rechercher un ami" [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </header>

      @if (!lol.status().connected) {
        <div class="empty">Lance le client LoL pour récupérer ta liste d'amis.</div>
      } @else if (error()) {
        <div class="error-text">{{ error() }}</div>
      } @else {
        <h2>Sur LoL 1v1 <span class="muted count">{{ onApp().length }}</span></h2>
        <div class="card list">
          @for (f of onApp(); track f.puuid) {
            <div class="list-item">
              <app-avatar class="avatar win" [iconId]="f.icon" [name]="f.gameName" />
              <div class="grow">
                <strong>{{ f.gameName }}</strong><span class="muted">#{{ f.tagLine }}</span>
                <div class="muted small"><span class="dot" [class]="statusTone(f)"></span>{{ statusLabel(f) }} · {{ f.appName }} sur l'app</div>
              </div>
              <a class="btn ghost small" routerLink="/stats" [queryParams]="{ tab: 'players', player: f.riotId }">Face à face</a>
              <button class="btn outline small" (click)="challenge(f)">Défier</button>
            </div>
          } @empty {
            <div class="muted">Aucun de tes amis LoL n'a encore lié son compte sur l'app. Envoie-leur l'installeur !</div>
          }
        </div>

        <h2>Pas encore sur l'app <span class="muted count">{{ others().length }}</span></h2>
        <div class="card list">
          @for (f of others(); track f.puuid) {
            <div class="list-item dim">
              <app-avatar class="avatar neutral" [iconId]="f.icon" [name]="f.gameName" />
              <div class="grow">
                <strong>{{ f.gameName }}</strong><span class="muted">#{{ f.tagLine }}</span>
                <div class="muted small"><span class="dot" [class]="statusTone(f)"></span>{{ statusLabel(f) }}</div>
              </div>
            </div>
          } @empty {
            <div class="muted">Rien ici.</div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .search { width: 280px; }
    .count { font-size: 14px; margin-left: 6px; }
    .list { margin-bottom: 28px; padding: 6px 20px; }
    .grow { flex: 1; }
    .small { font-size: 12px; margin-top: 2px; }
    .dim { opacity: 0.6; }
    .dot.off { background: #4a5468; }
  `,
})
export class FriendsPage {
  protected readonly lol = inject(LolService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly error = signal('');
  private readonly friends = signal<FriendRow[]>([]);

  private readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.friends()
      .filter((f) => !q || f.riotId.toLowerCase().includes(q) || (f.appName ?? '').toLowerCase().includes(q))
      .sort((a, b) => this.rank(a) - this.rank(b) || a.gameName.localeCompare(b.gameName));
  });
  protected readonly onApp = computed(() => this.filtered().filter((f) => f.appName));
  protected readonly others = computed(() => this.filtered().filter((f) => !f.appName));
  protected readonly subtitle = computed(() => {
    const online = this.friends().filter((f) => f.availability !== 'offline').length;
    return `${this.friends().length} amis · ${online} en ligne · ${this.friends().filter((f) => f.appName).length} sur l'app`;
  });

  constructor() {
    // Rechargé à la connexion du client LoL et à chaque changement de statut d'un ami.
    effect(() => {
      this.lol.friendsVersion();
      if (this.lol.status().connected) void this.load();
    });
  }

  private async load() {
    try {
      const friends = await this.lol.friends();
      const registered = new Map((await this.api.lookupPlayers(friends.map((f) => f.puuid))).map((r) => [r.puuid, r]));
      this.friends.set(friends.map((f) => ({ ...f, riotId: `${f.gameName}#${f.tagLine}`, appName: registered.get(f.puuid)?.displayName ?? null })));
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private rank(f: LolFriend) {
    return f.availability === 'offline' ? 2 : f.gameStatus === 'inGame' ? 1 : 0;
  }

  protected statusTone(f: LolFriend) {
    return 'dot ' + (f.gameStatus === 'inGame' ? 'ko' : (STATUS[f.availability]?.tone ?? 'off'));
  }

  protected statusLabel(f: LolFriend) {
    return (f.availability !== 'offline' && GAME_STATUS[f.gameStatus]) || STATUS[f.availability]?.label || f.availability;
  }

  protected challenge(f: FriendRow) {
    void this.router.navigate(['/new'], { queryParams: { opponent: f.riotId } });
  }
}
