#!/bin/sh
set -e

# `migrate deploy` only applies pending migrations and is a safe no-op
# when the database is already up to date — running it on every
# container start keeps the schema current after a `git pull` that
# brought new migrations, with no separate manual step to remember.
echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting server..."
exec node dist/main
