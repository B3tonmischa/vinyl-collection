import request from 'supertest';
import { existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import {
  DELETED_IMAGE_RETENTION_MS,
  UploadsService,
} from '../src/uploads/uploads.service';
import {
  createTestApp,
  TestAppContext,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from './utils/create-test-app';
import { createTestImageBuffer } from './utils/fixtures';

// How scans are kept on disk: a file of its own per upload, cached for
// good by the browser, and removed once nothing can bring it back.
describe('Image storage', () => {
  let ctx: TestAppContext;
  let admin: ReturnType<typeof request.agent>;

  async function createVinyl(title: string): Promise<number> {
    const created = await admin.post('/vinyls').send({ title }).expect(201);
    return created.body.id;
  }

  async function upload(vinylId: number, kind: string, width: number) {
    const buf = await createTestImageBuffer({ width, height: width });
    const res = await admin
      .post(`/vinyls/${vinylId}/images/${kind}`)
      .attach('file', buf, 'scan.jpg')
      .expect(201);
    return res.body as { id: number; fullPath: string; thumbPath: string };
  }

  async function widthOnDisk(relativePath: string): Promise<number | undefined> {
    return (await sharp(join(ctx.uploadsDir, relativePath)).metadata()).width;
  }

  /** A moment just past the retention period, counted from now. */
  function afterRetention(): Date {
    return new Date(Date.now() + DELETED_IMAGE_RETENTION_MS + 60_000);
  }

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

  it('re-uploading a slot after a swap leaves the other slot’s picture alone', async () => {
    const vinylId = await createVinyl('Swap Then Replace');
    await upload(vinylId, 'cover-front', 300);
    await upload(vinylId, 'cover-back', 150);

    await admin
      .post(`/vinyls/${vinylId}/images/swap`)
      .send({ a: { kind: 'cover-front' }, b: { kind: 'cover-back' } })
      .expect(201);

    // The back slot now shows the 300px picture. Replacing the *front*
    // slot used to write over that very file.
    await upload(vinylId, 'cover-front', 90);

    const vinyl = await request(ctx.httpServer).get(`/vinyls/${vinylId}`).expect(200);
    const byKind = (kind: string) =>
      vinyl.body.images.find((img: { kind: string }) => img.kind === kind);

    expect(byKind('COVER_FRONT').fullPath).not.toBe(byKind('COVER_BACK').fullPath);
    expect(await widthOnDisk(byKind('COVER_FRONT').fullPath)).toBe(90);
    expect(await widthOnDisk(byKind('COVER_BACK').fullPath)).toBe(300);
  });

  it('serves an image with a long-lived, browser-only cache header', async () => {
    const vinylId = await createVinyl('Cached');
    const image = await upload(vinylId, 'cover-front', 100);

    const res = await request(ctx.httpServer).get(`/uploads/${image.thumbPath}`).expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  });

  it('stops serving the images of a deleted record', async () => {
    const vinylId = await createVinyl('Deleted Record');
    const image = await upload(vinylId, 'cover-front', 100);
    await request(ctx.httpServer).get(`/uploads/${image.fullPath}`).expect(200);

    await admin.delete(`/vinyls/${vinylId}`).expect(204);
    await request(ctx.httpServer).get(`/uploads/${image.fullPath}`).expect(404);

    await admin.post(`/vinyls/${vinylId}/restore`).expect(201);
    await request(ctx.httpServer).get(`/uploads/${image.fullPath}`).expect(200);
  });

  describe('purging', () => {
    it('keeps a freshly deleted image, so Undo still works', async () => {
      const vinylId = await createVinyl('Fresh Delete');
      const image = await upload(vinylId, 'cover-front', 100);
      await admin.delete(`/vinyls/${vinylId}/images/cover-front`).expect(200);

      await ctx.app.get(UploadsService).purgeExpired();

      expect(existsSync(join(ctx.uploadsDir, image.fullPath))).toBe(true);
      await admin.post(`/vinyls/${vinylId}/images/cover-front/restore`).expect(201);
    });

    it('removes an image deleted longer ago than the retention period, files and row', async () => {
      const vinylId = await createVinyl('Old Delete');
      const kept = await upload(vinylId, 'cover-front', 100);
      const gone = await upload(vinylId, 'cover-back', 100);
      await admin.delete(`/vinyls/${vinylId}/images/cover-back`).expect(200);

      await ctx.app.get(UploadsService).purgeExpired(afterRetention());

      expect(existsSync(join(ctx.uploadsDir, gone.fullPath))).toBe(false);
      expect(existsSync(join(ctx.uploadsDir, gone.thumbPath))).toBe(false);
      await admin.post(`/vinyls/${vinylId}/images/cover-back/restore`).expect(404);

      // An image that was never deleted is not touched.
      expect(existsSync(join(ctx.uploadsDir, kept.fullPath))).toBe(true);
      await request(ctx.httpServer).get(`/uploads/${kept.fullPath}`).expect(200);
    });

    it('removes the images of a record deleted longer ago than the retention period', async () => {
      const vinylId = await createVinyl('Old Deleted Record');
      const image = await upload(vinylId, 'cover-front', 100);
      await admin.delete(`/vinyls/${vinylId}`).expect(204);

      await ctx.app.get(UploadsService).purgeExpired(afterRetention());

      expect(existsSync(join(ctx.uploadsDir, image.fullPath))).toBe(false);
      // The record itself can still be restored, just without its pictures.
      const restored = await admin.post(`/vinyls/${vinylId}/restore`).expect(201);
      expect(restored.body.images).toEqual([]);
    });
  });
});
