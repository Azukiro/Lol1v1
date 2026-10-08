import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthResponse, ChampionRef, HistoryEntry, Invitation, PresetConfig, Preset, RiotAccount, SeriesConfig, SeriesState, SeriesSummary, SpellRef, User } from './models';

/** URL de l'API : fournie par Electron (API_URL), sinon localhost. */
export const appConfig = { apiUrl: 'http://localhost:5080', version: '' };

const TOKEN_KEY = 'lol1v1.token';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = readToken();
  return next(token && req.url.startsWith(appConfig.apiUrl) ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Serveur injoignable (il se réveille peut-être, réessaie dans une minute).';
    return (e.error && (e.error.error || e.error.title)) || `Erreur ${e.status}`;
  }
  if (e instanceof Error) return e.message.replace(/^.*HubException: /, '');
  return String(e);
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private url(path: string) {
    return `${appConfig.apiUrl}/api/v1${path}`;
  }
  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(this.url(path)));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(this.url(path), body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(this.url(path), body));
  }

  /** Réveille le service (plan gratuit Render endormi après 15 min). */
  health() {
    return firstValueFrom(this.http.get(`${appConfig.apiUrl}/health`));
  }

  register(email: string, password: string, displayName: string) {
    return this.post<AuthResponse>('/auth/register', { email, password, displayName });
  }
  login(email: string, password: string) {
    return this.post<AuthResponse>('/auth/login', { email, password });
  }
  me() {
    return this.get<User>('/me');
  }
  linkRiot(account: Omit<RiotAccount, 'riotId'>) {
    return this.post<RiotAccount>('/riot-accounts/link', account);
  }
  recentOpponents() {
    return this.get<{ userId: string; displayName: string; riotId: string }[]>('/users/recent-opponents');
  }
  lookupPlayers(puuids: string[]) {
    return this.post<{ puuid: string; userId: string; displayName: string; riotId: string; profileIconId: number | null }[]>('/users/lookup', { puuids });
  }
  searchPlayer(riotId: string) {
    return this.get<{ userId: string; displayName: string; riotId: string }>(`/users/search?riotId=${encodeURIComponent(riotId)}`);
  }

  presets() {
    return this.get<{ server: Preset[]; mine: Preset[] }>('/presets');
  }
  createPreset(name: string, config: PresetConfig) {
    return this.post<Preset>('/presets', { name, config });
  }
  deletePreset(id: string) {
    return firstValueFrom(this.http.delete<void>(this.url(`/presets/${id}`)));
  }

  invitations() {
    return this.get<Invitation[]>('/invitations');
  }
  invite(toRiotId: string, config: SeriesConfig) {
    return this.post<Invitation>('/invitations', { toRiotId, config });
  }
  accept(id: string) {
    return this.post<Invitation>(`/invitations/${id}/accept`);
  }
  decline(id: string) {
    return this.post<Invitation>(`/invitations/${id}/decline`);
  }

  series(status?: string) {
    return this.get<SeriesSummary[]>(`/series${status ? `?status=${status}` : ''}`);
  }
  history() {
    return this.get<HistoryEntry[]>('/series/history');
  }
  seriesRecap(id: string) {
    return this.get<HistoryEntry>(`/series/${id}/recap`);
  }
  stats() {
    return this.get<HistoryEntry[]>('/series/stats');
  }
  seriesState(id: string) {
    return this.get<SeriesState>(`/series/${id}`);
  }
  putPool(id: string, championIds: number[], freeChampionIds: number[]) {
    return this.put<SeriesState>(`/series/${id}/pool`, { championIds, freeChampionIds });
  }
  putDeck(id: string, championIds: number[]) {
    return this.put<SeriesState>(`/series/${id}/deck`, { championIds });
  }
  putSpellBudget(id: string, tokens: Record<number, number>) {
    return this.put<SeriesState>(`/series/${id}/spell-budget`, { tokens });
  }

  reference() {
    return this.get<{ version: string; champions: ChampionRef[]; spells: SpellRef[] }>('/reference');
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);

  async restore() {
    if (!readToken()) {
      this.ready.set(true);
      return;
    }
    try {
      this.user.set(await this.api.me());
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 401) writeToken(null);
    } finally {
      this.ready.set(true);
    }
  }

  async login(email: string, password: string) {
    this.apply(await this.api.login(email, password));
  }

  async register(email: string, password: string, displayName: string) {
    this.apply(await this.api.register(email, password, displayName));
  }

  logout() {
    writeToken(null);
    this.user.set(null);
  }

  async refresh() {
    this.user.set(await this.api.me());
  }

  private apply(res: AuthResponse) {
    writeToken(res.token);
    this.user.set(res.user);
  }
}
