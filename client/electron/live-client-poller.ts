/**
 * live-client-poller : interroge la Live Client Data API (~1 s) pendant la partie.
 * Disponible uniquement en jeu, sans authentification, certificat auto-signé (127.0.0.1 seulement).
 * La déduplication par EventID est faite côté interface (extractObservations).
 */
import { EventEmitter } from 'node:events';
import * as https from 'node:https';
import { localAgent } from './lcu-connector';

export class LiveClientPoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return !!this.timer;
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const data = await getJson('/liveclientdata/allgamedata');
      this.emit('data', data);
    } catch {
      /* partie en chargement ou terminée */
    } finally {
      this.busy = false;
    }
  }
}

function getJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path, agent: localAgent, timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(String(res.statusCode)));
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}
