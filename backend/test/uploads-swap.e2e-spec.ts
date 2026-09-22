import request from 'supertest';
import { join } from 'path';
import sharp from 'sharp';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';
import { createTestImageBuffer } from './utils/fixtures';

describe('Image slot swap', () => {
  let ctx: TestAppContext;
  let admin: ReturnType<typeof request.agent>;
  let vinylId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = request.agent(ctx.httpServer);
    await admin
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
      .expect(200);

    const created = await admin
      .post('/vinyls')
      .send({ title: 'Swap Test' })
      .expect(201);
    vinylId = created.body.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('swaps the images (full + thumb) between two filled slots, keeping each row pinned to its own slot', async () => {
    const frontBuf = await createTestImageBuffer({ width: 300, height: 300 });
    const frontRes = await admin
      .post(`/vinyls/${vinylId}/images/cover-front`)
      .attach('file', frontBuf, 'front.jpg')
      .expect(201);

    const sleeveBuf = await createTestImageBuffer({ width: 150, height: 150 });
    const sleeveRes = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a`)
      .attach('file', sleeveBuf, 'sleeve.jpg')
      .expect(201);

    const swapRes = await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'inner-sleeve-a' } })
      .expect(201);

    // Rows keep their own id/kind/discNumber — only the file references move.
    expect(swapRes.body.a.id).toBe(frontRes.body.id);
    expect(swapRes.body.a.kind).toBe('COVER_FRONT');
    expect(swapRes.body.a.fullPath).toBe(sleeveRes.body.fullPath);
    expect(swapRes.body.b.id).toBe(sleeveRes.body.id);
    expect(swapRes.body.b.kind).toBe('INNER_SLEEVE_A');
    expect(swapRes.body.b.fullPath).toBe(frontRes.body.fullPath);

    const vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    const front = vinyl.body.images.find((img: { kind: string }) => img.kind === 'COVER_FRONT');
    const sleeve = vinyl.body.images.find((img: { kind: string }) => img.kind === 'INNER_SLEEVE_A');

    // The cover-front slot now serves the (originally 150x150) sleeve image.
    const frontMeta = await sharp(join(ctx.uploadsDir, front.fullPath)).metadata();
    expect(frontMeta.width).toBe(150);
    // The inner-sleeve-a slot now serves the (originally 300x300) front image.
    const sleeveMeta = await sharp(join(ctx.uploadsDir, sleeve.fullPath)).metadata();
    expect(sleeveMeta.width).toBe(300);
  });

  it('swaps two disc-side slots on the same disc, scoped by discNumber', async () => {
    const sideABuf = await createTestImageBuffer({ width: 200, height: 200 });
    const sideARes = await admin
      .post(`/vinyls/${vinylId}/images/disc-side-a`)
      .query({ discNumber: 1 })
      .attach('file', sideABuf, 'side-a.jpg')
      .expect(201);

    const sideBBuf = await createTestImageBuffer({ width: 220, height: 220 });
    const sideBRes = await admin
      .post(`/vinyls/${vinylId}/images/disc-side-b`)
      .query({ discNumber: 1 })
      .attach('file', sideBBuf, 'side-b.jpg')
      .expect(201);

    const swapRes = await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({
        a: { kind: 'disc-side-a', discNumber: 1 },
        b: { kind: 'disc-side-b', discNumber: 1 },
      })
      .expect(201);

    expect(swapRes.body.a.fullPath).toBe(sideBRes.body.fullPath);
    expect(swapRes.body.b.fullPath).toBe(sideARes.body.fullPath);
  });

  it('rejects swapping a slot with itself', async () => {
    await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'cover-front' } })
      .expect(400);
  });

  it('404s swapping when one of the two slots is empty', async () => {
    await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'cover-back' } })
      .expect(404);
  });

  it('404s swapping a soft-deleted slot', async () => {
    await admin.delete(`/vinyls/${vinylId}/images/cover-front`).expect(200);
    await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'inner-sleeve-a' } })
      .expect(404);
  });

  it('rejects an unknown kind in the swap body', async () => {
    await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'not-a-kind' }, b: { kind: 'inner-sleeve-a' } })
      .expect(400);
  });

  it('rejects swap without a session', async () => {
    await request(ctx.httpServer)
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'inner-sleeve-a' } })
      .expect(401);
  });
});
