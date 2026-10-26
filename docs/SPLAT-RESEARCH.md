# Drone splatting: practical updates

Reviewed 26 October 2026. This is a compatibility and licensing review, not a benchmark of our drone footage. No claimed paper speedup has been reproduced in this workspace.

## What we already have

The trainer uses gsplat MCMC densification with a bounded Gaussian budget, antialiasing, and bilateral-grid exposure correction. The existing defaults are 15,000 training steps and a 600,000-Gaussian cap. gsplat's published evaluation shows useful quality/memory trade-offs for capped MCMC; those A100 results are not a turnaround guarantee for our deployment.

- [gsplat evaluation](https://docs.gsplat.studio/main/tests/eval.html)
- `pipeline/src/splat_pipeline/train.py`

The new `drone` cleanup profile preserves terrain, disconnected site structures, coordinate scale and orientation. It retains opacity, scale and spatial-density pruning, but does **not** use product SAM masks, remove a support plane, isolate the largest connected object, or normalize arbitrary reconstruction units to metres. This is the immediately applicable correctness change for engineering scenes. It does not remove moving vehicles or people, georeference a scene, or establish measurement accuracy.

## Recommended next experiments

| Candidate | Why it matters | Compatibility / deployment decision |
| --- | --- | --- |
| **Upstream PPISP** | Correct exposure, vignetting and camera response differences that hurt realism on changing drone viewpoints. | Already available as a custom isolated opt-in in this repo. Upstream gsplat PR #1003 merged July 20, 2026 and documents `--post_processing ppisp`, not our custom `--use-ppisp`. Pin the trainer commit and migrate the command contract with a representative A/B test before replacing the custom checkout. |
| **Streamed SOG / LOD** | Load detailed regions on demand rather than decoding the entire large site at once. Better initial load and mobile memory behavior. | PlayCanvas documents SplatTransform output `lod-meta.json` and spatially streamed LOD. Our viewer currently loads a single SOG and the workspace pins engine 2.21.3. Validate API/format compatibility, resource disposal and CDN caching before changing that contract. Keep source PLYs. |
| **FastGS (CVPR 2026)** | Promising multi-view-consistency-driven densification/pruning for faster training. | Not a drop-in gsplat-MCMC option. The repo lists MIT but explicitly inherits 3DGS/Taming-3DGS/Speedy-Splat license obligations; its Mip-Splatting backbone enhancement is still listed as unreleased. Resolve inherited commercial-use terms and benchmark quality on drone scenes before adoption. |
| **Speedy-Splat (CVPR 2025)** | Aggressive importance-aware pruning and sparse rasterization reduce scene size and rendering work. | The published implementation's license is noncommercial research/evaluation absent explicit consent. Do not copy it into the commercial service without appropriate permission. Its renderer is not a PlayCanvas engine replacement. |
| **DroneSplat (CVPR 2025)** | Specifically targets dynamic distractors and difficult novel drone viewpoints. A useful direction for vehicle/people masks and reconstruction robustness. | The project uses DUSt3R, licensed CC BY-NC-SA 4.0. The top-level project's license does not waive third-party restrictions. Evaluate commercially permissible moving-object masks separately rather than adding the full dependency chain blindly. |

Sources:

- [Official gsplat PPISP integration](https://github.com/nerfstudio-project/gsplat/pull/1003)
- [PlayCanvas streamed SOG guide](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/lod-streaming/)
- [SplatTransform streamed SOG](https://developer.playcanvas.com/user-manual/splat-transform/streamed-sog/)
- [FastGS official implementation and license notices](https://github.com/fastgs/FastGS)
- [FastGS CVPR 2026 paper](https://openaccess.thecvf.com/content/CVPR2026/html/Ren_FastGS_Training_3D_Gaussian_Splatting_in_100_Seconds_CVPR_2026_paper.html)
- [Speedy-Splat license](https://raw.githubusercontent.com/j-alex-hanson/speedy-splat/speedy-splat/LICENSE.md)
- [DroneSplat official implementation](https://github.com/BITyia/DroneSplat)
- [DUSt3R license](https://github.com/naver/dust3r/blob/main/LICENSE)

## Benchmark gate

Use the same cleared-for-use drone captures and held-out views for each experiment. Compare GPU minutes, peak memory, registration rate, visible floaters, held-out image quality, delivered bytes and browser load time. Preserve the current baseline until the candidate improves its intended metric without losing thin structures, terrain coverage or licensing compatibility. Do not present visual reconstruction as survey-grade geometry.
