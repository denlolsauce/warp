# Known limitations (phase 1 — Foundation)

An honest list of what this codebase does and does not do yet. Nothing below
is hidden behind marketing copy; the website only claims targets, not
achieved benchmarks.

## Not implemented yet or awaiting technical validation

- **Operational pipeline validation.** ODM execution, dense-product creation,
  checkpoint QA, terrain-safe splat processing, change computation, report
  rendering, Postgres stage persistence, and heartbeats are implemented, but
  must be validated on a real pilot survey before any accuracy claim or
  engineering use. The internal GPU images are not yet built and published at
  production digests.
- **Application publication integration.** Publish stages write immutable
  artifact records for the web app to consume, but do not yet materialize
  `SurveyRevision`, `Artifact`, `Comparison`, or `ReportRevision` records in
  the application database. Likewise, successful final-stage callbacks still
  need to transition the `ProcessingRun` to `SUCCEEDED`.
- **Comparison registration application.** Stable-area registration is
  estimated and reported, but its transform is not yet applied to the
  candidate raster/point cloud before change computation.
- **Map and viewer integration.** The workspace still has no map surface,
  and the viewer bundle is not embedded in the web application.
- **GCP authoring.** The worker now requires genuine image observations for
  GCPs and rejects fabricated control data. The web UI only imports JSON, so
  CSV parsing and an image-marking interface remain to be built.
- **OpenAPI and delivery infrastructure.** No OpenAPI document, CI workflow,
  worker Docker images, production backup plan, or benchmark suite exists.
- **Email delivery.** Auth.js magic-link sign-in requires SMTP credentials;
  no provider is configured.

## Deliberate scope boundaries (not planned)

- No slope-stability calculation, failure prediction, or alerting. Warp
  documents change; engineers and their analysis tools own interpretation.
- No continuous monitoring. Periodic survey epochs complement radar, InSAR,
  and prism networks — they do not replace them.
- No measurements from the splat visualization, ever. Engineering numbers
  come only from approved measurement artifacts.
- No self-service signup or payment. Pilot customers are invited; pricing is
  per-site subscription by contact.

## Accuracy claims

The 2–5 cm accuracy figure on the marketing site is a **target** for suitable
sites flown with adequate ground control, verified per survey against
independent checkpoints. It is not an achieved benchmark of this codebase —
no end-to-end survey has been processed yet. A reviewed pilot on one real
site is the gate before any broader commercial use.
