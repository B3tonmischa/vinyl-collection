# Vinyl Archive

A self-hosted catalogue of a record collection: a public gallery to browse and
search, and an admin area to add records, import them from Discogs, and
photograph sleeves and discs with a phone.

## Layout

| Path | What it is |
| --- | --- |
| [`backend/`](backend/README.md) | NestJS API with Prisma on SQLite. Stores records, artists, tracks and processed scans. |
| [`frontend/`](frontend/README.md) | Angular app: the public gallery and the admin area, including camera capture. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Self-hosting on a Raspberry Pi with Docker Compose, Caddy and Cloudflare Tunnel. |
| `scripts/` | `dev.js` starts both dev servers; `make-disc-fixtures.mjs` builds test fixtures from example photos. |

## Requirements

Node 26 (see `.node-version`). The backend has native dependencies
(`better-sqlite3`, `sharp`) that are built for the Node version that installs
them, so install and run with the same one.

## Development rules

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing code: it covers the
scan worker's versioning, upload paths, API shapes and branch rules.

## Local development

First-time setup, once per checkout:

```bash
npm install --prefix backend
```

```bash
npm install --prefix frontend
```

Then configure and initialise the backend as described in
[`backend/README.md`](backend/README.md) (an `.env` file, the database, the
Prisma client).

Start both dev servers together from the repository root:

```bash
npm run dev
```

The app is at `http://localhost:4200`, the API at `http://localhost:3000`.
To try camera capture from a phone, see "Testing the camera on a phone" in
[`frontend/README.md`](frontend/README.md).

## Checks

The same checks run in CI on every pull request (`.github/workflows/ci.yml`).

Backend, from `backend/`:

```bash
npm run lint:check
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

Frontend, from `frontend/`:

```bash
npm run lint
```

```bash
npm test -- --watch=false
```

```bash
npm run build
```

The disc-detection specs use example photos that are not part of the
repository; those cases are skipped when the photos are absent.
