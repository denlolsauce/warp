# Known limitations (phase 1 — Foundation)

An honest list of what this codebase does and does not do yet. Nothing below
is hidden behind marketing copy; the website only claims targets, not
achieved benchmarks.

## Not implemented yet (stubbed behind interfaces)

- **Photogrammetry execution.** `services/pipeline` validates inputs, builds
  the OpenDroneMap configuration and CLI invocation, and maps expected
  outputs, but does not run the ODM container. `reconstruct()` raises
  `NotImplementedError` at the execution point.
- **Splat training and SOG compression.** The visualization branch stages
  (`CAMERA_ADAPTATION` → `PUBLISH_VISUALIZATION`) are defined in contracts
  and the worker dispatch, but their handlers are stubs.
- **Comparisons.** Elevation differencing and M3C2 are contract-defined
  (including the fixed sign convention and uncertainty fields) but not
  computed. The seeded comparison manifest is synthetic sample data.
- **Report PDF rendering.** `ReportRevision.reportData` is the canonical
  record; PDF generation from it is not implemented.
- **Checkpoint QA computation.** The contract requires independent
  checkpoints withheld from optimization; the residual computation itself is
  not implemented. Every real survey therefore remains `UNVERIFIED` until it
  is.
- **Worker heartbeat thread and DB-backed run store.** The pipeline worker
  uses an in-memory run store in tests; Postgres persistence wiring is
  pending.
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
