import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { appConfig } from '../core/api.service';
import { LabObjective, LabTier, ObjectiveTier } from './lab.models';

/** Endpoints du labo, séparés de l'API des séries standards. */
@Injectable({ providedIn: 'root' })
export class LabApiService {
  private readonly http = inject(HttpClient);

  catalog() {
    return firstValueFrom(
      this.http.get<LabTier[]>(`${appConfig.apiUrl}/api/v1/lab/secret-objectives`),
    );
  }

  draw(tier: ObjectiveTier | null) {
    const query = tier ? `?tier=${tier}` : '';
    return firstValueFrom(
      this.http.get<{ tier: ObjectiveTier; a: LabObjective; b: LabObjective }>(
        `${appConfig.apiUrl}/api/v1/lab/secret-objectives/draw${query}`,
      ),
    );
  }
}
