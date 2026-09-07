#!/usr/bin/env bash
set -euo pipefail

# Local infra: Postgres + Redis. `docker compose up -d` is the normal path,
# but the Hoplite sandbox Docker policy rejects volume mounts and any
# published port that does not bind explicitly to loopback, so fall back to
# volume-less loopback-bound containers there (dev data need not survive).
if ! docker compose up -d 2>/dev/null; then
  # Restart containers left behind by an earlier setup before creating new ones.
  docker start pg redis >/dev/null 2>&1 || true
  docker ps --format '{{.Names}}' | grep -qx pg || \
    docker run -d --name pg -p 127.0.0.1:5432:5432 \
      -e POSTGRES_USER=portal -e POSTGRES_PASSWORD=portal_dev -e POSTGRES_DB=portal \
      postgres:16-alpine
  docker ps --format '{{.Names}}' | grep -qx redis || \
    docker run -d --name redis -p 127.0.0.1:6379:6379 redis:7-alpine
fi

pnpm install

# Dev env for apps/web (gitignored; matches docker-compose.yml credentials)
if [ ! -f apps/web/.env ]; then
  cat > apps/web/.env <<'EOF'
DATABASE_URL=postgresql://portal:portal_dev@localhost:5432/portal
REDIS_URL=redis://localhost:6379

AUTH_SECRET=dev-secret-not-for-prod-0123456789abcdef

EMAIL_SERVER_HOST=localhost
EMAIL_SERVER_PORT=1025
EMAIL_SERVER_USER=dev
EMAIL_SERVER_PASSWORD=dev
EMAIL_FROM=dev@localhost

# No SMTP in the sandbox, so magic links can't be delivered; enables the
# dev-only sign-in button on /signin (refused when NODE_ENV=production).
ALLOW_DEV_SIGNIN=true

R2_ACCOUNT_ID=dev
R2_ACCESS_KEY_ID=dev
R2_SECRET_ACCESS_KEY=dev
R2_BUCKET_NAME=dev

WORKER_CALLBACK_SECRET=dev-worker-secret

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_VIEWER_URL=http://localhost:5173
EOF
fi

# Wait for Postgres before migrating
for i in $(seq 1 30); do
  docker exec pg pg_isready -U portal >/dev/null 2>&1 && break
  docker compose exec -T postgres pg_isready -U portal >/dev/null 2>&1 && break
  sleep 1
done

# Invoke the hoisted binaries directly rather than through `pnpm -C … exec`:
# each nested pnpm adds a node process, and in a memory-constrained sandbox
# the extra resident set is enough for the memory guard to SIGTERM prisma.
set -a
. ./apps/web/.env
set +a
(cd apps/web && ../../node_modules/.bin/prisma migrate deploy)
(cd apps/web && ../../node_modules/.bin/prisma generate)
(cd apps/web && ../../node_modules/.bin/tsx prisma/seed.ts)
