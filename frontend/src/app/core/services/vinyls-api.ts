import { Service, Signal, inject } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from './api-config';
import { Vinyl, VinylPayload } from '../../models/vinyl.model';

/**
 * Reads go through httpResource (eager, auto-refetch on signal changes).
 * Mutations go through plain HttpClient. There is no client-side cache
 * invalidation layer — callers explicitly call `.reload()` on the relevant
 * resource after a mutation succeeds.
 */
@Service()
export class VinylsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiConfig = inject(ApiConfigService);

  listResource(query: Signal<string>) {
    return httpResource<Vinyl[]>(
      () => `${this.apiConfig.apiUrl}/vinyls?q=${encodeURIComponent(query())}`,
      { defaultValue: [] },
    );
  }

  detailResource(id: Signal<number | null | undefined>) {
    return httpResource<Vinyl | undefined>(() => {
      const vinylId = id();
      return vinylId == null ? undefined : `${this.apiConfig.apiUrl}/vinyls/${vinylId}`;
    });
  }

  create(payload: VinylPayload): Promise<Vinyl> {
    return firstValueFrom(
      this.http.post<Vinyl>(`${this.apiConfig.apiUrl}/vinyls`, payload, { withCredentials: true }),
    );
  }

  update(id: number, payload: VinylPayload): Promise<Vinyl> {
    return firstValueFrom(
      this.http.patch<Vinyl>(`${this.apiConfig.apiUrl}/vinyls/${id}`, payload, {
        withCredentials: true,
      }),
    );
  }

  softDelete(id: number): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.apiConfig.apiUrl}/vinyls/${id}`, { withCredentials: true }),
    );
  }

  restore(id: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.apiConfig.apiUrl}/vinyls/${id}/restore`, null, {
        withCredentials: true,
      }),
    );
  }
}
