# Vendored code provenance

Selected implementation patterns and code were vendored from the existing Warp
product-scan repository (`denlolsauce/warp`) at commit:

```
07d17f8cb17375ac77044acf673e18ec9030ec0a
```

The upstream repository is a read-only pattern source. Nothing in `warp-survey`
imports from it or requires it at runtime.

## What was vendored (and adapted)

| Destination | Upstream source | Adaptation |
|---|---|---|
| `apps/web/src/lib/storage.ts` | `apps/web/src/lib/r2.ts` | Renamed for provider neutrality; bucket/env names namespaced `SURVEY_*`; added GET presigning for short-lived downloads |
| `apps/web/src/lib/auth.ts` | `apps/web/src/lib/auth.ts` | Same Auth.js + Prisma adapter + email-magic-link pattern; independent secrets and cookie configuration |
| `apps/web/src/lib/prisma.ts` | `apps/web/src/lib/prisma.ts` | Unchanged pattern (global client) |
| `apps/web/src/app/api/v1/uploads/*` | `apps/web/src/app/api/uploads/*` | Direct-to-storage multipart flow retained; rebound to `CaptureFile`/`Survey` with tenant authorization |
| `services/pipeline` (structure, subprocess/error style) | `pipeline/src/splat_pipeline/*` | Append-only stage-attempt lifecycle and structured-logging conventions retained; queue rewritten for reliable claiming with leases and fencing |
| `apps/viewer` (PlayCanvas bootstrap, SOG loading, damped camera input) | `apps/viewer/src/*` | Object-orbit constraints replaced with orbit/pan/free-flight for terrain; local-origin handling added; product-specific preview code not vendored |
| `apps/viewer/src` (v2: survey manifest loader, camera controller, loading UI, info panel) | `apps/viewer/src/*` | New patterns for survey-specific contracts; Vite + web component setup; geospatial coordinate and local-origin display; "visualization only — not for measurement" warning layer |

## What was deliberately NOT vendored

- Object cleanup (SAM 2 segmentation, support-surface removal, orientation
  heuristics, size normalization). These are correct for products and **wrong
  for terrain measurement**; the survey pipeline replaces them with
  conservative terrain-safe processing that never touches measurement
  artifacts.
- The `SceneManifest` / product manifest schemas. Survey contracts are new
  (`packages/contracts`) and carry CRS, vertical datum, transforms, and
  provenance that the upstream schema has no notion of.
- The simple `LPUSH`/`BRPOP` queue. Survey processing requires reliable
  claiming (pending/in-flight lists, leases, heartbeats, reaping, lease
  fencing) and a transactional outbox.
- Shopify/commerce, waitlist, gallery, and all customer-facing content.

No upstream files carried license headers or third-party notices; the upstream
repository is first-party proprietary code owned by the same organization.
