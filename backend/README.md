# vinyl-archive backend

NestJS + Prisma (SQLite) API for the vinyl collection archive: public read
endpoints for browsing the collection, admin-only endpoints (session-cookie
protected) for adding/editing/deleting records and uploading scans.

## Stack

- NestJS 11 (Express)
- Prisma ORM 7 + SQLite (via `@prisma/adapter-better-sqlite3`)
- Sharp for image processing (scan uploads -> full + thumbnail WebP)
- Single-admin auth: username/password checked against env vars, session as
  a signed, httpOnly JWT cookie — no user table, no OAuth, deliberately simple

## First-time setup

Use Node 26 (see `.node-version` in the repository root): `better-sqlite3` and
`sharp` are native modules, built for the Node version that installs them.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`:
- `JWT_SECRET` — any long random string (e.g. `openssl rand -hex 32`)
- `ADMIN_USERNAME` — whatever you want to log in with
- `ADMIN_PASSWORD_HASH` — generate it:
  ```bash
  npm run hash:password -- "your-chosen-password"
  ```
  Paste the printed hash into `.env`. Your plaintext password is never stored.
- `DISCOGS_TOKEN` — optional, only needed for the Discogs import.

The backend refuses to start while `JWT_SECRET` or `ADMIN_PASSWORD_HASH` is
missing or still the placeholder from `.env.example`.

Generate the Prisma client and create the database from the committed
migrations:

```bash
npm run prisma:generate
```

```bash
npm run prisma:deploy
```

Run the dev server:

```bash
npm run start:dev
```

The API listens on `http://localhost:3000` by default. Check it's alive:

```bash
curl http://localhost:3000
```

## Checks

```bash
npm run lint:check
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

The e2e tests start the whole application against a fresh SQLite file and a
temporary uploads folder per test file; they need no `.env` and never call
Discogs.

## API overview

Public (no auth):
- `GET /` — health check
- `GET /vinyls?q=search` — the collection as card-sized summaries (id, title,
  year, artists, cover thumbnail); `q` runs a full-text search over titles,
  labels, artists and track titles
- `GET /vinyls/:id` — one record in full: artists, tracks, images
- `GET /artists?q=search` — artist names, for autocomplete
- `GET /uploads/:vinylId/:filename` — a processed scan (full size or thumbnail)

Admin only (needs the `session` cookie set by `/auth/login`):
- `POST /auth/login` — `{ username, password }`, sets the session cookie;
  limited to 10 attempts a minute per client
- `POST /auth/logout`
- `GET /auth/me` — check current session
- `POST /vinyls`, `PATCH /vinyls/:id` — create, update (artists and tracks
  included)
- `DELETE /vinyls/:id` — hide a record; `POST /vinyls/:id/restore` undoes it
- `POST /artists` — find or create an artist by name
- `POST /vinyls/:id/images/:kind?discNumber=N` — multipart upload, field name
  `file`. `:kind` is one of `cover-front`, `cover-back`, `inner-sleeve-a`,
  `inner-sleeve-b`, `disc-side-a`, `disc-side-b`. Uploading again replaces
  the slot's image.
- `DELETE /vinyls/:id/images/:kind` — hide one image;
  `POST /vinyls/:id/images/:kind/restore` undoes it
- `POST /vinyls/:id/images/swap` — swap the images of two filled slots
- `GET /import/discogs/search` — search Discogs releases
- `POST /import/discogs/:releaseId?images=true|false` — import a release as a
  new record

## Notes

- CORS is locked to `FRONTEND_ORIGIN` (defaults to `http://localhost:4200`,
  the Angular dev server) with credentials enabled, since auth uses a cookie.
- Processed images live under `backend/uploads/` (or `UPLOADS_ROOT`). The
  folder is gitignored — back it up together with the database.
- Deleting only hides a record or an image, so Undo can bring it back. The
  files of anything deleted more than 30 days ago are removed for good, at
  startup and once a day.
- Self-hosting with Docker Compose and Caddy is described in
  [`DEPLOYMENT.md`](../DEPLOYMENT.md).
