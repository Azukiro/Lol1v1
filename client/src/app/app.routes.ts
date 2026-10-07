import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './core/api.service';
import { ShellComponent } from './layout/shell.component';
import { LoginPage } from './pages/login.page';
import { HomePage } from './pages/home.page';
import { NewChallengePage } from './pages/new-challenge.page';
import { SeriesPage } from './pages/series/series.page';
import { HistoryPage } from './pages/history.page';

const authGuard: CanActivateFn = () => (inject(AuthService).user() ? true : inject(Router).parseUrl('/login'));

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: HomePage },
      { path: 'new', component: NewChallengePage },
      { path: 'series/:id', component: SeriesPage },
      { path: 'history', component: HistoryPage },
    ],
  },
  { path: '**', redirectTo: '' },
];
