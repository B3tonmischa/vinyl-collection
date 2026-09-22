import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';
import { DiscogsClient } from '../src/import/discogs-client';
import { DiscogsRelease, DiscogsSearchResponse } from '../src/import/discogs.types';

// A minimal valid 1x1 transparent PNG — real bytes, so sharp (the same
// pipeline a manual upload goes through, per uploads.service.ts) can
// actually decode/resize/re-encode it as WebP, rather than a fake buffer
// that would only prove the endpoint was *called*.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function fakeDiscogsClient() {
  return {
    search: jest.fn<Promise<DiscogsSearchResponse>, any>(),
    getRelease: jest.fn<Promise<DiscogsRelease>, any>(),
    downloadImage: jest.fn<Promise<Buffer>, any>().mockResolvedValue(ONE_PIXEL_PNG),
  };
}

const SEARCH_FIXTURE: DiscogsSearchResponse = {
  results: [
    {
      id: 249504,
      title: 'Radiohead - OK Computer',
      year: 1997,
      country: 'UK',
      format: ['Vinyl', 'LP', 'Album'],
      label: ['Parlophone'],
      catno: 'NODATA 02',
      thumb: 'https://img.discogs.com/thumb.jpg',
    },
  ],
};

function releaseFixture(overrides: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return {
    id: 249504,
    title: 'OK Computer',
    year: 1997,
    artists: [{ id: 1, name: 'Radiohead' }],
    labels: [{ name: 'Parlophone', catno: 'NODATA 02' }],
    formats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album', '12"', '33 ⅓ RPM'] }],
    genres: ['Rock'],
    styles: ['Alternative Rock'],
    tracklist: [
      { position: 'A1', type_: 'track', title: 'Airbag' },
      { position: 'A2', type_: 'track', title: 'Paranoid Android' },
      // A track with a genuinely different credited artist than the album.
      {
        position: 'B1',
        type_: 'track',
        title: 'Fitter Happier (feat. Guest)',
        artists: [{ id: 2, name: 'Guest Vocalist' }],
      },
      // A non-track heading row that must not become a spurious track.
      { position: '', type_: 'heading', title: 'Bonus' },
    ],
    images: [
      { type: 'primary', uri: 'https://img.discogs.com/primary.jpg' },
      { type: 'secondary', uri: 'https://img.discogs.com/secondary-1.jpg' },
    ],
    ...overrides,
  };
}

describe('Discogs import', () => {
  let ctx: TestAppContext;
  let admin: ReturnType<typeof request.agent>;
  let discogs: ReturnType<typeof fakeDiscogsClient>;

  beforeAll(async () => {
    discogs = fakeDiscogsClient();
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(DiscogsClient).useValue(discogs),
    );
    admin = request.agent(ctx.httpServer);
    await admin
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);
  });

  afterEach(() => {
    discogs.search.mockReset();
    discogs.getRelease.mockReset();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('auth gating', () => {
    it('rejects search without a session', async () => {
      await request(ctx.httpServer).get('/import/discogs/search').query({ artist: 'x' }).expect(401);
    });

    it('rejects import without a session', async () => {
      await request(ctx.httpServer).get('/import/discogs/249504').expect(401);
    });
  });

  describe('GET /import/discogs/search', () => {
    it('400s when no search field is provided at all', async () => {
      await admin.get('/import/discogs/search').expect(400);
      expect(discogs.search).not.toHaveBeenCalled();
    });

    it('proxies to Discogs and normalizes the candidate list', async () => {
      discogs.search.mockResolvedValue(SEARCH_FIXTURE);

      const res = await admin.get('/import/discogs/search').query({ artist: 'Radiohead' }).expect(200);

      expect(discogs.search).toHaveBeenCalledWith(
        expect.objectContaining({ artist: 'Radiohead' }),
      );
      expect(res.body).toEqual([
        {
          discogsReleaseId: 249504,
          title: 'Radiohead - OK Computer',
          year: 1997,
          formats: ['Vinyl', 'LP', 'Album'],
          country: 'UK',
          catalogNumber: 'NODATA 02',
          label: 'Parlophone',
          thumbnailUrl: 'https://img.discogs.com/thumb.jpg',
        },
      ]);
    });

    it('handles zero results', async () => {
      discogs.search.mockResolvedValue({ results: [] });
      const res = await admin.get('/import/discogs/search').query({ barcode: '000' }).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /import/discogs/:releaseId', () => {
    it('creates a real, fully editable vinyl record with artists, tracks, format mapping, and images resolved', async () => {
      discogs.getRelease.mockResolvedValue(releaseFixture());

      const res = await admin.get('/import/discogs/249504').expect(200);

      expect(res.body).toMatchObject({
        title: 'OK Computer',
        year: 1997,
        label: 'Parlophone',
        catalogNumber: 'NODATA 02',
        releaseType: 'LP',
        discSize: 'TWELVE_INCH',
        speed: 'RPM_33',
        genre: 'Rock, Alternative Rock',
        discogsReleaseUrl: 'https://www.discogs.com/release/249504',
      });
      expect(res.body.artists).toEqual([{ id: expect.any(Number), name: 'Radiohead' }]);

      // Heading row dropped; three real tracks kept in running order.
      expect(res.body.tracks).toHaveLength(3);
      expect(res.body.tracks.map((t: any) => t.title)).toEqual([
        'Airbag',
        'Paranoid Android',
        'Fitter Happier (feat. Guest)',
      ]);
      expect(res.body.tracks[0]).toMatchObject({ side: 'A', artists: [] });
      // The track with a genuinely different Discogs-credited artist gets a
      // real override; the other two inherit (empty artists array).
      expect(res.body.tracks[2].artists).toEqual([{ id: expect.any(Number), name: 'Guest Vocalist' }]);
      expect(res.body.tracks[2].effectiveArtists).toEqual([
        { id: expect.any(Number), name: 'Guest Vocalist' },
      ]);

      // Images went through the real upload pipeline (Sharp resize + WebP),
      // not just a call count — same shape a manual upload produces.
      expect(res.body.images).toHaveLength(2);
      expect(res.body.images.map((i: any) => i.kind).sort()).toEqual(['COVER_BACK', 'COVER_FRONT']);
      expect(discogs.downloadImage).toHaveBeenCalledWith('https://img.discogs.com/primary.jpg');
      expect(discogs.downloadImage).toHaveBeenCalledWith('https://img.discogs.com/secondary-1.jpg');

      // The record is real and shows up through the normal read path too.
      await request(ctx.httpServer).get(`/vinyls/${res.body.id}`).expect(200);
    });

    it('omits a track override when its Discogs-credited artist matches the album artist(s)', async () => {
      discogs.getRelease.mockResolvedValue(
        releaseFixture({
          tracklist: [
            {
              position: 'A1',
              type_: 'track',
              title: 'Same Artist Track',
              artists: [{ id: 1, name: 'Radiohead' }],
            },
          ],
        }),
      );

      const res = await admin.get('/import/discogs/249504').expect(200);
      expect(res.body.tracks[0].artists).toEqual([]);
      expect(res.body.tracks[0].effectiveArtists).toEqual(res.body.artists);
    });

    it('folds a track-scoped "Featuring" extraartists credit into the album artist(s) as the track override (KAN-13)', async () => {
      // Mirrors Discogs release 895621 (Santana - Supernatural): every
      // track's own artists[] is empty, and the guest artist only appears
      // in extraartists with role "Featuring"/"Vocals".
      discogs.getRelease.mockResolvedValue(
        releaseFixture({
          artists: [{ id: 1, name: 'Santana' }],
          tracklist: [
            { position: 'A1', type_: 'track', title: 'Da Le Yaleo' },
            {
              position: 'A2',
              type_: 'track',
              title: 'Love Of My Life',
              extraartists: [{ id: 20, name: 'Dave Matthews', role: 'Featuring' }],
            },
            {
              position: 'B1',
              type_: 'track',
              title: 'Smooth',
              extraartists: [{ id: 21, name: 'Rob Thomas', role: 'Vocals' }],
            },
          ],
        }),
      );

      const res = await admin.get('/import/discogs/249504').expect(200);

      expect(res.body.artists).toEqual([{ id: expect.any(Number), name: 'Santana' }]);

      // No featuring credit: inherits, same as before.
      expect(res.body.tracks[0].artists).toEqual([]);
      expect(res.body.tracks[0].effectiveArtists).toEqual(res.body.artists);

      // Featuring credit with no own artists[]: override includes BOTH the
      // album artist and the guest, not just the guest.
      const santanaId = res.body.artists[0].id;
      expect(res.body.tracks[1].artists).toEqual(
        expect.arrayContaining([
          { id: santanaId, name: 'Santana' },
          { id: expect.any(Number), name: 'Dave Matthews' },
        ]),
      );
      expect(res.body.tracks[1].artists).toHaveLength(2);

      expect(res.body.tracks[2].artists).toEqual(
        expect.arrayContaining([
          { id: santanaId, name: 'Santana' },
          { id: expect.any(Number), name: 'Rob Thomas' },
        ]),
      );
      expect(res.body.tracks[2].artists).toHaveLength(2);
    });

    it('leaves releaseType/discSize/speed null when the format descriptions do not confidently match anything', async () => {
      discogs.getRelease.mockResolvedValue(
        releaseFixture({ formats: [{ name: 'Vinyl', descriptions: ['Limited Edition', 'Gatefold'] }] }),
      );

      const res = await admin.get('/import/discogs/249504').expect(200);
      expect(res.body).toMatchObject({ releaseType: null, discSize: null, speed: null });
    });

    it('reuses an existing artist case-insensitively instead of creating a near-duplicate', async () => {
      const existing = await admin.post('/artists').send({ name: 'RADIOHEAD' }).expect(201);

      discogs.getRelease.mockResolvedValue(releaseFixture());
      const res = await admin.get('/import/discogs/249504').expect(200);

      expect(res.body.artists).toEqual([{ id: existing.body.id, name: 'Radiohead' }]);
    });

    it('strips a Discogs disambiguation suffix like " (2)" from an artist name', async () => {
      discogs.getRelease.mockResolvedValue(
        releaseFixture({ artists: [{ id: 5, name: 'Charles Watson (2)' }] }),
      );
      const res = await admin.get('/import/discogs/249504').expect(200);
      expect(res.body.artists).toEqual([{ id: expect.any(Number), name: 'Charles Watson' }]);
    });

    it('continues the import when one image fails to download', async () => {
      discogs.getRelease.mockResolvedValue(releaseFixture());
      discogs.downloadImage
        .mockRejectedValueOnce(new Error('CDN hiccup'))
        .mockResolvedValueOnce(ONE_PIXEL_PNG);

      const res = await admin.get('/import/discogs/249504').expect(200);
      expect(res.body.images).toHaveLength(1);
    });
  });
});
