import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Artist } from '../../models/vinyl.model';
import { environment } from '../../../environments/environment';
import { ArtistsApiService } from './artists-api';

const API_URL = environment.apiUrl;

describe('ArtistsApiService', () => {
  let service: ArtistsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ArtistsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('create() posts the artist name and resolves with the created artist', async () => {
    const promise = service.create('Pink Floyd');

    const req = httpMock.expectOne(`${API_URL}/artists`);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({ name: 'Pink Floyd' });

    const created: Artist = { id: 7, name: 'Pink Floyd' };
    req.flush(created);

    await expect(promise).resolves.toEqual(created);
  });

  it('rejects when the backend responds with an error status', async () => {
    const promise = service.create('Pink Floyd');

    const req = httpMock.expectOne(`${API_URL}/artists`);
    req.flush({ message: 'Conflict' }, { status: 409, statusText: 'Conflict' });

    await expect(promise).rejects.toBeTruthy();
  });
});
