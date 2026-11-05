import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService, SESSION_CHECK_TIMEOUT_MS } from './auth';

const ME_URL = `${environment.apiUrl}/auth/me`;

describe('AuthService.ensureChecked', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('resolves true when the session is valid', async () => {
    const result = service.ensureChecked();

    httpMock.expectOne(ME_URL).flush({ username: 'micha' });

    await expect(result).resolves.toBe(true);
  });

  it('resolves false when the session is rejected', async () => {
    const result = service.ensureChecked();

    httpMock.expectOne(ME_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

    await expect(result).resolves.toBe(false);
  });

  it('keeps waiting right up to the timeout', async () => {
    const settled = vi.fn();
    service.ensureChecked().then(settled);
    const request = httpMock.expectOne(ME_URL);

    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS - 1);

    expect(settled).not.toHaveBeenCalled();
    request.flush({ username: 'micha' });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('gives up and resolves false when the backend never answers', async () => {
    const result = service.ensureChecked();
    const request = httpMock.expectOne(ME_URL);

    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);

    await expect(result).resolves.toBe(false);
    expect(request.cancelled).toBe(true);
  });
});
