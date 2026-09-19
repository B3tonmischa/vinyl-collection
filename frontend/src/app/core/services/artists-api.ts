import { Service, Signal, inject } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from './api-config';
import { Artist } from '../../models/vinyl.model';

@Service()
export class ArtistsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiConfig = inject(ApiConfigService);

  searchResource(query: Signal<string>) {
    return httpResource<Artist[]>(
      () => `${this.apiConfig.apiUrl}/artists?q=${encodeURIComponent(query())}`,
      { defaultValue: [] },
    );
  }

  create(name: string): Promise<Artist> {
    return firstValueFrom(
      this.http.post<Artist>(`${this.apiConfig.apiUrl}/artists`, { name }, { withCredentials: true }),
    );
  }
}
