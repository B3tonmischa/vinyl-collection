import { Service, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from './api-config';

export type SessionStatus = 'unknown' | 'checking' | 'authenticated' | 'anonymous';

interface MeResponse {
  username?: string;
}

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
  private readonly _username = signal<string | null>(null);
  private checkPromise: Promise<boolean> | null = null;

  readonly status = this._status.asReadonly();
  readonly username = this._username.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

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
      this.http.get<MeResponse>(`${this.apiConfig.apiUrl}/auth/me`, { withCredentials: true }),
    )
      .then((res: MeResponse) => {
        this._status.set('authenticated');
        this._username.set(res?.username ?? null);
        return true;
      })
      .catch(() => {
        this._status.set('anonymous');
        this._username.set(null);
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
    this._username.set(username);
    this.checkPromise = null;
  }

  async logout(): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiConfig.apiUrl}/auth/logout`, {}, { withCredentials: true }),
    );
    this._status.set('anonymous');
    this._username.set(null);
    this.checkPromise = null;
  }
}
