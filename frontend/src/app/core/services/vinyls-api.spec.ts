import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vinyl, VinylPayload } from '../../models/vinyl.model';
import { environment } from '../../../environments/environment';
import { VinylsApiService } from './vinyls-api';

const API_URL = environment.apiUrl;

const samplePayload: VinylPayload = {
  title: 'The Dark Side of the Moon',
  year: 1973,
  label: 'Harvest',
  catalogNumber: 'SHVL 804',
  releaseType: 'LP',
  discSize: 'TWELVE_INCH',
  speed: 'RPM_33',
  genre: 'Progressive Rock',
  notes: null,
  artistIds: [1],
  tracks: [{ position: 1, title: 'Speak to Me', side: 'A' }],
};

const sampleVinyl: Vinyl = {
  id: 42,
  title: 'The Dark Side of the Moon',
  year: 1973,
  label: 'Harvest',
  catalogNumber: 'SHVL 804',
  releaseType: 'LP',
  discSize: 'TWELVE_INCH',
  speed: 'RPM_33',
  genre: 'Progressive Rock',
  notes: null,
  artists: [{ id: 1, name: 'Pink Floyd' }],
  tracks: [],
  images: [],
};

describe('VinylsApiService', () => {
  let service: VinylsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VinylsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('create() posts the payload and resolves with the created vinyl', async () => {
    const promise = service.create(samplePayload);

    const req = httpMock.expectOne(`${API_URL}/vinyls`);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual(samplePayload);
    req.flush(sampleVinyl);

    await expect(promise).resolves.toEqual(sampleVinyl);
  });

  it('update() patches the given id with the payload', async () => {
    const promise = service.update(42, samplePayload);

    const req = httpMock.expectOne(`${API_URL}/vinyls/42`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual(samplePayload);
    req.flush(sampleVinyl);

    await expect(promise).resolves.toEqual(sampleVinyl);
  });

  it('softDelete() issues a DELETE against the vinyl id', async () => {
    const promise = service.softDelete(42);

    const req = httpMock.expectOne(`${API_URL}/vinyls/42`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.withCredentials).toBe(true);
    req.flush(null);

    await expect(promise).resolves.toBeNull();
  });

  it('restore() posts to the restore sub-route with no body', async () => {
    const promise = service.restore(42);

    const req = httpMock.expectOne(`${API_URL}/vinyls/42/restore`);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toBeNull();
    req.flush(null);

    await expect(promise).resolves.toBeNull();
  });

  it('rejects when the backend responds with an error status', async () => {
    const promise = service.update(42, samplePayload);

    const req = httpMock.expectOne(`${API_URL}/vinyls/42`);
    req.flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });

    await expect(promise).rejects.toBeTruthy();
  });
});
