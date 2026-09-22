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

describe('Image new-feature behavior (disc/side uniqueness, soft delete + restore)', () => {
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
      .send({ title: 'Multi-Disc Box Set' })
      .expect(201);
    vinylId = created.body.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('the same disc-side kind can hold a separate image per discNumber', async () => {
    const disc1 = await createTestImageBuffer({ width: 300, height: 300 });
    const res1 = await admin
      .post(`/vinyls/${vinylId}/images/disc-side-a`)
      .query({ discNumber: 1 })
      .attach('file', disc1, 'disc1-a.jpg')
      .expect(201);

    const disc2 = await createTestImageBuffer({ width: 300, height: 300 });
    const res2 = await admin
      .post(`/vinyls/${vinylId}/images/disc-side-a`)
      .query({ discNumber: 2 })
      .attach('file', disc2, 'disc2-a.jpg')
      .expect(201);

    // Different rows, different files — the @@unique([vinylId, kind,
    // discNumber]) slot is keyed by discNumber too, so disc 2 doesn't
    // collide with (or overwrite) disc 1.
    expect(res2.body.id).not.toBe(res1.body.id);
    expect(res1.body.fullPath).toBe(`${vinylId}/disc-side-a-1-full.webp`);
    expect(res2.body.fullPath).toBe(`${vinylId}/disc-side-a-2-full.webp`);

    const vinyl = await request(ctx.httpServer)
      .get(`/vinyls/${vinylId}`)
      .expect(200);
    const discSideAImages = vinyl.body.images.filter(
      (img: { kind: string }) => img.kind === 'DISC_SIDE_A',
    );
    expect(discSideAImages).toHaveLength(2);
    expect(discSideAImages.map((img: { discNumber: number }) => img.discNumber).sort()).toEqual([
      1, 2,
    ]);
  });

  it('rejects a non-positive-integer discNumber', async () => {
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    await admin
      .post(`/vinyls/${vinylId}/images/disc-side-b`)
      .query({ discNumber: 0 })
      .attach('file', buf, 'x.jpg')
      .expect(400);
    await admin
      .post(`/vinyls/${vinylId}/images/disc-side-b`)
      .query({ discNumber: 'two' })
      .attach('file', buf, 'x.jpg')
      .expect(400);
  });

  it('soft-deleting one disc/kind slot leaves the others visible', async () => {
    await admin.delete(`/vinyls/${vinylId}/images/disc-side-a`).query({ discNumber: 1 }).expect(200);

    const vinyl = await request(ctx.httpServer)
      .get(`/vinyls/${vinylId}`)
      .expect(200);
    const discSideAImages = vinyl.body.images.filter(
      (img: { kind: string }) => img.kind === 'DISC_SIDE_A',
    );
    // disc 1 gone, disc 2 (from the previous test) still there.
    expect(discSideAImages.map((img: { discNumber: number }) => img.discNumber)).toEqual([2]);
  });

  it('restoring a soft-deleted image slot brings it back, unchanged', async () => {
    const buf = await createTestImageBuffer({ width: 250, height: 250 });
    const uploadRes = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a`)
      .attach('file', buf, 'sleeve.jpg')
      .expect(201);

    await admin.delete(`/vinyls/${vinylId}/images/inner-sleeve-a`).expect(200);
    let vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_A'),
    ).toBe(false);

    const restoreRes = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a/restore`)
      .expect(201);
    expect(restoreRes.body.id).toBe(uploadRes.body.id);
    expect(restoreRes.body.fullPath).toBe(uploadRes.body.fullPath);

    vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_A'),
    ).toBe(true);

    // The original file is exactly what comes back — restore never re-derives it.
    const meta = await sharp(join(ctx.uploadsDir, restoreRes.body.fullPath)).metadata();
    expect(meta.width).toBe(250);
    expect(meta.height).toBe(250);
  });

  it('gatefold: both inner-sleeve slots can be uploaded, replaced, soft-deleted, and restored independently', async () => {
    const sleeveA1 = await createTestImageBuffer({ width: 200, height: 200 });
    const resA1 = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a`)
      .attach('file', sleeveA1, 'sleeve-a-1.jpg')
      .expect(201);

    const sleeveB = await createTestImageBuffer({ width: 300, height: 300 });
    const resB = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-b`)
      .attach('file', sleeveB, 'sleeve-b.jpg')
      .expect(201);

    // Distinct rows and files — slot A and slot B don't collide.
    expect(resB.body.id).not.toBe(resA1.body.id);
    expect(resA1.body.fullPath).toBe(`${vinylId}/inner-sleeve-a-1-full.webp`);
    expect(resB.body.fullPath).toBe(`${vinylId}/inner-sleeve-b-1-full.webp`);

    // Replacing slot A leaves slot B's row and file untouched.
    const sleeveA2 = await createTestImageBuffer({ width: 210, height: 210 });
    const resA2 = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a`)
      .attach('file', sleeveA2, 'sleeve-a-2.jpg')
      .expect(201);
    expect(resA2.body.id).toBe(resA1.body.id);

    let vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_B'),
    ).toBe(true);

    // Soft-deleting slot A leaves slot B visible.
    await admin.delete(`/vinyls/${vinylId}/images/inner-sleeve-a`).expect(200);
    vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_A'),
    ).toBe(false);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_B'),
    ).toBe(true);

    // Restoring slot A brings it back without touching slot B.
    await admin.post(`/vinyls/${vinylId}/images/inner-sleeve-a/restore`).expect(201);
    vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_A'),
    ).toBe(true);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'INNER_SLEEVE_B'),
    ).toBe(true);
  });

  it('404s restoring an image slot that was never deleted', async () => {
    await admin
      .post(`/vinyls/${vinylId}/images/cover-back/restore`)
      .expect(404);
  });

  it('re-uploading a soft-deleted slot clears deletedAt and replaces the content (no restore call needed)', async () => {
    const first = await createTestImageBuffer({ width: 120, height: 120 });
    const firstRes = await admin
      .post(`/vinyls/${vinylId}/images/cover-back`)
      .attach('file', first, 'back-1.jpg')
      .expect(201);

    await admin.delete(`/vinyls/${vinylId}/images/cover-back`).expect(200);

    const second = await createTestImageBuffer({ width: 640, height: 480 });
    const secondRes = await admin
      .post(`/vinyls/${vinylId}/images/cover-back`)
      .attach('file', second, 'back-2.jpg')
      .expect(201);

    expect(secondRes.body.id).toBe(firstRes.body.id);

    const vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    expect(
      vinyl.body.images.some((img: { kind: string }) => img.kind === 'COVER_BACK'),
    ).toBe(true);

    const meta = await sharp(join(ctx.uploadsDir, secondRes.body.fullPath)).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
  });

  it('rejects restore without a session', async () => {
    await request(ctx.httpServer)
      .post(`/vinyls/${vinylId}/images/cover-back/restore`)
      .expect(401);
  });
});
