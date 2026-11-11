import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DiscogsRelease, DiscogsSearchResponse } from './discogs.types';

const DISCOGS_API_BASE = 'https://api.discogs.com';

/** How long Discogs gets to answer before the request is given up on. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Same cap as a manual upload (see uploads.controller.ts). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// Image URLs come out of a Discogs API response, not from this app, so
// they're only followed when they point back at Discogs over HTTPS.
function isDiscogsImageUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'discogs.com' || url.hostname.endsWith('.discogs.com'))
    );
  } catch {
    return false;
  }
}

export interface DiscogsSearchParams {
  barcode?: string;
  catno?: string;
  artist?: string;
  title?: string;
}

/**
 * Thin wrapper around Discogs's HTTP API. Kept as its own injectable
 * (rather than inlining fetch calls into ImportService) specifically so
 * tests can override this one provider with a fake — see
 * test/utils/create-test-app.ts's `configure` hook and
 * test/import.e2e-spec.ts — instead of mocking the global `fetch` or
 * adding a new HTTP-mocking dependency (e.g. nock) for one module.
 *
 * Uses Node's built-in `fetch` (Node >=20, already this project's engines
 * floor — see package.json) rather than adding an HTTP client dependency
 * (axios/@nestjs/axios): this is the only place in the backend that makes
 * an outbound HTTP call, so a dedicated client wasn't worth one.
 *
 * Reads DISCOGS_TOKEN/DISCOGS_USER_AGENT straight off process.env, same as
 * every other piece of config in this backend (see auth.service.ts,
 * uploads.service.ts's getUploadsRoot(), main.ts) — nothing here injects
 * @nestjs/config's ConfigService, so this follows suit rather than
 * introducing a second config-reading convention.
 */
@Injectable()
export class DiscogsClient {
  private get token(): string {
    const token = process.env.DISCOGS_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException(
        'DISCOGS_TOKEN is not configured on the backend. Add a personal access token ' +
          '(from discogs.com/settings/developers) to backend/.env before importing from Discogs.',
      );
    }
    return token;
  }

  private get userAgent(): string {
    // Discogs requires a descriptive User-Agent on every request; a
    // fallback is provided so a missing env var degrades to "it works, but
    // impolitely" rather than failing outright.
    return process.env.DISCOGS_USER_AGENT || 'VinylArchive/1.0';
  }

  async search(params: DiscogsSearchParams): Promise<DiscogsSearchResponse> {
    const url = new URL(`${DISCOGS_API_BASE}/database/search`);
    url.searchParams.set('type', 'release');
    if (params.barcode) url.searchParams.set('barcode', params.barcode);
    if (params.catno) url.searchParams.set('catno', params.catno);
    if (params.artist) url.searchParams.set('artist', params.artist);
    // Discogs's own query param is `release_title`, not `title`.
    if (params.title) url.searchParams.set('release_title', params.title);
    return this.request<DiscogsSearchResponse>(url);
  }

  async getRelease(releaseId: number): Promise<DiscogsRelease> {
    const url = new URL(`${DISCOGS_API_BASE}/releases/${releaseId}`);
    return this.request<DiscogsRelease>(url);
  }

  async downloadImage(uri: string): Promise<Buffer> {
    if (!isDiscogsImageUrl(uri)) {
      throw new BadGatewayException('Discogs returned an image URL outside discogs.com');
    }
    return this.withTimeout(async (signal) => {
      const res = await fetch(uri, { headers: { 'User-Agent': this.userAgent }, signal });
      if (!res.ok) {
        throw new BadGatewayException(`Failed to download image from Discogs (HTTP ${res.status})`);
      }
      if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
        throw new BadGatewayException('Discogs image is too large');
      }
      // content-length can be absent or wrong, so the body is counted too.
      const chunks: Uint8Array[] = [];
      let received = 0;
      for await (const chunk of res.body ?? []) {
        received += chunk.byteLength;
        if (received > MAX_IMAGE_BYTES) {
          throw new BadGatewayException('Discogs image is too large');
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    });
  }

  private async request<T>(url: URL): Promise<T> {
    // The token goes in a header rather than a `token` query parameter, so
    // it never ends up in a URL that a proxy or an error message might log.
    const headers = {
      'User-Agent': this.userAgent,
      Authorization: `Discogs token=${this.token}`,
    };
    return this.withTimeout(async (signal) => {
      const res = await fetch(url, { headers, signal });
      return this.parse<T>(res);
    });
  }

  // Runs one outbound call with a deadline, and turns a timeout or a
  // network failure into a gateway error instead of a bare 500.
  private async withTimeout<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await call(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if ((err as Error).name === 'TimeoutError') {
        throw new GatewayTimeoutException('Discogs did not answer in time');
      }
      throw new BadGatewayException('Could not reach Discogs');
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 404) {
      throw new NotFoundException('Discogs release not found');
    }
    if (!res.ok) {
      // Covers rate limiting (429) too — a single-admin app doing one
      // import at a time never comes close to Discogs's 60/min budget, so
      // there's no special retry/backoff here, just a clear surfaced error.
      throw new BadGatewayException(`Discogs API error (HTTP ${res.status})`);
    }
    return (await res.json()) as T;
  }
}
