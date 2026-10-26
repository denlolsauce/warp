# Drone workspace backend

This backend keeps the existing `Product` and `Job` records and adds drone capture metadata to new projects. New uploads create `Product.captureProfile = "drone"`; existing rows are migrated with `"product"` so worker behavior and stored data remain unchanged.

## Setup

Apply the additive migration before serving requests:

```sh
pnpm --filter @portal/web exec prisma migrate deploy
pnpm --filter @portal/web exec prisma generate
```

The web service needs `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `WORKER_CALLBACK_SECRET`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. R2 uses `R2_ACCOUNT_ID`; S3-compatible local storage may instead use `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` (plus `S3_REGION` if required). `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM`, and `NEXT_PUBLIC_APP_URL` are used for ready-email links.

For local development only, set `ENABLE_LOCAL_DEMO=true` to enable `GET /api/dev/session` and `POST /api/dev/session`. GET returns `{ "available": true }`; POST creates/reuses a demo user, organization, membership, and Auth.js-compatible database session cookie. Both endpoints return 404 in production or unless explicitly enabled; production authentication remains the existing Auth.js magic-link flow. The UI should call POST only from an explicit “enter live workspace” action. A newly authenticated production user without a membership gets a personal default workspace on first API access. Demo preview fixtures, including the `/share/demo` sample, remain client-owned and are not served by these APIs.

## Upload then create a project

Uploads go directly to object storage using the existing multipart protocol. Every upload is stored in an `UploadSession` owned by the authenticated user. Part URLs are only issued for that owner's active session, and completing or aborting it disables further part URL requests.

1. `POST /api/uploads/initiate` with `{ "filename": "flight.mp4", "contentType": "video/mp4", "sizeBytes": 1234 }` (`sizeBytes` is optional; the completed object is checked against the 2 GB limit).
   Returns `{ "key": "videos/pending/...", "uploadId": "..." }`.
2. For each part, call `POST /api/uploads/part-url` with `{ "key", "uploadId", "partNumber" }`, PUT the bytes to the returned URL, and collect each response ETag.
3. `POST /api/uploads/complete` with `{ "key", "uploadId", "parts": [{ "partNumber": 1, "etag": "..." }] }`. The server verifies the stored object size and marks the session complete. Repeating a successful completion is safe.
4. `POST /api/projects` with `{ "name": "North lot", "description": "", "location": "Seattle, WA", "uploadId": "...", "key": "videos/pending/..." }`. `key` is optional but, when supplied, must match the owner-bound session. This atomically consumes the completed session, creates the Product/Video/Job, then queues the existing Python worker message. Repeating the request returns the project instead of creating a second one. The DTO shows all stages as PENDING until the worker creates real attempt rows; this keeps its initial attempt number at 1.

The response is `{ "project": ProjectDto }`. The worker still receives `{ jobId, productId }`; no new queue format or pipeline callback URL is required.

## Project endpoints

All project endpoints require a signed-in user with an organization membership and scope results by the oldest organization by creation date. A workspace selector is not part of this backend contract yet.

- `GET /api/projects` → `{ projects: ProjectDto[], workspace: { name, plan }, mode: "live", configured: { storage: boolean, worker: boolean } }`. These are presence-only readiness signals: storage means the bucket, credentials, and R2 account ID or S3 endpoint are set; worker means `WORKER_CALLBACK_SECRET` is set. Neither signal discloses a value or confirms remote service/GPU health.
- `GET /api/projects/:id` → `{ project: ProjectDto }`.
- `PATCH /api/projects/:id` accepts only `name`, `description`, and `location` and returns `{ project }`.
- `DELETE /api/projects/:id` removes an idle project and its objects. Queued/running projects return 409 because the worker has no cancellation protocol.
- `POST /api/projects/:id/regenerate` creates a fresh Job. A queued job is returned/enqueued idempotently; running jobs return 409. Pending stages are synthesized in the DTO until worker attempt rows exist.
- `POST /api/projects/:id/share` with `{ "enabled": true|false }` toggles public sharing. Enabling requires a READY project. The response is `{ shared, shareToken, sharePath }`, where the path is `/share/:token` for the UI.
- `GET /api/shares/:token` is unauthenticated and returns `{ project }` only while the exact token is enabled and the project is READY; otherwise it returns 404.

`ProjectDto` contains `id`, `name`, `description`, `location`, `captureProfile`, `status`, `createdAt`, `shared`, `shareToken`, `sogUrl`, `plyUrl`, `sizeBytes`, and `job`. Asset URLs are signed for 15 minutes when storage is configured; otherwise they are `null`. Storage keys and other storage metadata are not included as DTO fields. Disable sharing by posting `{ "enabled": false }`; previously issued signed asset URLs remain valid until expiry.

If storage variables are absent, multipart initiate/part-url/complete return 503 with an actionable storage-configuration error instead of attempting S3. Direct-to-storage upload is still the production upload contract; no server-proxied upload or local fake object store is provided.

## Worker callback

`POST /api/jobs/:id/complete` remains authenticated by `x-worker-secret`. It validates a complete success payload before changing state, accepts only content-hashed keys under that product's `products/:productId/` prefix, and atomically writes terminal job/product state and output assets. Duplicate terminal callbacks return success without rewriting assets or changing the recorded outcome. Failure callbacks must include a specific non-empty `errorMessage`.
