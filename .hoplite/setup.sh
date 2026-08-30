#!/usr/bin/env bash
set -euo pipefail

# Local infra: Postgres + Redis. `docker compose up -d` is the normal path,
# but the Hoplite sandbox Docker policy rejects volume mounts, so fall back
# to volume-less containers there (dev data need not survive the sandbox).
if ! docker compose up -d 2>/dev/null; then
  docker ps --format '{{.Names}}' | grep -qx pg || \
    docker run -d --name pg -p 5432:5432 \
      -e POSTGRES_USER=portal -e POSTGRES_PASSWORD=portal_dev -e POSTGRES_DB=portal \
      postgres:16-alpine
  docker ps --format '{{.Names}}' | grep -qx redis || \
    docker run -d --name redis -p 6379:6379 redis:7-alpine
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
  pg_ok=$(docker exec "$(docker ps -qf name=postgres -qf name=pg | head -1)" pg_isready -U portal 2>/dev/null || true)
  case "$pg_ok" in *"accepting connections"*) break;; esac
  sleep 1
done

pnpm -C apps/web exec prisma migrate deploy
pnpm -C apps/web exec prisma generate
pnpm -C apps/web exec tsx prisma/seed.ts
