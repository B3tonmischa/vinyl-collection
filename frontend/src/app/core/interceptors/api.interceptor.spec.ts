import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiConfigService } from '../services/api-config';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';
import { apiInterceptor } from './api.interceptor';

describe('apiInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let toast: ToastService;
  let apiUrl: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    toast = TestBed.inject(ToastService);
    apiUrl = TestBed.inject(ApiConfigService).apiUrl;
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Signs in through the real service, so its state is what the app would have. */
  async function signIn(): Promise<void> {
    const login = auth.login('admin', 'secret');
    httpMock.expectOne(`${apiUrl}/auth/login`).flush({ status: 'ok' });
    await login;
  }

  function fail401(url: string): void {
    http.get(url).subscribe({ error: () => undefined });
    httpMock.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
  }

  it('sends the session cookie with requests to the API', () => {
    http.get(`${apiUrl}/vinyls`).subscribe();
    const req = httpMock.expectOne(`${apiUrl}/vinyls`);
    expect(req.request.withCredentials).toBe(true);
    req.flush([]);
  });

  it('leaves requests to anywhere else alone', () => {
    http.get('https://elsewhere.example/thing').subscribe();
    const req = httpMock.expectOne('https://elsewhere.example/thing');
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });

  it('announces an expired session, once, and forgets the session', async () => {
    await signIn();
    expect(auth.isAuthenticated()).toBe(true);

    fail401(`${apiUrl}/vinyls/1`);

    expect(auth.isAuthenticated()).toBe(false);
    expect(toast.toasts().map((t) => t.message)).toEqual(['Your session has expired.']);
    expect(toast.toasts()[0].action?.label).toBe('Sign in');

    // A second failing request doesn't stack another toast.
    fail401(`${apiUrl}/vinyls/2`);
    expect(toast.toasts()).toHaveLength(1);
  });

  it('offers the login page in a new tab, so the page being edited stays', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await signIn();
    fail401(`${apiUrl}/vinyls/1`);

    toast.runAction(toast.toasts()[0].id);

    expect(open).toHaveBeenCalledWith(expect.stringContaining('/admin/login'), '_blank');
    expect(toast.toasts()).toHaveLength(0);
    open.mockRestore();
  });

  it('says nothing about a 401 when nobody was signed in', () => {
    // A wrong password and the first "am I signed in?" check both answer 401.
    fail401(`${apiUrl}/auth/me`);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('says nothing about other errors', async () => {
    await signIn();
    http.get(`${apiUrl}/vinyls/1`).subscribe({ error: () => undefined });
    httpMock.expectOne(`${apiUrl}/vinyls/1`).flush(null, { status: 500, statusText: 'Oops' });

    expect(auth.isAuthenticated()).toBe(true);
    expect(toast.toasts()).toHaveLength(0);
  });
});
