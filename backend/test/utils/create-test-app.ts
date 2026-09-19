import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import cookieParser from 'cookie-parser';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../../src/app.module';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');
const TMP_ROOT = join(__dirname, '..', 'tmp');

export const TEST_ADMIN_USERNAME = 'test-admin';
export const TEST_ADMIN_PASSWORD = 'test-password-123';

let counter = 0;

/**
 * Builds a brand-new SQLite file at `dbPath` by replaying every migration
 * under prisma/migrations, in order — without going through the Prisma CLI
 * (which needs to download a platform-specific "schema-engine" binary this
 * sandbox cannot reach). This only ever runs the already-committed
 * migration.sql files verbatim, so it stays perfectly in sync with whatever
 * schema the app itself was generated against.
 */
function buildFreshTestDatabase(dbPath: string): void {
  if (existsSync(dbPath)) {
    rmSync(dbPath);
  }
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    const migrationFolders = readdirSync(MIGRATIONS_DIR)
      .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
      .sort();
    for (const folder of migrationFolders) {
      const sql = readFileSync(
        join(MIGRATIONS_DIR, folder, 'migration.sql'),
        'utf8',
      );
      db.exec(sql);
    }
  } finally {
    db.close();
  }
}

export interface TestAppContext {
  app: INestApplication;
  // supertest's own types don't line up with Nest's typed getHttpServer()
  // generic, so tests pass this (typed `any`, like INestApplication's own
  // getHttpServer() signature) to request()/request.agent() instead.
  httpServer: any;
  dbPath: string;
  uploadsDir: string;
  adminUsername: string;
  adminPassword: string;
  cleanup: () => Promise<void>;
}

/**
 * Spins up a full Nest application (same global pipes/guards/middleware as
 * main.ts) wired to a fresh, isolated SQLite file and an isolated uploads
 * directory. Each call gets its own db + uploads dir so test files never
 * see each other's data.
 */
export async function createTestApp(): Promise<TestAppContext> {
  counter += 1;
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
  const runId = `${Date.now()}-${counter}`;
  const dbPath = join(TMP_ROOT, `test-${runId}.db`);
  const uploadsDir = join(TMP_ROOT, `uploads-${runId}`);
  mkdirSync(uploadsDir, { recursive: true });

  buildFreshTestDatabase(dbPath);

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.UPLOADS_ROOT = uploadsDir;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
  // Low bcrypt cost factor keeps the test suite fast; still exercises real
  // bcrypt.compare() in AuthService.
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 4);
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.FRONTEND_ORIGIN = 'http://localhost:4200';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  return {
    app,
    httpServer: app.getHttpServer(),
    dbPath,
    uploadsDir,
    adminUsername: TEST_ADMIN_USERNAME,
    adminPassword: TEST_ADMIN_PASSWORD,
    cleanup: async () => {
      await app.close();
      // maxRetries/retryDelay absorb the transient EPERM/EBUSY that Windows
      // can throw when deleting a file or directory an antivirus/indexer
      // briefly still has a handle on right after it was written. This is a
      // no-op on Linux/POSIX (the first attempt always succeeds there), so
      // it doesn't change behavior in this sandbox — only on real Windows.
      const RETRY_OPTS = { maxRetries: 5, retryDelay: 100 };
      rmSync(dbPath, { force: true, ...RETRY_OPTS });
      rmSync(`${dbPath}-journal`, { force: true, ...RETRY_OPTS });
      rmSync(uploadsDir, { recursive: true, force: true, ...RETRY_OPTS });
    },
  };
}
