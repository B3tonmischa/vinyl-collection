import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

/**
 * Triggers the one GET /auth/me check on first hit (AuthService dedupes
 * repeat calls); redirects to /admin/login with the originally-requested
 * URL preserved for redirect-after-login.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const authenticated = await auth.ensureChecked();
  if (authenticated) {
    return true;
  }
  return router.createUrlTree(['/admin/login'], { queryParams: { redirect: state.url } });
};
