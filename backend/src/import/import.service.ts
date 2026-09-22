import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ArtistsService } from '../artists/artists.service';
import { VinylsService } from '../vinyls/vinyls.service';
import { UploadsService, ImageKindSlug } from '../uploads/uploads.service';
import { CreateVinylDto } from '../vinyls/dto/create-vinyl.dto';
import { DiscogsClient, DiscogsSearchParams } from './discogs-client';
import { mapDiscogsFormats } from './discogs-format-mapping';
import { parseDiscogsTracklist } from './discogs-track-parser';
import { DiscogsImage } from './discogs.types';

export interface DiscogsSearchCandidate {
  discogsReleaseId: number;
  /** Discogs's own combined "Artist – Title" search-result title — see discogs.types.ts. */
  title: string;
  year: number | null;
  formats: string[];
  country: string | null;
  catalogNumber: string | null;
  label: string | null;
  thumbnailUrl: string | null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// Discogs appends " (2)", " (3)", etc. to an artist's name when another
// artist already has that exact name, purely to disambiguate within
// Discogs's own database — it's not part of the artist's actual name.
function stripDisambiguator(name: string): string {
  return name.replace(/\s\(\d+\)$/, '').trim();
}

function nameSet(names: string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}

// Best-effort, deterministic slot assignment for a release's images (see
// discogs-import-feature-plan.md open question #1 and its "expect this
// mapping to be unreliable" caveat): Discogs's API only distinguishes
// "primary" vs. "secondary" images and doesn't say which secondary image is
// the back cover vs. an inner sleeve vs. a disc photo. This fills the app's
// six slots in a fixed order (primary first, then secondaries as they come)
// and leaves reassigning/removing to the admin afterward via the existing
// ImageUploadPanel — the same UI a manual upload uses.
const IMAGE_SLOT_ORDER: ImageKindSlug[] = [
  'cover-front',
  'cover-back',
  'inner-sleeve-a',
  'inner-sleeve-b',
  'disc-side-a',
  'disc-side-b',
];

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly discogsClient: DiscogsClient,
    private readonly artistsService: ArtistsService,
    private readonly vinylsService: VinylsService,
    private readonly uploadsService: UploadsService,
  ) {}

  async search(params: DiscogsSearchParams): Promise<DiscogsSearchCandidate[]> {
    if (!params.barcode && !params.catno && !params.artist && !params.title) {
      throw new BadRequestException(
        'Provide at least one of barcode, catno, artist, or title to search Discogs',
      );
    }
    const response = await this.discogsClient.search(params);
    return response.results.map((r) => ({
      discogsReleaseId: r.id,
      title: r.title,
      year: r.year ?? null,
      formats: r.format ?? [],
      country: r.country ?? null,
      catalogNumber: r.catno ?? null,
      label: r.label?.[0] ?? null,
      thumbnailUrl: r.thumb || r.cover_image || null,
    }));
  }

  /**
   * Fetches a Discogs release and imports it as a brand-new, fully
   * editable Vinyl record — including downloading and saving its images
   * through the existing upload pipeline.
   *
   * Deviation from the original draft plan, worth flagging explicitly (see
   * discogs-import-implementation-status.md): the plan described this
   * endpoint as returning "a normalized draft payload... does not write
   * anything to the database", with the frontend feeding that draft into a
   * blank /admin/new form. That's incompatible with the accepted answer to
   * open question #1 (fetch-and-upload images immediately) once you look at
   * how images are actually stored: UploadsService.saveImage() requires an
   * existing vinylId to attach to (see uploads.service.ts) — there's no
   * slot to upload into before a Vinyl row exists. So this method creates
   * the Vinyl row (and its artists/tracks) up front, then attaches images
   * to that real id, then returns the full persisted record. The frontend
   * therefore routes to the *edit* page for the new id rather than a blank
   * "new" form — see discogs-import-dialog.ts / admin-shell.ts. The
   * accepted orphan-row risk from question #1 (an abandoned import leaves a
   * real, unreviewed Vinyl row + images behind) is exactly this — undoing
   * it is just deleting the record via the normal delete button.
   */
  async importRelease(releaseId: number) {
    const release = await this.discogsClient.getRelease(releaseId);

    const albumArtists = await this.resolveArtists(release.artists ?? []);
    const albumArtistNames = nameSet(albumArtists.map((a) => a.name));

    const { releaseType, discSize, speed } = mapDiscogsFormats(release.formats ?? []);

    const labelEntry = release.labels?.[0];
    const label = labelEntry?.name ? truncate(labelEntry.name, 200) : undefined;
    const rawCatno = labelEntry?.catno?.trim();
    const catalogNumber =
      rawCatno && rawCatno.toLowerCase() !== 'none' ? truncate(rawCatno, 100) : undefined;

    // The app models a single freeform `genre` field (see
    // architecture-and-data-model.md #2 — descriptive tags were explicitly
    // scoped out), so Discogs's separate genres[]/styles[] (broad vs.
    // narrow classification) are just joined into one string here.
    const genreText = [...(release.genres ?? []), ...(release.styles ?? [])].join(', ');
    const genre = genreText ? truncate(genreText, 100) : undefined;

    const year = release.year && release.year >= 1850 ? release.year : undefined;

    const parsedTracks = parseDiscogsTracklist(release.tracklist ?? []);
    const tracks: NonNullable<CreateVinylDto['tracks']> = [];
    for (const track of parsedTracks) {
      let artistIds: number[] | undefined;
      if (track.artistNames || track.featuringArtistNames) {
        // A track's own `artists[]` (when present) replaces the album's
        // artists, same as before. But Discogs typically leaves `artists[]`
        // empty for a featuring credit and puts it in `extraartists[]`
        // instead (see discogs-track-parser.ts / KAN-13) — in that case the
        // track still inherits the album's own artist(s), so fold those in
        // as the base rather than losing them under just the guest.
        const ownArtists = track.artistNames
          ? await this.resolveArtists(track.artistNames.map((name) => ({ name })))
          : albumArtists;
        const featuringArtists = track.featuringArtistNames
          ? await this.resolveArtists(track.featuringArtistNames.map((name) => ({ name })))
          : [];
        const merged = new Map<string, { id: number; name: string }>();
        for (const artist of [...ownArtists, ...featuringArtists]) {
          merged.set(artist.name.toLowerCase(), artist);
        }
        const trackArtists = [...merged.values()];
        const trackNames = nameSet(trackArtists.map((a) => a.name));
        const matchesAlbum =
          trackNames.size === albumArtistNames.size &&
          [...trackNames].every((n) => albumArtistNames.has(n));
        // Only populate artistIds when it's a real override — a track
        // whose Discogs-credited artists happen to match the album's own
        // is left to inherit, per the app's existing zero-rows-means-
        // inherit semantics (architecture-and-data-model.md #3).
        if (!matchesAlbum) {
          artistIds = trackArtists.map((a) => a.id);
        }
      }
      tracks.push({
        position: track.position,
        title: truncate(track.title, 300),
        side: track.side ? truncate(track.side, 10) : undefined,
        artistIds,
      });
    }

    const dto: CreateVinylDto = {
      title: truncate(release.title, 300),
      year,
      label,
      catalogNumber,
      releaseType: releaseType ?? undefined,
      discSize: discSize ?? undefined,
      speed: speed ?? undefined,
      genre,
      artistIds: albumArtists.map((a) => a.id),
      tracks,
    };

    const created = await this.vinylsService.create(dto);

    await this.importImages(created.id, release.images ?? []);

    const finalVinyl = await this.vinylsService.findOne(created.id);
    return {
      ...finalVinyl,
      discogsReleaseUrl: `https://www.discogs.com/release/${releaseId}`,
    };
  }

  // Resolves a list of Discogs artist credits to this app's own Artist
  // rows, reusing ArtistsService.findOrCreate() for dedup (never
  // reimplemented here — see architecture-and-data-model.md #3) and
  // de-duplicating within this one call (case-insensitively) so the same
  // credit appearing twice on one release doesn't round-trip the DB twice.
  private async resolveArtists(
    credits: { name: string }[],
  ): Promise<{ id: number; name: string }[]> {
    const seen = new Map<string, { id: number; name: string }>();
    for (const credit of credits) {
      const name = stripDisambiguator(credit.name);
      // "Various" is Discogs's own placeholder artist for compilations with
      // no single act, not a real artist worth creating a row for.
      if (!name || name.toLowerCase() === 'various') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const artist = await this.artistsService.findOrCreate(name);
      seen.set(key, artist);
    }
    return [...seen.values()];
  }

  private async importImages(vinylId: number, images: DiscogsImage[]): Promise<void> {
    const ordered = [...images].sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === 'primary' ? -1 : 1;
    });

    for (let i = 0; i < ordered.length && i < IMAGE_SLOT_ORDER.length; i++) {
      const kindSlug = IMAGE_SLOT_ORDER[i];
      const image = ordered[i];
      try {
        const buffer = await this.discogsClient.downloadImage(image.uri);
        await this.uploadsService.saveImage(vinylId, kindSlug, { buffer } as Express.Multer.File, 1);
      } catch (err) {
        // One failed image (a dead link, a transient CDN hiccup) shouldn't
        // abort the rest of the import — the admin can upload that slot
        // manually afterward, same as any other manual edit.
        this.logger.warn(
          `Failed to import Discogs image ${image.uri} for vinyl ${vinylId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
