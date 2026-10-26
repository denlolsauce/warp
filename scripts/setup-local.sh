#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
node <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = 'apps/web/.env';
if (!fs.existsSync(path)) {
  const secret = () => crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(path, [
    'DATABASE_URL="postgresql://portal:portal_dev@127.0.0.1:5432/portal"',
    'REDIS_URL="redis://127.0.0.1:6379"',
    `AUTH_SECRET="${secret()}"`,
    'AUTH_TRUST_HOST="true"',
    'ENABLE_LOCAL_DEMO="true"',
    'NEXT_PUBLIC_APP_URL="http://localhost:3000"',
    `WORKER_CALLBACK_SECRET="${secret()}"`,
    '',
  ].join('\n'), { mode: 0o600 });
}
JS
docker compose up -d postgres redis
for attempt in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U portal -d portal >/dev/null; then break; fi
  sleep 1
done
pnpm --filter @portal/web exec prisma generate
pnpm --filter @portal/web exec prisma migrate deploy
pnpm --filter @portal/schema build
