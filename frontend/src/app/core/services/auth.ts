import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiConfigService } from './api-config';

export type SessionStatus = 'unknown' | 'checking' | 'authenticated' | 'anonymous';

/**
 * How long GET /auth/me gets to answer. authGuard waits on this check, so a
 * backend that accepts the connection but never responds would otherwise
 * leave a click on an admin link doing nothing, with no error to show for it.
 */
export const SESSION_CHECK_TIMEOUT_MS = 5000;

/**
 * Holds the current admin session state. The session cookie itself is
 * httpOnly and handled entirely by the browser — nothing is stored here
 * beyond an in-memory "am I logged in" signal, checked once via GET
 * /auth/me on first admin navigation (not eagerly on every public page load).
 */
@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiConfig = inject(ApiConfigService);

  private readonly _status = signal<SessionStatus>('unknown');
  private checkPromise: Promise<boolean> | null = null;

  /** Runs GET /auth/me at most once (until login/logout resets it); safe to call repeatedly. */
  ensureChecked(): Promise<boolean> {
    const current = this._status();
    if (current === 'authenticated' || current === 'anonymous') {
      return Promise.resolve(current === 'authenticated');
    }
    if (this.checkPromise) {
      return this.checkPromise;
    }

    this._status.set('checking');
    const promise: Promise<boolean> = firstValueFrom(
      this.http
        .get(`${this.apiConfig.apiUrl}/auth/me`, { withCredentials: true })
        .pipe(timeout(SESSION_CHECK_TIMEOUT_MS)),
    )
      .then(() => {
        this._status.set('authenticated');
        return true;
      })
      .catch(() => {
        this._status.set('anonymous');
        return false;
      });
    this.checkPromise = promise;
    return promise;
  }

  async login(username: string, password: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiConfig.apiUrl}/auth/login`,
        { username, password },
        { withCredentials: true },
      ),
    );
    this._status.set('authenticated');
    this.checkPromise = null;
  }

  async logout(): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiConfig.apiUrl}/auth/logout`, {}, { withCredentials: true }),
    );
    this._status.set('anonymous');
    this.checkPromise = null;
  }
}
