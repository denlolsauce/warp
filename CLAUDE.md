1. Master Context
Project: Voxel (placeholder name, taken from the `<voxel-viewer>` embed tag below — rename freely)
Voxel converts a merchant's product video into an embeddable, interactive 3D Gaussian splat for e-commerce product pages. A merchant signs up, uploads a 2-4 minute video of a single product (shot as 3-4 orbits at different heights plus a top-down pass, on a phone or DSLR). The system processes it asynchronously and returns a web-optimised 3D model the merchant can rotate and zoom in a browser, plus a one-line embed snippet they paste into their product page.

Target turnaround: under 2 hours per job. Target delivered asset size: 4-20MB.

Architecture (two deployables, must be respected from day one):

* Web app (CPU, always on) — Next.js (App Router) + TypeScript + Tailwind. Postgres via Prisma; S3-compatible object storage (Cloudflare R2 or S3). Auth with organisations/workspaces — merchants have teams. Job queue: a plain Redis list, not BullMQ/Inngest (see Stack, below, for why). Uploads go direct-to-storage via presigned multipart URLs — never proxy a 4K video through the app server.
* Pipeline worker (GPU, autoscaled) — Python, containerised, deployed on Modal or RunPod serverless with an A10G/L4-class GPU. Pulls jobs from the queue, writes artifacts back to object storage, posts status via webhook. Must be idempotent and resumable per stage — a crash in training must not re-run SfM.

Phase 1 scope: one merchant's real catalogue looking good end to end, before generalising further. Every pipeline stage is a discrete, independently testable function with its artifacts persisted, so any stage can be re-run in isolation.

Repo layout:

* `apps/web` — Next.js app: merchant UI, API routes, Prisma schema/migrations.
* `apps/viewer` — PlayCanvas viewer + the `<voxel-viewer>` web component bundle.
* `pipeline` — Python pipeline worker (`splat_pipeline` package). Stages: `ingest` → `extract` → `sfm` → `train` → `cleanup` → `compress`, orchestrated by `worker.py` against the job state machine below. See `pipeline/README.md` for the manual CLI walkthrough and known gotchas.
* `packages/schema` — shared TS/zod types for the pipeline-output/viewer manifest contract. Still holds the old property-tour `SceneManifest` (areas/overview/nav/floorplan) — this is the next piece that needs reworking: a new, much simpler product-manifest schema (one SOG asset, bounds, default camera) before the viewer or a `PUBLISH`-stage manifest can be built.

Data model (`apps/web/prisma/schema.prisma`):

* `Organization` / `Membership` — merchant accounts and teams. A `User` can belong to more than one `Organization`; `Membership.role` is OWNER/ADMIN/MEMBER.
* `Product` — one per uploaded item, owned by an `Organization`. `ProductVideo` is 1:1 with `Product` (v1 is one video per product).
* `Job` — one per processing attempt (initial upload, or a merchant-triggered "regenerate"). Holds overall `status` and `currentStage`, not per-stage detail.
* `JobStageRun` — one row per (job, stage, attempt), append-only. Carries `status`, `metrics` (Json — stage-specific numbers like registration rate or Gaussian count, for the timing/cost log the non-negotiables require), and `artifactKey` (that stage's persisted output, for resuming without recomputing it).
* `Asset` — the PLY/SOG/poster/turntable-video outputs of a finished job, with `contentHash` for the immutable CDN URLs the Publish stage writes.
* Usage metering (merchant UI requirement, below) is derived by counting `Job` rows per `Organization` per period rather than a separate ledger table — add one only if plan limits turn out to need something a count can't answer.

Job state machine (`apps/web/src/lib/jobStateMachine.ts`):

* Stage order is fixed — `STAGE_ORDER`: INGEST → FRAME_EXTRACTION → POSE_ESTIMATION → TRAINING → CLEANUP → COMPRESSION → PUBLISH.
* `Job.status`: QUEUED → RUNNING → (SUCCEEDED | FAILED). Terminal states don't transition further; a retry is a new `Job`, not a reopened one.
* `JobStageRun.status`: PENDING → RUNNING → (SUCCEEDED | FAILED), also terminal — a retried stage is a new `JobStageRun` row at `attempt + 1`, never a reused row.
* Resume rule (`resumeStage()`): a (re)started worker finds the first stage in fixed order whose latest attempt isn't SUCCEEDED, and resumes from that stage's `artifactKey` rather than recomputing earlier stages. This is what "idempotent and resumable per stage" (Architecture, above) means concretely.
* Failure messages are written to `JobStageRun.errorMessage` at the stage that actually failed, and copied up to `Job.errorMessage` for display — always the specific reason (non-negotiables, below), never a generic "job failed".

Pipeline stages:

1. Ingest — validate container/codec with `ffprobe`. Reject videos with heavy rolling-shutter warping, under 60s, or above 4K60.
2. Frame extraction — `ffmpeg` to extract ~250-400 frames. Score each frame with a variance-of-Laplacian sharpness metric and drop the blurriest within a sliding window, rather than sampling at a fixed interval. Blur is the single largest quality killer.
3. Pose estimation — GLOMAP (faster and more robust than vanilla COLMAP) as the default. Build the interface so a feed-forward estimator (VGGT / MASt3R) can be swapped in as a fallback when SfM fails to register — which it will, on low-texture or glossy products. Log registration rate; treat under 80% registered as a failed job.
4. Training — gsplat (nerfstudio's splatfacto). MCMC densification with a hard cap on Gaussian count (target 300k-800k for a single object). Object-centric scenes converge in far fewer iterations than the paper defaults suggest — start at 15k and tune.
5. Cleanup — this is where perceived quality actually comes from:
   * Segment the product with SAM 2 on the input frames; use the masks to prune background Gaussians.
   * Detect and remove the support surface via RANSAC plane fit.
   * Prune floaters by opacity and scale thresholds, plus a k-NN spatial-density filter.
   * Recentre at the object's centroid, align its up-axis, normalise scale to real-world metres so AR placement is correct later.
6. Compression — `@playcanvas/splat-transform` CLI to write `.sog`. Keep the source `.ply` in cold storage for reprocessing and for customers who want the raw file.
7. Publish — push SOG to CDN with long cache TTLs and immutable content-hashed URLs.

Pose-estimation and training sit behind interfaces from day one; both will be replaced within a year.

Viewer and embed:

* Render with the PlayCanvas engine (native SOG support). Do not write a custom splat rasteriser.
* Ship the viewer as a standalone JS bundle served from CDN, mounted into a web component (`<voxel-viewer model-id="...">`) so the embed is one script tag plus one element and cannot collide with the host page's CSS or framework.
* Orbit + zoom with damping, pinch on touch, constrained polar angle so users can't fly under the floor.
* Progressive load: low-Gaussian-count preview first, poster image shown until first render.
* WebGL2 capability check with graceful fallback to a rendered turntable video.
* Lazy-init on intersection observer — product pages have Core Web Vitals budgets; 400ms of added LCP loses the merchant.

Merchant-facing UI:

* Upload flow with a capture-guidance checklist shown before the file picker.
* Job list with per-stage progress, not a single indeterminate spinner — a 2-hour opaque wait is unacceptable UX.
* Model detail page: live viewer, embed snippet with copy button, download PLY/SOG, regenerate, delete.
* Simple editor: reframe/recentre, set default camera angle, adjust exposure, manually brush out remaining floaters.
* Usage metering against plan limits.

Explicit non-goals for v1: no AR, no AI background generation, no hotspots, no mesh extraction, no Shopify app. Get one merchant's real catalogue looking good end to end first.

Stack:

* Pipeline: Python (containerised), ffmpeg, GLOMAP (COLMAP fallback), VGGT/MASt3R (feed-forward fallback), gsplat (MCMC) via splatfacto, SAM 2
* Photometric correction (training): PPISP (exposure/vignetting/color/CRF) as an opt-in alternative to gsplat's built-in bilateral grid — `TrainConfig.use_ppisp`, runs against a second, hand-patched gsplat checkout (`SPLAT_GSPLAT_PPISP_PYTHON`) kept isolated from the default training venv; see `pipeline/README.md`
* Compression: `@playcanvas/splat-transform` → SOG (source `.ply` kept in cold storage)
* Viewer: PlayCanvas Engine, shipped as a standalone CDN-hosted web component
* App: Next.js (App Router), TypeScript, Tailwind, Postgres via Prisma, S3-compatible storage (Cloudflare R2)
* Queue: a plain Redis list (`products:pipeline:jobs`, see `apps/web/src/lib/queue.ts`), not BullMQ/Inngest — the consumer is a separate Python process, not a Node process, so the wire format has to stay a language-agnostic JSON payload rather than a Node-only job encoding
* Deploy: web app CPU/always-on; pipeline worker GPU — Modal vs. RunPod not yet decided, both remain candidates until one is actually provisioned

Non-negotiables:

* Every pipeline stage logs structured events with timings and cost — GPU minutes per job is the metric the business lives or dies on.
* Fail loudly with a specific, human-readable reason ("only 62% of frames registered — the product may have moved during capture") rather than a generic error.
* Never proxy a 4K video through the app server — uploads go direct-to-storage via presigned URLs.
* Every long-running operation is a queued job with a status row, never a blocking HTTP request.
* Never store secrets in client code.
* Pose-estimation and training live behind swappable interfaces from day one — both will be replaced within a year.

First deliverable: scaffold the repo, the data model, and the job state machine. Show that before writing any pipeline code.
