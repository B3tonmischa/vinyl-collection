import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from './api-config';
import { Vinyl } from '../../models/vinyl.model';
import { DiscogsSearchCandidate, DiscogsSearchQuery } from '../../models/discogs.model';

/**
 * What GET /import/discogs/:releaseId actually returns: per the deviation
 * documented in discogs-import-implementation-status.md, importing a
 * release creates a real, persisted Vinyl (images already attached) rather
 * than a non-persisted draft — so this is a full Vinyl, plus the Discogs
 * release link for attribution.
 */
export interface ImportedVinyl extends Vinyl {
  discogsReleaseUrl: string | null;
}

@Service()
export class DiscogsImportApiService {
  private readonly http = inject(HttpClient);
  private readonly apiConfig = inject(ApiConfigService);

  search(query: DiscogsSearchQuery): Promise<DiscogsSearchCandidate[]> {
    let params = new HttpParams();
    if (query.barcode) params = params.set('barcode', query.barcode);
    if (query.catno) params = params.set('catno', query.catno);
    if (query.artist) params = params.set('artist', query.artist);
    if (query.title) params = params.set('title', query.title);

    return firstValueFrom(
      this.http.get<DiscogsSearchCandidate[]>(`${this.apiConfig.apiUrl}/import/discogs/search`, {
        params,
        withCredentials: true,
      }),
    );
  }

  importRelease(discogsReleaseId: number): Promise<ImportedVinyl> {
    return firstValueFrom(
      this.http.get<ImportedVinyl>(`${this.apiConfig.apiUrl}/import/discogs/${discogsReleaseId}`, {
        withCredentials: true,
      }),
    );
  }
}
