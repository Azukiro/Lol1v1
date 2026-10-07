import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { appConfig as runtimeConfig, authInterceptor, AuthService } from './core/api.service';
import { LolService } from './core/lol.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Hash : l'interface est chargée en file:// dans Electron.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    provideAppInitializer(async () => {
      // inject() uniquement avant le premier await (contexte d'injection).
      const lol = inject(LolService);
      const auth = inject(AuthService);
      const cfg = await lol.loadConfig();
      if (cfg?.apiUrl) runtimeConfig.apiUrl = cfg.apiUrl.replace(/\/$/, '');
      if (cfg?.version) runtimeConfig.version = cfg.version;
      await auth.restore();
    }),
  ],
};
