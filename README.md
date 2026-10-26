# WARP — drone footage to a shared perspective

A light, project-based workspace for engineering and construction teams. Upload a drone video directly to object storage, follow a queued reconstruction, explore its Gaussian splat, and share a revocable, view-only link.

## Run the web suite locally

Requirements: the repository's Node / pnpm versions, Docker Compose, and the existing Python 3.11 pipeline toolchain for CPU tests.

```sh
pnpm setup:local
pnpm dev
```

Open `http://localhost:3000`. Setup is idempotent: it installs locked workspace dependencies, starts the existing Postgres/Redis services, creates local-only environment values if no `.env` exists, generates Prisma and applies migrations. The monorepo dev command runs its long-lived watchers in parallel.

The sample workspace is intentionally public and read-only. It includes a **real** house SOG from the user-provided [DroneModels reference](https://dronemodels.vercel.app/product-preview.html?sog=/house-original.sog), not a simulated processing result. Confirm rights for redistribution of that third-party sample before deploying a public commercial demo. Replace `apps/web/public/demo/` with a cleared-for-use capture if needed.

To exercise authenticated APIs locally, open **Settings → Open local development workspace**. This explicit development-only session route requires `ENABLE_LOCAL_DEMO=true` and is disabled in production. It creates an empty local workspace; sample projects are never silently added to real accounts. Real users sign in with an SMTP-delivered magic link and receive a private workspace on first access.

## What is implemented

- Project dashboard, search, grid/list layouts, processing and shared-link views.
- Capture guidance before file selection; browser metadata validation; cancellable, direct-to-S3 multipart uploads with byte progress.
- User-owned upload sessions, organization-scoped project APIs, idempotent project creation and plain JSON Redis queueing.
- Per-stage status, specific failure messages, regeneration and deletion.
- Real PlayCanvas SOG rendering: orbit, shift/right-drag pan, zoom/pinch, top view, reset, exposure and full screen.
- Private-by-default projects and token-based public read-only viewers. Revoking a link prevents new page/asset resolution; already-issued signed asset URLs remain valid for up to **15 minutes**, and downloaded/cached assets cannot be recalled.
- A separate `drone` cleanup profile using the existing floater pruning, without product-only segmentation, ground removal, object isolation or invented metric scaling.

Splats here are for **visual inspection**, not survey-grade measurements. Reconstructions are not georeferenced or metrically calibrated.

## Connect real processing

The app server and GPU worker remain separate deployables. No 4K video is proxied through Next.js and no training runs in an HTTP handler.

1. Configure `apps/web/.env` using the variable names in the API guide: Postgres, Redis, Auth.js, SMTP, R2/S3 bucket credentials and `WORKER_CALLBACK_SECRET`. For deployment, set secrets in the hosting environment, not in source control. Disable `ENABLE_LOCAL_DEMO` outside local development.
2. Configure the bucket to allow browser `PUT`, expose `ETag`, and permit the deployed app origin. Keep private source videos private. Viewer downloads use short-lived signed GET URLs.
3. Provision the separate GPU worker with the compatible COLMAP/GLOMAP and gsplat trainer described in [`pipeline/README.md`](pipeline/README.md), configure its storage/DB/Redis/callback environment, then run `splat-worker`.
4. Use the production app origin for `NEXT_PUBLIC_APP_URL`, configure SMTP, and ensure the worker can reach the authenticated callback.
5. Validate a cleared-for-use real drone capture end-to-end on the chosen GPU before promising turnaround or reconstruction quality.

The supplied workspace has no R2 credentials or GPU worker. The app therefore exposes missing-connection states and actionable failures; it does not fake job progress or claim an uploaded video was trained. CPU tests and the provided sample viewer can run without a GPU.

## Verification and further reading

```sh
pnpm typecheck
pnpm build
pnpm --filter @portal/web test
pnpm test:pipeline
```

- [API contracts, configuration and security](docs/WORKSPACE-API.md)
- [Pipeline stages, drone CLI and GPU prerequisites](pipeline/README.md)
- [Current Gaussian splatting improvements and licensing review](docs/SPLAT-RESEARCH.md)
