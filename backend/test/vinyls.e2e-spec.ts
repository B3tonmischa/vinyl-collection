import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';

describe('Vinyl CRUD', () => {
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

  it('creates a vinyl as admin, with artists and a tracklist', async () => {
    const radioheadId = await createArtist('Radiohead');

    const res = await admin
      .post('/vinyls')
      .send({
        title: 'OK Computer',
        year: 1997,
        label: 'Parlophone',
        releaseType: 'LP',
        discSize: 'TWELVE_INCH',
        speed: 'RPM_33',
        genre: 'Alternative',
        notes: 'First pressing',
        artistIds: [radioheadId],
        tracks: [
          { position: 1, title: 'Airbag', side: 'A' },
          { position: 2, title: 'Paranoid Android', side: 'A' },
        ],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'OK Computer',
      year: 1997,
      label: 'Parlophone',
      releaseType: 'LP',
      discSize: 'TWELVE_INCH',
      speed: 'RPM_33',
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.artists).toEqual([{ id: radioheadId, name: 'Radiohead' }]);
    expect(res.body.tracks).toHaveLength(2);
    expect(res.body.tracks[0]).toMatchObject({ position: 1, title: 'Airbag', side: 'A' });
  });

  it('rejects create payloads with unknown fields (whitelist validation)', async () => {
    await admin
      .post('/vinyls')
      .send({ title: 'Y', notAField: 'nope' })
      .expect(400);
  });

  it('rejects create payloads missing required fields', async () => {
    await admin.post('/vinyls').send({}).expect(400);
  });

  it('rejects an invalid releaseType/discSize/speed value', async () => {
    await admin
      .post('/vinyls')
      .send({ title: 'Bad enum', releaseType: 'NOT_A_TYPE' })
      .expect(400);
  });

  it('rejects an artistId that does not refer to an existing artist', async () => {
    await admin
      .post('/vinyls')
      .send({ title: 'Ghost Artist', artistIds: [999999] })
      .expect(400);
  });

  it('lists vinyls publicly, including one just created', async () => {
    const res = await request(ctx.httpServer).get('/vinyls').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some((v: { title: string }) => v.title === 'OK Computer'),
    ).toBe(true);
  });

  it('reads a single vinyl publicly, with its images array', async () => {
    const created = await admin
      .post('/vinyls')
      .send({ title: 'Geogaddi' })
      .expect(201);

    const res = await request(ctx.httpServer)
      .get(`/vinyls/${created.body.id}`)
      .expect(200);

    expect(res.body).toMatchObject({ id: created.body.id, title: 'Geogaddi' });
    expect(res.body.images).toEqual([]);
    expect(res.body.artists).toEqual([]);
    expect(res.body.tracks).toEqual([]);
  });

  it('404s reading a vinyl that does not exist', async () => {
    await request(ctx.httpServer).get('/vinyls/999999').expect(404);
  });

  it('updates a vinyl as admin', async () => {
    const created = await admin
      .post('/vinyls')
      .send({ title: 'Placeholder Title' })
      .expect(201);

    const updated = await admin
      .patch(`/vinyls/${created.body.id}`)
      .send({ title: 'Selected Ambient Works 85-92' })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      title: 'Selected Ambient Works 85-92',
    });
  });

  it('404s updating a vinyl that does not exist', async () => {
    await admin.patch('/vinyls/999999').send({ title: 'X' }).expect(404);
  });

  it('rejects create/update without a session', async () => {
    await request(ctx.httpServer)
      .post('/vinyls')
      .send({ title: 'Y' })
      .expect(401);
    await request(ctx.httpServer)
      .patch('/vinyls/1')
      .send({ title: 'Y' })
      .expect(401);
  });

  it('deletes a vinyl as admin, and it is hidden from reads', async () => {
    const created = await admin
      .post('/vinyls')
      .send({ title: 'To Be Removed' })
      .expect(201);

    await admin.delete(`/vinyls/${created.body.id}`).expect(204);

    await request(ctx.httpServer)
      .get(`/vinyls/${created.body.id}`)
      .expect(404);
  });

  it('404s deleting a vinyl that does not exist', async () => {
    await admin.delete('/vinyls/999999').expect(404);
  });

  it('rejects delete without a session', async () => {
    const created = await admin
      .post('/vinyls')
      .send({ title: 'To Delete' })
      .expect(201);

    await request(ctx.httpServer)
      .delete(`/vinyls/${created.body.id}`)
      .expect(401);
  });
});
