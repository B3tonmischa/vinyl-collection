import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./public/gallery-page/gallery-page').then((m) => m.GalleryPage),
  },
  {
    path: 'vinyl/:id',
    loadComponent: () =>
      import('./public/vinyl-detail-page/vinyl-detail-page').then((m) => m.VinylDetailPage),
  },
  {
    path: 'admin/login',
    loadComponent: () => import('./admin/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
