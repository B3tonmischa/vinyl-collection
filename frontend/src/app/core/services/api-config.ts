import { Service } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Single point of configuration for the backend's base URL. */
@Service()
export class ApiConfigService {
  readonly apiUrl = environment.apiUrl;

  /**
   * Builds a servable URL for a scan file under GET /uploads/:vinylId/:filename.
   * Takes only the basename of the stored path, so it doesn't matter whether
   * the backend stored an absolute disk path, a relative one, or a bare
   * filename — or which OS (the backend may run on Windows) wrote it.
   */
  uploadUrl(vinylId: number, storedPath: string): string {
    const filename = storedPath.split(/[\\/]/).pop() ?? storedPath;
    return `${this.apiUrl}/uploads/${vinylId}/${filename}`;
  }
}
