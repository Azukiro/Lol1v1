import { inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ChampionRef, SpellRef } from './models';

const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn';

/** Rôle principal affiché sur les cartes (tags Data Dragon). */
const ROLE_LABELS: Record<string, string> = {
  Mage: 'MAGE',
  Assassin: 'ASSASSIN',
  Fighter: 'COMBATTANT',
  Tank: 'TANK',
  Marksman: 'TIREUR',
  Support: 'SUPPORT',
};

/** Données de référence (Data Dragon) : noms, rôles et images des champions et sorts. */
@Injectable({ providedIn: 'root' })
export class ReferenceService {
  private readonly api = inject(ApiService);
  readonly version = signal('');
  readonly spells = signal<SpellRef[]>([]);
  private champions = new Map<number, ChampionRef>();
  private spellMap = new Map<number, SpellRef>();
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= this.api
      .reference()
      .then((r) => {
        this.version.set(r.version);
        this.champions = new Map(r.champions.map((c) => [c.id, c]));
        this.spellMap = new Map(r.spells.map((s) => [s.id, s]));
        this.spells.set(r.spells);
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  champion(id: number | null | undefined): ChampionRef | undefined {
    return id == null ? undefined : this.champions.get(id);
  }

  championName(id: number | null | undefined): string {
    return this.champion(id)?.name ?? (id ? `#${id}` : '?');
  }

  championInitials(id: number | null | undefined): string {
    return this.championName(id).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2).toUpperCase();
  }

  role(id: number | null | undefined): string {
    const tag = this.champion(id)?.tags[0];
    return tag ? (ROLE_LABELS[tag] ?? tag.toUpperCase()) : '';
  }

  championImage(id: number | null | undefined): string | null {
    const c = this.champion(id);
    return c && this.version() ? `${DDRAGON}/${this.version()}/img/champion/${c.key}.png` : null;
  }

  profileIcon(id: number | null | undefined): string | null {
    return id != null && id >= 0 && this.version() ? `${DDRAGON}/${this.version()}/img/profileicon/${id}.png` : null;
  }

  spell(id: number | null | undefined): SpellRef | undefined {
    return id == null ? undefined : this.spellMap.get(id);
  }

  spellName(id: number | null | undefined): string {
    return this.spell(id)?.name ?? (id ? `#${id}` : '?');
  }

  spellImage(id: number | null | undefined): string | null {
    const s = this.spell(id);
    return s && this.version() ? `${DDRAGON}/${this.version()}/img/spell/${s.key}.png` : null;
  }

  /** Ne garde que les champions jouables connus de Data Dragon (la LCU liste aussi des champions de modes événement). */
  playable(ids: number[]): number[] {
    return ids.filter((id) => (this.champions.size ? this.champions.has(id) : id > 0 && id < 10000));
  }

  search(ids: number[], query: string): number[] {
    const q = query.trim().toLowerCase();
    const sorted = [...ids].sort((a, b) => this.championName(a).localeCompare(this.championName(b)));
    return q ? sorted.filter((id) => this.championName(id).toLowerCase().includes(q)) : sorted;
  }
}
