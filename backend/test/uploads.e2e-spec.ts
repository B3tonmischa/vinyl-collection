import request from 'supertest';
import { existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';
import { createTestImageBuffer } from './utils/fixtures';

describe('Image upload pipeline', () => {
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
      .send({ title: '( )' })
      .expect(201);
    vinylId = created.body.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('rejects upload with no file', async () => {
    await admin.post(`/vinyls/${vinylId}/images/cover-front`).expect(400);
  });

  it('rejects an unknown image kind', async () => {
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    await admin
      .post(`/vinyls/${vinylId}/images/not-a-kind`)
      .attach('file', buf, 'scan.jpg')
      .expect(400);
  });

  it('404s uploading to a vinyl that does not exist', async () => {
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    await admin
      .post('/vinyls/999999/images/cover-front')
      .attach('file', buf, 'scan.jpg')
      .expect(404);
  });

  it('rejects upload without a session', async () => {
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    await request(ctx.httpServer)
      .post(`/vinyls/${vinylId}/images/cover-front`)
      .attach('file', buf, 'scan.jpg')
      .expect(401);
  });

  it('processes a large scan into a capped full size and a thumbnail, both WebP', async () => {
    const buf = await createTestImageBuffer({ width: 3000, height: 1500 });

    const res = await admin
      .post(`/vinyls/${vinylId}/images/cover-front`)
      .attach('file', buf, 'front.jpg')
      .expect(201);

    expect(res.body).toMatchObject({ vinylId, kind: 'COVER_FRONT', discNumber: 1 });
    expect(res.body.fullPath).toBe(`${vinylId}/cover-front-1-full.webp`);
    expect(res.body.thumbPath).toBe(`${vinylId}/cover-front-1-thumb.webp`);

    const fullMeta = await sharp(
      join(ctx.uploadsDir, res.body.fullPath),
    ).metadata();
    // 3000x1500 (2:1) capped to fit inside 2000x2000 -> 2000x1000.
    expect(fullMeta.format).toBe('webp');
    expect(fullMeta.width).toBe(2000);
    expect(fullMeta.height).toBe(1000);

    const thumbMeta = await sharp(
      join(ctx.uploadsDir, res.body.thumbPath),
    ).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(500);
    expect(thumbMeta.height).toBe(250);
  });

  it('respects EXIF orientation and does not upscale a smaller image', async () => {
    // 300x150 pixels tagged as needing a 90deg CW rotation to display
    // correctly -> after .rotate() the stored image should be 150x300.
    const buf = await createTestImageBuffer({
      width: 300,
      height: 150,
      exifOrientation: 6,
    });

    const res = await admin
      .post(`/vinyls/${vinylId}/images/inner-sleeve-a`)
      .attach('file', buf, 'sleeve.jpg')
      .expect(201);

    const fullMeta = await sharp(
      join(ctx.uploadsDir, res.body.fullPath),
    ).metadata();
    expect(fullMeta.width).toBe(150);
    expect(fullMeta.height).toBe(300);
    // EXIF orientation was baked into the pixels and stripped, not left
    // for a viewer to (possibly) apply a second time.
    expect(fullMeta.orientation).toBeUndefined();

    const thumbMeta = await sharp(
      join(ctx.uploadsDir, res.body.thumbPath),
    ).metadata();
    // Rotated width (150) is under the 500px thumb target, and
    // withoutEnlargement means it must NOT be scaled up to 500.
    expect(thumbMeta.width).toBe(150);
    expect(thumbMeta.height).toBe(300);
  });

  it('re-uploading the same kind replaces the previous image (upsert, not a new row)', async () => {
    const first = await createTestImageBuffer({ width: 400, height: 400 });
    const firstRes = await admin
      .post(`/vinyls/${vinylId}/images/cover-back`)
      .attach('file', first, 'back-1.jpg')
      .expect(201);
    const firstImageId = firstRes.body.id;

    const second = await createTestImageBuffer({ width: 800, height: 200 });
    const secondRes = await admin
      .post(`/vinyls/${vinylId}/images/cover-back`)
      .attach('file', second, 'back-2.jpg')
      .expect(201);

    // Same row (same id, same @@unique([vinylId, kind, discNumber]) slot),
    // same paths — just re-processed content.
    expect(secondRes.body.id).toBe(firstImageId);
    expect(secondRes.body.fullPath).toBe(firstRes.body.fullPath);

    const fullMeta = await sharp(
      join(ctx.uploadsDir, secondRes.body.fullPath),
    ).metadata();
    // If this reflects the second (800x200) upload rather than the first
    // (400x400), the replace actually happened on disk, not just in the DB.
    expect(fullMeta.width).toBe(800);
    expect(fullMeta.height).toBe(200);

    const vinyl = await request(ctx.httpServer)
      .get(`/vinyls/${vinylId}`)
      .expect(200);
    const coverBackImages = vinyl.body.images.filter(
      (img: { kind: string }) => img.kind === 'COVER_BACK',
    );
    expect(coverBackImages).toHaveLength(1);
  });

  it('packaging kinds (cover-front/back, inner-sleeve-a/b) always use discNumber 1, ignoring the query param', async () => {
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    const res = await admin
      .post(`/vinyls/${vinylId}/images/cover-front`)
      .query({ discNumber: 3 })
      .attach('file', buf, 'front.jpg')
      .expect(201);

    expect(res.body.discNumber).toBe(1);
    expect(res.body.fullPath).toBe(`${vinylId}/cover-front-1-full.webp`);
  });

  it('rejects delete without a session', async () => {
    await request(ctx.httpServer)
      .delete(`/vinyls/${vinylId}/images/cover-back`)
      .expect(401);
  });

  it('404s deleting an image kind that was never uploaded', async () => {
    await admin
      .delete(`/vinyls/${vinylId}/images/disc-side-a`)
      .expect(404);
  });

  it('deletes an image: soft-deleted (excluded from reads), but the row and files survive', async () => {
    const buf = await createTestImageBuffer({ width: 200, height: 200 });
    const uploadRes = await admin
      .post(`/vinyls/${vinylId}/images/disc-side-a`)
      .attach('file', buf, 'disc.jpg')
      .expect(201);

    const fullOnDisk = join(ctx.uploadsDir, uploadRes.body.fullPath);
    const thumbOnDisk = join(ctx.uploadsDir, uploadRes.body.thumbPath);
    expect(existsSync(fullOnDisk)).toBe(true);
    expect(existsSync(thumbOnDisk)).toBe(true);

    await admin.delete(`/vinyls/${vinylId}/images/disc-side-a`).expect(200);

    // Files are untouched — soft delete only marks the DB row.
    expect(existsSync(fullOnDisk)).toBe(true);
    expect(existsSync(thumbOnDisk)).toBe(true);

    const vinyl = await request(ctx.httpServer)
      .get(`/vinyls/${vinylId}`)
      .expect(200);
    expect(
      vinyl.body.images.some(
        (img: { kind: string }) => img.kind === 'DISC_SIDE_A',
      ),
    ).toBe(false);
  });

  it('deleting a vinyl soft-deletes it, and its images stop appearing too', async () => {
    const created = await admin
      .post('/vinyls')
      .send({ title: 'Cascade Test' })
      .expect(201);
    const buf = await createTestImageBuffer({ width: 100, height: 100 });
    await admin
      .post(`/vinyls/${created.body.id}/images/cover-front`)
      .attach('file', buf, 'x.jpg')
      .expect(201);

    await admin.delete(`/vinyls/${created.body.id}`).expect(204);

    await request(ctx.httpServer)
      .get(`/vinyls/${created.body.id}`)
      .expect(404);
  });
});
