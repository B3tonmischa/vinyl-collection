import { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./admin-vinyl-list-page/admin-vinyl-list-page').then(
            (m) => m.AdminVinylListPage,
          ),
      },
      {
        path: 'new',
        loadComponent: () => import('./vinyl-form-page/vinyl-form-page').then((m) => m.VinylFormPage),
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./vinyl-form-page/vinyl-form-page').then((m) => m.VinylFormPage),
      },
    ],
  },
];
