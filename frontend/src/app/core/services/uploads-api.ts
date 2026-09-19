import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from './api-config';
import { IMAGE_KIND_SLUGS, ImageKind, VinylImage } from '../../models/vinyl.model';

@Service()
export class UploadsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiConfig = inject(ApiConfigService);

  upload(vinylId: number, kind: ImageKind, discNumber: number, file: File): Promise<VinylImage> {
    const formData = new FormData();
    formData.append('file', file);
    const slug = IMAGE_KIND_SLUGS[kind];
    return firstValueFrom(
      this.http.post<VinylImage>(
        `${this.apiConfig.apiUrl}/vinyls/${vinylId}/images/${slug}?discNumber=${discNumber}`,
        formData,
        { withCredentials: true },
      ),
    );
  }

  delete(vinylId: number, kind: ImageKind, discNumber: number): Promise<void> {
    const slug = IMAGE_KIND_SLUGS[kind];
    return firstValueFrom(
      this.http.delete<void>(
        `${this.apiConfig.apiUrl}/vinyls/${vinylId}/images/${slug}?discNumber=${discNumber}`,
        { withCredentials: true },
      ),
    );
  }

  restore(vinylId: number, kind: ImageKind, discNumber: number): Promise<void> {
    const slug = IMAGE_KIND_SLUGS[kind];
    return firstValueFrom(
      this.http.post<void>(
        `${this.apiConfig.apiUrl}/vinyls/${vinylId}/images/${slug}/restore?discNumber=${discNumber}`,
        null,
        { withCredentials: true },
      ),
    );
  }
}
