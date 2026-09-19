# syntax=docker/dockerfile:1
#
# Build natively on the target machine (the Raspberry Pi) — see
# backend/Dockerfile's note on why cross-compiling elsewhere is best
# avoided even though the frontend itself has no native dependencies.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration=production

# Caddy both serves the built static SPA and reverse-proxies /api/* to
# the backend — see Caddyfile. This is the single public-facing
# container; the backend is not exposed to the host at all.
FROM caddy:2 AS runtime
COPY --from=build /app/dist/frontend/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
