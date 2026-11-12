# Contributing

Development rules for this repository. Read this before changing code. Each
rule links to the code it describes; if the code and this file disagree, fix
this file.

## Scan worker and OpenCV

- **Changing [`frontend/public/workers/scan-worker.js`](frontend/public/workers/scan-worker.js):**
  bump `WORKER_VERSION` in [`scan-detector.ts`](frontend/src/app/admin/camera-capture/scan-detector.ts),
  then update the version and checksum pair in
  [`scan-worker.sync.spec.ts`](frontend/src/app/admin/camera-capture/scan-worker.sync.spec.ts).
  The worker is served under a `?v=` URL and cached for a year
  ([`frontend/Caddyfile`](frontend/Caddyfile)), so the URL must change with the file.
  The spec fails until both are updated.
- **Upgrading OpenCV:** change the `?v=` in the worker's `importScripts` line
  and the version in [`frontend/public/vendor/opencv/VERSION.txt`](frontend/public/vendor/opencv/VERSION.txt).
  Changing the `importScripts` line also changes the worker source, so bump
  `WORKER_VERSION` as above.

## Uploads

- **Never write to an existing upload path.** Each upload gets a new random
  token in its file name (see `UploadsService`, [`backend/src/uploads/uploads.service.ts`](backend/src/uploads/uploads.service.ts)),
  so a file's content never changes under the same URL. Caching and the image
  swap depend on this.
- **Deleting only hides.** Deleting a record or image sets `deletedAt`; the
  files stay on disk so restore works. Files of anything deleted more than 30
  days ago are removed by `UploadsService.purgeExpired`.

## API

- **List and detail shapes differ.** `GET /vinyls` returns `VinylSummary`; the
  full `Vinyl` comes only from `GET /vinyls/:id`. Frontend types live in
  [`frontend/src/app/models/vinyl.model.ts`](frontend/src/app/models/vinyl.model.ts).
- **No state-changing GET endpoints.** The session cookie is `SameSite=Lax`,
  which browsers still send on top-level GET navigations. Use POST, PATCH or
  DELETE for anything that changes data (see the comment in
  [`backend/src/import/import.controller.ts`](backend/src/import/import.controller.ts)).
- **Do not set `withCredentials` on API calls.** The interceptor in
  [`frontend/src/app/core/interceptors/api.interceptor.ts`](frontend/src/app/core/interceptors/api.interceptor.ts)
  adds it to every request to the API.

## Tooling

- **Node version:** use the version in [`.node-version`](.node-version) for
  installs and tests. Native modules (`better-sqlite3`, `sharp`) are built for
  the Node version that installs them.
- **Branches and PRs:** branch from `main` and open PRs against `main`, never
  against another feature branch.
