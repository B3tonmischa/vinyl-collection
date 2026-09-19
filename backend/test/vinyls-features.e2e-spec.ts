import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';

describe('Vinyl new-feature behavior (format enums, artist inheritance, soft delete/restore)', () => {
  let ctx: TestAppContext;
  let admin: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = request.agent(ctx.httpServer);
    await admin
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createArtist(name: string): Promise<number> {
    const res = await admin.post('/artists').send({ name }).expect(201);
    return res.body.id;
  }

  describe('format enums', () => {
    it('accepts valid releaseType/discSize/speed values, all independently optional', async () => {
      const res = await admin
        .post('/vinyls')
        .send({ title: 'Format Test', releaseType: 'EP', speed: 'RPM_45' })
        .expect(201);

      expect(res.body).toMatchObject({
        releaseType: 'EP',
        speed: 'RPM_45',
        discSize: null,
      });

      const bare = await admin
        .post('/vinyls')
        .send({ title: 'No Format Fields' })
        .expect(201);
      expect(bare.body).toMatchObject({
        releaseType: null,
        discSize: null,
        speed: null,
      });
    });

    it('rejects each enum independently when given a bad value', async () => {
      await admin
        .post('/vinyls')
        .send({ title: 'X', releaseType: 'ALBUM' })
        .expect(400);
      await admin
        .post('/vinyls')
        .send({ title: 'X', discSize: 'TEN' })
        .expect(400);
      await admin
        .post('/vinyls')
        .send({ title: 'X', speed: '33' })
        .expect(400);
    });
  });

  describe('artist inheritance / override', () => {
    it('a track with no artistIds resolves to the album artists; one with artistIds resolves to exactly that set', async () => {
      const bandA = await createArtist('Band A');
      const bandB = await createArtist('Band B');
      const guest = await createArtist('Guest Vocalist');

      const created = await admin
        .post('/vinyls')
        .send({
          title: 'Split LP',
          artistIds: [bandA, bandB],
          tracks: [
            { position: 1, title: 'Shared Intro' }, // no override -> inherits [Band A, Band B]
            { position: 2, title: 'Band A Solo Track', artistIds: [bandA] }, // narrowed to just Band A
            {
              position: 3,
              title: 'Feature',
              artistIds: [bandA, guest],
            }, // override introduces an artist not on the album at all
          ],
        })
        .expect(201);

      const [track1, track2, track3] = created.body.tracks;

      expect(track1.artists).toEqual([]);
      expect(track1.effectiveArtists.map((a: { name: string }) => a.name).sort()).toEqual([
        'Band A',
        'Band B',
      ]);

      expect(track2.artists.map((a: { name: string }) => a.name)).toEqual(['Band A']);
      expect(track2.effectiveArtists.map((a: { name: string }) => a.name)).toEqual([
        'Band A',
      ]);

      expect(
        track3.artists.map((a: { name: string }) => a.name).sort(),
      ).toEqual(['Band A', 'Guest Vocalist']);
      expect(
        track3.effectiveArtists.map((a: { name: string }) => a.name).sort(),
      ).toEqual(['Band A', 'Guest Vocalist']);
    });

    it('replacing the tracks array on update fully replaces the previous set', async () => {
      const artistId = await createArtist('Replace Test Artist');
      const created = await admin
        .post('/vinyls')
        .send({
          title: 'To Be Replaced',
          artistIds: [artistId],
          tracks: [{ position: 1, title: 'Old Track' }],
        })
        .expect(201);

      const updated = await admin
        .patch(`/vinyls/${created.body.id}`)
        .send({ tracks: [{ position: 1, title: 'New Track' }] })
        .expect(200);

      expect(updated.body.tracks).toHaveLength(1);
      expect(updated.body.tracks[0].title).toBe('New Track');
    });
  });

  describe('soft delete + restore', () => {
    it('a deleted vinyl is excluded from list/detail/search but the row, tracks, and images survive', async () => {
      const artistId = await createArtist('Soft Delete Artist');
      const created = await admin
        .post('/vinyls')
        .send({
          title: 'Soft Delete Me',
          artistIds: [artistId],
          tracks: [{ position: 1, title: 'Only Track' }],
        })
        .expect(201);
      const id = created.body.id;

      await admin.delete(`/vinyls/${id}`).expect(204);

      await request(ctx.httpServer).get(`/vinyls/${id}`).expect(404);
      const list = await request(ctx.httpServer).get('/vinyls').expect(200);
      expect(list.body.some((v: { id: number }) => v.id === id)).toBe(false);
      const searchRes = await request(ctx.httpServer)
        .get('/vinyls')
        .query({ q: 'Soft Delete Me' })
        .expect(200);
      expect(searchRes.body.some((v: { id: number }) => v.id === id)).toBe(false);

      // Restoring brings it right back, tracks and all — proving the
      // underlying row was never actually removed.
      const restored = await admin.post(`/vinyls/${id}/restore`).expect(201);
      expect(restored.body).toMatchObject({ id, title: 'Soft Delete Me' });
      expect(restored.body.tracks).toHaveLength(1);

      const afterRestore = await request(ctx.httpServer)
        .get(`/vinyls/${id}`)
        .expect(200);
      expect(afterRestore.body.title).toBe('Soft Delete Me');
    });

    it('404s restoring a vinyl that was never deleted', async () => {
      const created = await admin
        .post('/vinyls')
        .send({ title: 'Never Deleted' })
        .expect(201);

      await admin.post(`/vinyls/${created.body.id}/restore`).expect(404);
    });

    it('404s restoring a vinyl that does not exist', async () => {
      await admin.post('/vinyls/999999/restore').expect(404);
    });

    it('rejects restore without a session', async () => {
      const created = await admin
        .post('/vinyls')
        .send({ title: 'Needs Auth To Restore' })
        .expect(201);
      await admin.delete(`/vinyls/${created.body.id}`).expect(204);

      await request(ctx.httpServer)
        .post(`/vinyls/${created.body.id}/restore`)
        .expect(401);
    });
  });
});
