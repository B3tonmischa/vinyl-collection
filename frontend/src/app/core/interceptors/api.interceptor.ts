import { Location } from '@angular/common';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { ApiConfigService } from '../services/api-config';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/** How long the "session expired" toast stays; longer than most, it needs acting on. */
const SESSION_EXPIRED_TOAST_MS = 20_000;

/**
 * Applies to every request to this app's own API:
 *
 * - sends the session cookie along (`withCredentials`), so no caller has
 *   to remember to;
 * - notices when a signed-in session has stopped being accepted (a 401)
 *   and says so. The toast offers the login page in a new tab on purpose:
 *   whatever was being edited stays on screen, and saving works again once
 *   signed in there.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(ApiConfigService).apiUrl;
  if (req.url !== apiUrl && !req.url.startsWith(`${apiUrl}/`)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const location = inject(Location);

  return next(req.clone({ withCredentials: true })).pipe(
    tap({
      error: (err: unknown) => {
        // Only a session that was working until now: a failed login and the
        // first "am I signed in?" check answer 401 too, and aren't news.
        if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.isAuthenticated()) {
          return;
        }
        auth.sessionExpired();
        toast.show('Your session has expired.', {
          durationMs: SESSION_EXPIRED_TOAST_MS,
          action: {
            label: 'Sign in',
            run: () => window.open(location.prepareExternalUrl('/admin/login'), '_blank'),
          },
        });
      },
    }),
  );
};
