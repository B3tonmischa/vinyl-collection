import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVinylDto } from './dto/create-vinyl.dto';
import { UpdateVinylDto } from './dto/update-vinyl.dto';
import { Prisma } from '../../generated/prisma/client';

// Shared shape for every read that returns a full vinyl record: album-level
// artists, tracks with their own (possibly overridden) artists, and only
// the images that haven't been soft-deleted.
const DETAIL_INCLUDE = {
  artists: { include: { artist: true } },
  tracks: {
    include: { artists: { include: { artist: true } } },
    orderBy: { position: 'asc' },
  },
  images: { where: { deletedAt: null } },
} satisfies Prisma.VinylInclude;

type VinylWithRelations = Prisma.VinylGetPayload<{ include: typeof DETAIL_INCLUDE }>;

// Flattens the join-table rows into plain artist lists, and resolves each
// track's *effective* artists per the inherit-unless-overridden rule: an
// empty per-track override list means it inherits the vinyl's own artists.
function toVinylResponse(vinyl: VinylWithRelations) {
  const artists = vinyl.artists.map((va) => va.artist);
  return {
    ...vinyl,
    artists,
    tracks: vinyl.tracks
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((track) => {
        const overrideArtists = track.artists.map((ta) => ta.artist);
        return {
          id: track.id,
          vinylId: track.vinylId,
          position: track.position,
          title: track.title,
          side: track.side,
          artists: overrideArtists,
          effectiveArtists: overrideArtists.length > 0 ? overrideArtists : artists,
        };
      }),
  };
}

// Builds a safe FTS5 MATCH expression from free-text user input: pulls out
// word-ish tokens (letters/digits, any script) and drops everything else,
// so punctuation with special meaning to FTS5 ("-", '"', "*", ":", ...)
// can't produce a syntax error. Each token is quoted (a valid FTS5 phrase)
// and suffixed with `*` for prefix matching, e.g. "radioh" -> `"radioh"*`.
// Returns null when there's nothing searchable left (e.g. input was pure
// punctuation).
function buildFtsMatchQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token}"*`).join(' ');
}

@Injectable()
export class VinylsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) {
    if (search) {
      return this.search(search);
    }
    const vinyls = await this.prisma.vinyl.findMany({
      where: { deletedAt: null },
      include: DETAIL_INCLUDE,
      orderBy: [{ title: 'asc' }, { year: 'asc' }],
    });
    return vinyls.map(toVinylResponse);
  }

  // Full-text search backed by the vinyl_search FTS5 virtual table (see
  // prisma/migrations/20260917213500_add_fts5_search). Matches on
  // title/label/artist names (album-level and effective per-track)/track
  // titles; genre and notes are deliberately not indexed. Soft-deleted
  // vinyls are already absent from the index (the sync triggers only ever
  // (re)insert a row when deletedAt IS NULL), so no extra filtering is
  // needed here beyond the belt-and-suspenders `deletedAt: null` below.
  async search(query: string) {
    const matchQuery = buildFtsMatchQuery(query);
    if (!matchQuery) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<{ rowid: number }[]>(
      Prisma.sql`SELECT rowid FROM vinyl_search WHERE vinyl_search MATCH ${matchQuery} ORDER BY rank`,
    );
    const orderedIds = rows.map((row) => row.rowid);
    if (orderedIds.length === 0) {
      return [];
    }

    const vinyls = await this.prisma.vinyl.findMany({
      where: { id: { in: orderedIds }, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    vinyls.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return vinyls.map(toVinylResponse);
  }

  async findOne(id: number) {
    const vinyl = await this.prisma.vinyl.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!vinyl) {
      throw new NotFoundException(`Vinyl ${id} not found`);
    }
    return toVinylResponse(vinyl);
  }

  // Internal-only lookup that does NOT filter out soft-deleted rows — used
  // by remove()/restore() which need to see current deletedAt state.
  private async findRawById(id: number) {
    const vinyl = await this.prisma.vinyl.findUnique({ where: { id } });
    if (!vinyl) {
      throw new NotFoundException(`Vinyl ${id} not found`);
    }
    return vinyl;
  }

  async create(dto: CreateVinylDto) {
    const { artistIds, tracks, ...scalars } = dto;
    try {
      const vinyl = await this.prisma.vinyl.create({
        data: {
          ...scalars,
          artists: artistIds?.length
            ? { create: artistIds.map((artistId) => ({ artistId })) }
            : undefined,
          tracks: tracks?.length
            ? {
                create: tracks.map((track) => ({
                  position: track.position,
                  title: track.title,
                  side: track.side,
                  artists: track.artistIds?.length
                    ? { create: track.artistIds.map((artistId) => ({ artistId })) }
                    : undefined,
                })),
              }
            : undefined,
        },
        include: DETAIL_INCLUDE,
      });
      return toVinylResponse(vinyl);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async update(id: number, dto: UpdateVinylDto) {
    await this.findRawById(id); // throws 404 if missing (deleted or not — see note in remove())
    const { artistIds, tracks, ...scalars } = dto;
    try {
      const vinyl = await this.prisma.vinyl.update({
        where: { id },
        data: {
          ...scalars,
          artists:
            artistIds !== undefined
              ? { deleteMany: {}, create: artistIds.map((artistId) => ({ artistId })) }
              : undefined,
          tracks:
            tracks !== undefined
              ? {
                  deleteMany: {},
                  create: tracks.map((track) => ({
                    position: track.position,
                    title: track.title,
                    side: track.side,
                    artists: track.artistIds?.length
                      ? { create: track.artistIds.map((artistId) => ({ artistId })) }
                      : undefined,
                  })),
                }
              : undefined,
        },
        include: DETAIL_INCLUDE,
      });
      return toVinylResponse(vinyl);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  // Soft delete: sets deletedAt instead of removing the row. All reads
  // (list/detail/search) filter deletedAt: null, so this just hides it.
  async remove(id: number) {
    const vinyl = await this.findRawById(id);
    if (vinyl.deletedAt) {
      // Already gone from every read path — treat like "not found",
      // matching the plan's undo-only (no trash view) model.
      throw new NotFoundException(`Vinyl ${id} not found`);
    }
    await this.prisma.vinyl.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // Clears deletedAt. Only meaningful for a vinyl that's currently
  // soft-deleted — restoring one that isn't is treated as "not found",
  // since there's nothing to undo.
  async restore(id: number) {
    const vinyl = await this.findRawById(id);
    if (!vinyl.deletedAt) {
      throw new NotFoundException(`Vinyl ${id} is not deleted`);
    }
    const restored = await this.prisma.vinyl.update({
      where: { id },
      data: { deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    return toVinylResponse(restored);
  }

  // A bad artistId (one that doesn't exist) trips the VinylArtist/TrackArtist
  // foreign key constraint — that's a client mistake (400), not a server
  // error (500).
  private mapWriteError(err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    ) {
      return new BadRequestException(
        'One or more artistIds do not refer to an existing artist',
      );
    }
    return err;
  }
}
