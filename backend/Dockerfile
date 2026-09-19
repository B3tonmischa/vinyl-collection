# syntax=docker/dockerfile:1
#
# Multi-stage build. Build this natively on the target machine (the
# Raspberry Pi) rather than cross-compiling elsewhere — sharp and
# better-sqlite3 both ship prebuilt native binaries per-platform, and
# `npm ci` only picks the right one automatically when it actually runs
# on that architecture. See DEPLOYMENT.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript and generate the Prisma client ----
FROM deps AS build
WORKDIR /app
COPY . .
# Needs network access to binaries.prisma.sh to fetch the schema-engine
# binary (Prisma 7 CLI behavior — see architecture-and-data-model.md,
# "Working on this project in a sandboxed environment"). Normal on a
# home network; only a problem in a network-restricted sandbox.
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Full node_modules (including devDependencies) is copied as-is rather
# than pruned — this keeps the Prisma CLI (a devDependency) available for
# `prisma migrate deploy` at container startup, at the cost of a larger
# image. Fine for a personal Pi deployment; revisit if image size ever
# becomes a real constraint.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY package.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
