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
RUN npx ng build --configuration=production --base-href /vinyl-collection/

# Caddy serves the built static SPA and reverse-proxies the API path —
# see Caddyfile. Caddy itself isn't exposed to the host or the public
# internet at all anymore: a separate cloudflared container is the only
# thing that talks to it, over Cloudflare Tunnel (see docker-compose.yml
# and DEPLOYMENT.md).
FROM caddy:2 AS runtime
COPY --from=build /app/dist/frontend/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
