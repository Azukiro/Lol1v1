import { inject, Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { LolService } from './lol.service';

export interface OpponentSuggestion {
  riotId: string;
  iconId: number | null;
  source: 'Ami' | 'Récent';
}

/** Adversaires à proposer : amis LoL inscrits sur l'app, puis adversaires récents, sans doublon. */
@Injectable({ providedIn: 'root' })
export class OpponentsService {
  private readonly api = inject(ApiService);
  private readonly lol = inject(LolService);

  async suggestions(limit = 8): Promise<OpponentSuggestion[]> {
    const [friends, recent] = await Promise.all([this.friends(), this.recent()]);
    const seen = new Set<string>();
    return [...friends, ...recent].filter((s) => !seen.has(s.riotId) && !!seen.add(s.riotId)).slice(0, limit);
  }

  /** Nécessite le client LoL lancé ; vide sinon. */
  private async friends(): Promise<OpponentSuggestion[]> {
    if (!this.lol.status().connected) return [];
    try {
      const friends = await this.lol.friends();
      const registered = await this.api.lookupPlayers(friends.map((f) => f.puuid));
      return registered.map((r) => ({ riotId: r.riotId, iconId: r.profileIconId, source: 'Ami' }));
    } catch {
      return [];
    }
  }

  private async recent(): Promise<OpponentSuggestion[]> {
    try {
      return (await this.api.recentOpponents()).map((r) => ({ riotId: r.riotId, iconId: null, source: 'Récent' }));
    } catch {
      return [];
    }
  }
}
