import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';

describe('Artists (search-or-create picker)', () => {
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

  it('creates a new artist as admin', async () => {
    const res = await admin.post('/artists').send({ name: 'Aphex Twin' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Aphex Twin' });
    expect(res.body.id).toBeDefined();
  });

  it('rejects create without a session', async () => {
    await request(ctx.httpServer)
      .post('/artists')
      .send({ name: 'No Auth' })
      .expect(401);
  });

  it('is idempotent on a case-insensitive name match instead of creating a near-duplicate', async () => {
    const first = await admin.post('/artists').send({ name: 'Boards of Canada' }).expect(201);
    const second = await admin
      .post('/artists')
      .send({ name: 'BOARDS OF CANADA' })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    const all = await request(ctx.httpServer).get('/artists').expect(200);
    expect(
      all.body.filter((a: { name: string }) => a.name.toLowerCase() === 'boards of canada'),
    ).toHaveLength(1);
  });

  it('lists/searches artists publicly, case-insensitively', async () => {
    await admin.post('/artists').send({ name: 'Radiohead' }).expect(201);

    const res = await request(ctx.httpServer)
      .get('/artists')
      .query({ q: 'radio' })
      .expect(200);
    expect(res.body.some((a: { name: string }) => a.name === 'Radiohead')).toBe(true);

    const miss = await request(ctx.httpServer)
      .get('/artists')
      .query({ q: 'zzz-no-such-artist-zzz' })
      .expect(200);
    expect(miss.body).toEqual([]);
  });
});
