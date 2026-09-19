import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';

// Exercises the FTS5-backed search (see prisma/migrations/20260917213500_add_fts5_search
// and VinylsService.search()), reached via GET /vinyls?q=.
describe('Search (FTS5)', () => {
  let ctx: TestAppContext;
  let admin: ReturnType<typeof request.agent>;

  let okComputerId: number;
  let splitAlbumId: number;
  let deletedId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = request.agent(ctx.httpServer);
    await admin
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);

    const artist = async (name: string) => {
      const res = await admin.post('/artists').send({ name }).expect(201);
      return res.body.id as number;
    };

    const radiohead = await artist('Radiohead');
    const okComputer = await admin
      .post('/vinyls')
      .send({
        title: 'OK Computer',
        label: 'Parlophone',
        genre: 'Alternative Rock',
        notes: 'A very special secret pressing note',
        artistIds: [radiohead],
        tracks: [{ position: 1, title: 'Paranoid Android' }],
      })
      .expect(201);
    okComputerId = okComputer.body.id;

    const bandA = await artist('Split Band A');
    const guest = await artist('Featured Guest Vocalist');
    const splitAlbum = await admin
      .post('/vinyls')
      .send({
        title: 'Split Album',
        artistIds: [bandA],
        tracks: [
          { position: 1, title: 'Regular Track' },
          { position: 2, title: 'Guest Spot', artistIds: [guest] },
        ],
      })
      .expect(201);
    splitAlbumId = splitAlbum.body.id;

    const deleted = await admin
      .post('/vinyls')
      .send({ title: 'Soon Deleted Searchable Title' })
      .expect(201);
    deletedId = deleted.body.id;
    await admin.delete(`/vinyls/${deletedId}`).expect(204);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function searchIds(q: string): Promise<number[]> {
    const res = await request(ctx.httpServer).get('/vinyls').query({ q }).expect(200);
    return res.body.map((v: { id: number }) => v.id);
  }

  it('matches on title', async () => {
    expect(await searchIds('Computer')).toContain(okComputerId);
  });

  it('matches on label', async () => {
    expect(await searchIds('Parlophone')).toContain(okComputerId);
  });

  it('matches on the album-level artist name', async () => {
    expect(await searchIds('Radiohead')).toContain(okComputerId);
  });

  it('matches on a track title', async () => {
    expect(await searchIds('Paranoid')).toContain(okComputerId);
  });

  it('matches on a track-level override artist not on the album itself', async () => {
    const ids = await searchIds('Featured Guest');
    expect(ids).toContain(splitAlbumId);
  });

  it('does not match on genre', async () => {
    expect(await searchIds('Alternative Rock')).not.toContain(okComputerId);
  });

  it('does not match on notes', async () => {
    expect(await searchIds('secret pressing')).not.toContain(okComputerId);
  });

  it('excludes soft-deleted vinyls even when the title matches', async () => {
    expect(await searchIds('Soon Deleted Searchable')).not.toContain(deletedId);
  });

  it('supports prefix matching (partial word)', async () => {
    expect(await searchIds('Radioh')).toContain(okComputerId);
  });

  it('returns no results for a query that has no matches', async () => {
    expect(await searchIds('zzz-nothing-matches-this-zzz')).toEqual([]);
  });

  it('returns no results (not an error) for a punctuation-only query', async () => {
    const res = await request(ctx.httpServer).get('/vinyls').query({ q: '???' }).expect(200);
    expect(res.body).toEqual([]);
  });

  it('an empty q falls back to the normal listing rather than searching', async () => {
    const res = await request(ctx.httpServer).get('/vinyls').query({ q: '' }).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});
