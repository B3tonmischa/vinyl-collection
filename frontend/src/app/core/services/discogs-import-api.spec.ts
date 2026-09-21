import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { DiscogsSearchCandidate } from '../../models/discogs.model';
import { DiscogsImportApiService, ImportedVinyl } from './discogs-import-api';

const API_URL = environment.apiUrl;

const sampleCandidate: DiscogsSearchCandidate = {
  discogsReleaseId: 249504,
  title: 'Radiohead - OK Computer',
  year: 1997,
  formats: ['Vinyl', 'LP', 'Album'],
  country: 'UK',
  catalogNumber: 'NODATA 02',
  label: 'Parlophone',
  thumbnailUrl: 'https://img.discogs.com/thumb.jpg',
};

const sampleImportedVinyl: ImportedVinyl = {
  id: 7,
  title: 'OK Computer',
  year: 1997,
  label: 'Parlophone',
  catalogNumber: 'NODATA 02',
  releaseType: 'LP',
  discSize: 'TWELVE_INCH',
  speed: 'RPM_33',
  genre: 'Rock',
  notes: null,
  artists: [{ id: 1, name: 'Radiohead' }],
  tracks: [],
  images: [],
  discogsReleaseUrl: 'https://www.discogs.com/release/249504',
};

describe('DiscogsImportApiService', () => {
  let service: DiscogsImportApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DiscogsImportApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('search() only includes query params that were actually provided', async () => {
    const promise = service.search({ artist: 'Radiohead' });

    const req = httpMock.expectOne(
      (r) => r.url === `${API_URL}/import/discogs/search` && r.method === 'GET',
    );
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.params.get('artist')).toBe('Radiohead');
    expect(req.request.params.has('barcode')).toBe(false);
    expect(req.request.params.has('catno')).toBe(false);
    expect(req.request.params.has('title')).toBe(false);
    req.flush([sampleCandidate]);

    await expect(promise).resolves.toEqual([sampleCandidate]);
  });

  it('search() includes every provided field', async () => {
    const promise = service.search({
      barcode: '5099902956429',
      catno: 'NODATA 02',
      artist: 'Radiohead',
      title: 'OK Computer',
    });

    const req = httpMock.expectOne(
      (r) => r.url === `${API_URL}/import/discogs/search` && r.method === 'GET',
    );
    expect(req.request.params.get('barcode')).toBe('5099902956429');
    expect(req.request.params.get('catno')).toBe('NODATA 02');
    expect(req.request.params.get('artist')).toBe('Radiohead');
    expect(req.request.params.get('title')).toBe('OK Computer');
    req.flush([]);

    await promise;
  });

  it('importRelease() GETs the release-specific import endpoint', async () => {
    const promise = service.importRelease(249504);

    const req = httpMock.expectOne(`${API_URL}/import/discogs/249504`);
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);
    req.flush(sampleImportedVinyl);

    await expect(promise).resolves.toEqual(sampleImportedVinyl);
  });

  it('rejects when the backend responds with an error status', async () => {
    const promise = service.importRelease(999999);

    const req = httpMock.expectOne(`${API_URL}/import/discogs/999999`);
    req.flush({ message: 'Discogs release not found' }, { status: 404, statusText: 'Not Found' });

    await expect(promise).rejects.toBeTruthy();
  });
});
