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

This project's files were written directly (no `npm install` was run yet —
the sandbox this was generated in has no network access to the npm
registry). Run everything below in a normal terminal on your machine.

```bash
cd backend
npm install
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

Create the database and generate the Prisma client:

```bash
npm run prisma:migrate -- --name init
npm run prisma:generate
```

Run the dev server:

```bash
npm run start:dev
```

The API listens on `http://localhost:3000` by default. Check it's alive:

```bash
curl http://localhost:3000
# {"status":"ok","service":"vinyl-archive-backend"}
```

## API overview

Public (no auth):
- `GET /vinyls?q=search` — list, optionally filtered by artist/title/label
- `GET /vinyls/:id` — single record with its images
- `GET /uploads/...` — static scan images (full + thumbnail)

Admin only (needs the `session` cookie set by `/auth/login`):
- `POST /auth/login` — `{ username, password }`, sets the session cookie
- `POST /auth/logout`
- `GET /auth/me` — check current session
- `POST /vinyls` — create
- `PATCH /vinyls/:id` — update
- `DELETE /vinyls/:id` — delete (cascades its images, both DB rows and files)
- `POST /vinyls/:id/images/:kind` — multipart upload, field name `file`.
  `:kind` is one of `cover-front`, `cover-back`, `inner-sleeve-a`, `inner-sleeve-b`, `vinyl`.
  Uploading again for the same kind replaces the previous image.
- `DELETE /vinyls/:id/images/:kind` — remove one image

## Notes / next steps

- CORS is locked to `FRONTEND_ORIGIN` (defaults to `http://localhost:4200`,
  the Angular dev server) with credentials enabled, since auth uses a cookie.
- Uploaded/processed images live under `backend/uploads/`, served statically
  at `/uploads/...`. This folder is gitignored — back it up separately
  (along with `prisma/dev.db`) once you're self-hosting.
- `condition` was intentionally left out of the data model per your request.
- Not built yet: Docker Compose + Caddy reverse proxy for self-hosting, and
  the Angular frontend — next up.
