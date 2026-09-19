import request from 'supertest';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';

describe('Auth (current behavior)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('rejects login with the wrong password', async () => {
    await request(ctx.httpServer)
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: 'not-the-password' })
      .expect(401);
  });

  it('rejects login with an unknown username', async () => {
    await request(ctx.httpServer)
      .post('/auth/login')
      .send({ username: 'someone-else', password: TEST_ADMIN_PASSWORD })
      .expect(401);
  });

  it('logs in with correct credentials and sets an httpOnly session cookie', async () => {
    const res = await request(ctx.httpServer)
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);

    expect(res.body).toEqual({ status: 'ok' });

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const sessionCookie = (setCookie as unknown as string[]).find((c) =>
      c.startsWith('session='),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
  });

  it('rejects /auth/me with no session cookie', async () => {
    await request(ctx.httpServer).get('/auth/me').expect(401);
  });

  it('rejects /auth/logout with no session cookie', async () => {
    await request(ctx.httpServer).post('/auth/logout').expect(401);
  });

  it('allows /auth/me once logged in, and rejects a garbage cookie', async () => {
    const agent = request.agent(ctx.httpServer);
    await agent
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ sub: TEST_ADMIN_USERNAME, role: 'admin' });

    await request(ctx.httpServer)
      .get('/auth/me')
      .set('Cookie', 'session=not-a-real-jwt')
      .expect(401);
  });

  it('logs out and invalidates the session cookie for subsequent requests', async () => {
    const agent = request.agent(ctx.httpServer);
    await agent
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);
    await agent.get('/auth/me').expect(200);

    await agent.post('/auth/logout').expect(200);

    // supertest's agent drops cookies once the server sends a clearing
    // Set-Cookie, so this request goes out with no session cookie at all —
    // which the guard correctly rejects.
    await agent.get('/auth/me').expect(401);
  });

  it('the global guard leaves public vinyl routes reachable without a session', async () => {
    await request(ctx.httpServer).get('/vinyls').expect(200);
  });

  it('the global guard rejects admin vinyl routes without a session', async () => {
    await request(ctx.httpServer)
      .post('/vinyls')
      .send({ artist: 'Boards of Canada', title: 'Geogaddi' })
      .expect(401);
  });
});
