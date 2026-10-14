import { inject, Injectable } from '@angular/core';
import { HubService } from '../core/hub.service';
import { formatGameTime } from '../core/models';
import { LolService } from '../core/lol.service';
import { ToastService } from '../core/toast.service';
import { TIER_LABELS, ObjectiveTier } from './lab.models';

const REVEAL_OVERLAY_MS = 12000;

/** Labo : annonce de l'objectif secret au chargement de la partie (overlay en jeu + toast). */
@Injectable({ providedIn: 'root' })
export class LabTrackerService {
  private readonly hub = inject(HubService);
  private readonly lol = inject(LolService);
  private readonly toast = inject(ToastService);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hub.events$.subscribe((e) => {
      if (e.name !== 'SecretObjectiveRevealed') return;
      const p = e.payload as { label: string; tier: ObjectiveTier; timeLimit: number };
      this.toast.info(`Objectif secret : ${p.label}`);
      void this.lol.showOverlay({
        title: 'Objectif secret',
        subtitle: p.label,
        score: `Palier ${TIER_LABELS[p.tier].toLowerCase()} · limite ${formatGameTime(p.timeLimit)}`,
        footer: 'Ton adversaire ne le connaît pas',
        tone: 'info',
      });
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => void this.lol.hideOverlay(), REVEAL_OVERLAY_MS);
    });
  }
}
