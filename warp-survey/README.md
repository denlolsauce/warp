# Warp for engineering surveys

Warp turns repeat drone surveys into two linked deliverables from the same flight:

- A validated, georeferenced dense point cloud and elevation model for measurement
  and change detection (the **measurement branch**).
- A photorealistic Gaussian Splat for browser-based stakeholder communication
  (the **visualization branch**).

It serves geotechnical consultancies, mine survey teams, and civil/infrastructure
engineers documenting slopes, excavations, embankments, and earthworks. Warp
supplies evidence to engineers and their existing analysis tools — it does not
calculate slope stability, predict failure, or replace continuous monitoring.

## Separation from the existing Warp product

This directory is a **self-contained monorepo** with its own applications,
database schema, authentication configuration, storage buckets, Redis keys, and
deployment. It shares nothing at runtime with the existing product-scan Warp.

It is developed inside the same Git repository for review convenience and is
designed to be extracted verbatim into its own `warp-survey` repository (every
path, script, and container definition is relative to this directory). Selected
code was vendored from the existing Warp implementation — see
[`VENDORED.md`](./VENDORED.md) for exact provenance and the recorded upstream
commit. Nothing here depends on the original code being present at runtime.

## Layout

| Path | Responsibility |
|---|---|
| `apps/web` | Next.js App Router marketing website, survey workspace, `/api/v1`, Prisma schema |
| `apps/viewer` | Independent PlayCanvas splat viewer bundle |
| `packages/contracts` | Versioned API, job, artifact, and viewer contracts (zod → JSON Schema) |
| `services/pipeline` | Python orchestration: photogrammetry, splat processing, comparisons, QA |
| `infra` | Container definitions, local dev environment, deployment documentation |

## Development

Prereqs: Node ≥ 20, pnpm 9, Python ≥ 3.11 with `uv`, Docker.

```bash
cd warp-survey
pnpm install
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis + MinIO
cp apps/web/.env.example apps/web/.env             # then fill AUTH_SECRET etc.
pnpm --filter @warp-survey/web run prisma:migrate
pnpm --filter @warp-survey/web run prisma:seed     # synthetic demo data
pnpm dev
```

Pipeline worker:

```bash
cd services/pipeline
uv venv && uv pip install -e '.[dev]'
uv run pytest
```

Deployment and worker notes are in `infra/README.md`.

## Delivery status

This codebase implements **phase 1 (Foundation)** of the delivery sequence:
repository scaffold, contracts, authentication, domain model and migrations,
durable job plumbing (reliable Redis claiming + transactional outbox), the
`/api/v1` surface, the survey workspace shell, and the marketing website.

Photogrammetry execution (OpenDroneMap container), splat training, comparisons
(elevation differencing, M3C2), and report generation are stubbed behind their
interfaces and land in phases 2–3. See `LIMITATIONS.md` for the honest list.
