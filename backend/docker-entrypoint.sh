#!/bin/sh
set -e

# `migrate deploy` only applies pending migrations and is a safe no-op
# when the database is already up to date — running it on every
# container start keeps the schema current after a `git pull` that
# brought new migrations, with no separate manual step to remember.
echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting server..."
# The compiled entry point is dist/src/main.js, not dist/main.js: the
# Prisma client at backend/generated/prisma is real .ts source that has
# to be compiled alongside src/ (see prisma.service.ts's import), and
# since it lives outside src/, tsc's rootDir spans the whole backend/
# directory (pinned explicitly in tsconfig.build.json) rather than just
# src/ — so the output mirrors that: dist/src/... and dist/generated/....
exec node dist/src/main
