1. Master Context
Project: Portal
Portal turns phone video of a property into a photorealistic, explorable 3D tour that runs in any browser. No app, no headset, no special hardware.
Architecture (two-tier, must be respected from day one):

* An overview splat covers the whole property at lower detail. It loads immediately and is never unloaded. It is the substrate the user always stands in.
* Per-area splats (5-10 MB each) are high detail and stream in when the user crosses into that area, cross-fading over the corresponding overview region.
* All splats share one global coordinate frame, produced by a single joint SfM run over every video. There is no post-hoc alignment step.
* The viewer camera is constrained to a tube around the SfM capture trajectory. Splat quality collapses away from training camera positions, so the recorded path defines the navigable volume.

Phase 1 scope: one room, one video, one splat, one viewer. But the data model, manifest schema and viewer must be built so Phase 2 (multi-area) is additive, not a rewrite.
Stack:

* Pipeline: Python 3.11, ffmpeg, OpenCV, COLMAP, GLOMAP, gsplat (MCMC), pycolmap
* Compression: `@playcanvas/splat-transform` → SOG
* Viewer: PlayCanvas Engine (WebGPU with WebGL2 fallback), TypeScript, Vite
* App: Next.js (App Router), Postgres via Prisma, S3-compatible storage (Cloudflare R2)
* Queue: Redis + a Python worker running on a GPU box

Non-negotiables:

* Clamp `devicePixelRatio` to 1.5 in the viewer. Splatting is fill-rate bound.
* Set the Gaussian budget from measured frame time, never from user-agent.
* Never store secrets in client code.
* Every long-running operation is a queued job with a status row, never a blocking HTTP request.
