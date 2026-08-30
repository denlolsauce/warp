# Video → Splat

How to turn a product video into a viewable Gaussian splat, end to end. This
covers the manual CLI path (`splat-pipeline <stage> ...`), which is what you
want for a one-off run or when debugging — the Redis worker (`worker.py`)
wraps the same stages for production use once R2/DB/Redis are configured.

## 1. Filming

- Single product, on a plain background, filling most of the frame.
- Exposure and focus **locked** before you start recording (Samsung: Pro
  Video mode, or tap-and-hold the preview in regular Video mode).
- 3-4 orbits around the product at different heights (low, chest, high),
  finishing with one top-down pass.
- Move slowly and steadily — motion blur is the single largest quality
  killer (see `extract.py`'s blur filter). Keep the product and lighting
  completely still for the whole video.
- Turn off Scene optimizer, video HDR, and heavy digital stabilization
  ("Super Steady") — all three actively work against frame-to-frame
  consistency, which is what the reconstruction depends on.
- 4K/30fps is the sweet spot. Higher resolution/framerate doesn't help —
  frames get extracted at only 2fps regardless — and just means a bigger
  upload.
- 60s-4min total (`ingest.py`'s `MIN_DURATION_SEC` / CLAUDE.md's target).

**Thin, reflective, glossy, or plain surfaces need deliberate extra
attention** — these are exactly the products `sfm`'s registration-rate check
is most likely to fail on:
- Circle them, get closer, capture several distinct angles. Specular
  highlights that shift with viewing angle are a genuinely harder
  reconstruction problem than general blur, and more frames from the same
  orbit doesn't fix it.
- SIFT feature matching needs texture to lock onto. If the product itself is
  glossy or plain, even lighting and a matte, patterned background matter
  more than usual.

## 2. Environment

Required, with the specific versions/formats that actually work — the
generic "just install COLMAP" advice will bite you here:

| Tool | Notes |
|---|---|
| `ffmpeg` | Any recent build. Also used by `ingest.py` (via `ffprobe`) to validate the upload. |
| **COLMAP 3.12.6, not newer** | COLMAP ≥4.0 renamed CLI flags and changed its feature-matching database schema in a way GLOMAP 1.2.0 can't read (`SQL logic error`). There is no newer GLOMAP release. If `colmap --version` reports 4.x, you have the wrong build — get 3.12.6 specifically and make sure it resolves first on `PATH`. |
| `glomap` | 1.2.0. |
| A **FAISS-format** vocab tree | COLMAP switched from FLANN to FAISS in May 2025. Any vocab tree file predating that (including most publicly distributed ones, e.g. `vocab_tree_flickr100K_words32K.bin`) fails to load on a modern COLMAP build (`Check failed: file_version == 1`). Build your own locally instead: `colmap vocab_tree_builder --database_path <db> --vocab_tree_path <out.bin> --num_visual_words 256 --num_threads 1` against a completed `sfm` run's `db.db` — a few hundred words is plenty for a single-product capture, and this only needs doing once. |
| Node + `@playcanvas/splat-transform` | `npm i -g @playcanvas/splat-transform`. Used for PLY→SOG compression *and* for `cleanup.py`'s final recentre/align/scale transform — see that module's docstring for why rotation is never hand-rolled in Python here. |
| A separate Python venv for `gsplat_trainer` | gsplat's prebuilt wheels are cp310-only, incompatible with this package's own venv. Needs `torch` with CUDA. Point `SPLAT_GSPLAT_PYTHON` at its `python.exe`. |
| A SAM 2 checkpoint (optional) | `cleanup.py`'s background-pruning step. Point `SAM2_CHECKPOINT` at a downloaded checkpoint; without it, `cleanup` skips background pruning (logs a warning) rather than failing — everything downstream still runs. **Not verified against a real checkpoint in this repo's dev environment** — see `Sam2SegmentationBackend`'s docstring before trusting it blind. |
| A *second*, separate venv for PPISP (optional) | `TrainConfig.use_ppisp=True`'s photometric correction. A second clone of gsplat-src with NVIDIA's PPISP hand-patched into `simple_trainer.py` (see that file's `use_ppisp`/`cfg.use_ppisp` additions), kept fully isolated from the default `SPLAT_GSPLAT_PYTHON` venv so an experimental add-on can never break the proven default training path. Point `SPLAT_GSPLAT_PPISP_PYTHON` at its `python.exe`. Building PPISP's CUDA extension needs an actual CUDA Toolkit (`nvcc`) *and* MSVC Build Tools — neither is needed anywhere else in this pipeline, since everything else uses pre-built wheels. |

**Setting up the PPISP venv from scratch**, once `nvcc` and MSVC are installed:
```bash
# 1. Clone gsplat-src at the SAME commit as the default training venv (check
#    with `git log -1` in that checkout) -- the hand-patched local fixes
#    (see git diff against upstream: fused_ssim -> torchmetrics SSIM fallback,
#    a Windows path-separator fix in datasets/colmap.py) must be re-applied
#    on top; they aren't part of upstream gsplat.
# 2. Build a venv with the exact same torch/gsplat/torchvision build as the
#    default venv (matching +cu121 wheels -- installing torchvision or
#    other packages without --no-deps can silently upgrade torch to an
#    incompatible version; always pin/--no-deps when in doubt).
# 3. From the PPISP source: pip install . --no-build-isolation --no-deps
# 4. Create a `gsplat_trainer` shim package in the new venv's site-packages
#    (see the default venv's own site-packages/gsplat_trainer/__main__.py
#    for the exact ~10-line pattern) pointing at the new gsplat-src/examples.
```

`worker.py`'s `configure_tool_paths()` sets sane defaults for the COLMAP/
GLOMAP/gsplat paths (see `DEFAULT_GSPLAT_PYTHON` / `DEFAULT_VOCAB_TREE` /
`DEFAULT_EXTRA_PATH_DIRS`) — update those constants once your tools are
installed rather than re-discovering the right paths every run. The manual
CLI commands below don't call `configure_tool_paths()` automatically, so
either call it yourself first or set the equivalent env vars/`PATH` by hand.

## 3. Running the pipeline

```bash
# From pipeline/, with the venv active (or use .venv/Scripts/splat-pipeline.exe directly)

# 0. Validate the upload (duration, resolution, frame rate) before spending
#    GPU time on it.
splat-pipeline ingest my-product.mp4

# 1. Extract + blur-filter frames (fast, CPU-bound)
splat-pipeline extract my-product.mp4 --workdir work/my-product

# 2. COLMAP+GLOMAP reconstruction. Slowest CPU-bound stage.
splat-pipeline sfm --workdir work/my-product --vocab-tree /path/to/vocab_tree.bin

# 2b. (alternative) Feed-forward poses with VGGT. Seconds of GPU time instead
#     of tens of CPU-minutes — see "Pose backends" below before relying on it.
export SPLAT_VGGT_PYTHON=/path/to/vggt-venv/python.exe
splat-pipeline sfm --workdir work/my-product --backend vggt

# 3. Train with gsplat MCMC. GPU-bound.
export SPLAT_GSPLAT_PYTHON=/path/to/gsplat-venv/python.exe
splat-pipeline train --workdir work/my-product

# 4. Segment, remove the support surface, prune floaters, recentre/align/scale.
splat-pipeline cleanup --workdir work/my-product --sam2-checkpoint /path/to/sam2.pt

# 5. Convert cleaned.ply to SOG.
splat-pipeline compress --workdir work/my-product
```

Each stage reads what the previous one wrote under `--workdir`; rerunning a
stage overwrites its own output but doesn't touch anything upstream, so you
can retry from any point without redoing earlier work. The Redis worker
(`worker.py`) additionally tracks per-stage success/failure in Postgres
(`JobStageRun`) so a crashed job resumes from the first stage that hasn't
succeeded yet, rather than needing a manual re-run — see `db.py`'s
`resume_stage()`.

### Pose backends

The `sfm` stage sits behind a `PoseBackend` interface (`pose.py`) with two
implementations. Both write the same artifact — a COLMAP sparse model at
`<workdir>/sparse/0` — so everything downstream is unaffected by which one
ran.

| | `glomap` (default) | `vggt` |
|---|---|---|
| Method | COLMAP SIFT + sequential/vocab-tree matching, GLOMAP mapper | VGGT-1B feed-forward transformer, no matching |
| Hardware | CPU-bound (GPU only for SIFT extraction) | GPU-bound, needs CUDA |
| Needs a vocab tree | yes | no |
| Frames | all of them | an evenly-spaced subset (`MAX_VGGT_FRAMES`, default 96) — VGGT attends across every frame at once, so VRAM scales with frame count |
| Quality gate | registration rate ≥ 80% | depth confidence, see below |
| Status | proven end to end on real captures | **unverified** |

VGGT is the "feed-forward estimator (VGGT / MASt3R) swapped in as a fallback
when SfM fails to register" that CLAUDE.md's Pose estimation stage calls for.
It is the largest single lever on turnaround time — matching, not training,
is what makes a job take an hour — but it is opt-in until it has been A/B'd
against GLOMAP on real product video, on both output quality and on
`cleanup.py`'s downstream assumptions (its RANSAC plane fit and up-axis
estimate both depend on the poses being metrically sane).

**The quality gate is different, and this is the important part.** SfM
*tries* to register each frame and reports how many it managed, so a bad
capture shows up as a low registration rate. A feed-forward estimator emits
a pose for every frame it is handed, unconditionally — registration rate is
structurally 100% and tells you nothing. VGGT's per-pixel depth confidence
is the only signal available, so `verify_vggt_metrics()` gates on the
fraction of depth samples above VGGT's own confidence threshold
(`MIN_CONFIDENT_POINT_FRACTION`, default 50%). That threshold is
provisional: unlike the 80% registration rate, it has not been calibrated
against a known-good and a known-bad capture yet. Do that before trusting
this backend to fail loudly the way the GLOMAP path does.

**Environment.** VGGT needs its own venv with torch+CUDA, for the same
reason the gsplat trainer does — point `SPLAT_VGGT_PYTHON` at it. Install
`facebookresearch/vggt` into it (`pip install -r requirements.txt` from its
checkout, plus this package so `python -m splat_pipeline.vggt_runner`
resolves). The 1B checkpoint downloads from HuggingFace on first run and is
cached; a cold GPU box pays that download once. `vggt_runner.py` runs
entirely inside that venv and imports nothing from `splat_pipeline` — the
testable logic lives in `pose.py` on the near side of the subprocess
boundary.

For the worker, set `SPLAT_POSE_BACKEND=vggt` (defaults to `glomap`).

## 4. Known gotchas

These are all things that actually happened running this pipeline for real,
not hypothetical edge cases.

**`sfm` fails immediately with a COLMAP error about `--version` or a faiss
index.** Wrong COLMAP build or legacy vocab tree — see the Environment table
above. Verify with `colmap help` (prints the version banner) before spending
time on anything else.

**A capture registers well below 80% in `sfm` and the stage fails.** This is
a real content problem, not a bug — usually a glossy/reflective product, a
plain low-texture surface, or the product moving during the shot. The error
message suggests a fix. Denser sampling helps partially (see `extract.py`'s
`fps=2` — re-extracting at a higher fps and re-running `sfm` is a cheap
thing to try) but for genuinely low-texture/glossy products the real fix is
reshooting with more even lighting or a temporary matte coating, not more
frames from the same orbit.

**Training finishes (final checkpoint + PLY written, GPU usage drops) but
the process never exits.** `gsplat_trainer`'s optional final
trajectory-video export hangs indefinitely on at least one real Windows
setup. The PLY export happens *before* this — check for
`out/ply/point_cloud_<max_steps - 1>.ply`; if it exists, the actual training
result is safe. Confirm the process is truly stuck (not just slow) by
sampling its CPU time twice a few seconds apart — if it hasn't moved, kill
it.

**`cleanup` recentres correctly but the up-axis looks wrong in the
viewer.** Confirmed the hard way on a real capture (vase2.mp4), not
hypothetical: this was never the Euler-angle conversion
(`apply_alignment_transform`'s `_XY_MIRROR` — `test_apply_alignment_transform_matches_intended_geometry`
already pins that against the real CLI with a genuinely non-trivial
rotation, all three axes nonzero, and it holds). The actual cause was
`fit_plane_ransac` itself: when a capture has no genuine flat support
surface for it to find, it still returns *a* plane — the best-fitting one
available — and that plane's normal can end up nowhere near vertical (83°
off, on vase2.mp4, against a ~10x-worse-than-usual inlier residual).
Sweeping `RANSAC_DISTANCE_RATIO` up and down on that same capture never
brought the angle much under 68°, so this isn't a threshold-tuning
problem — for that capture there just isn't a clean horizontal surface at
any threshold. Fixed by `estimate_up_axis()`: the up direction now comes
from the isolated product's own PCA principal axis (reliable by
construction, given the capture protocol's orbits-around-a-single-product
pattern). Turned out RANSAC's plane isn't automatically trustworthy for
*sign* either, despite that assumption above: also confirmed wrong on
vase2.mp4, in a second real run — once surface removal was correctly
skipped (see the next gotcha), `plane.point` landed just 0.11 units from
the product's own centroid, well inside its own p95 radius, so "which side
of plane.point is the product on" was a near-coin-flip that came up wrong
and rendered the vase upside down despite the axis itself being right by
then. Fixed by `camera_trajectory_up_hint()`: when
`is_plausible_support_surface` has already rejected the plane,
`estimate_up_axis` falls back to a sign derived from camera poses instead
— CLAUDE.md's capture protocol always finishes with one top-down pass, so
the last ~15% of frames (by capture order) are cameras positioned above
the product, independent of any point-cloud geometry. If this happens
again, check `estimate_up_axis`'s logged angle comparison and sign source
before assuming any one signal is at fault.

**`cleanup` prunes almost everything, or almost nothing.** Check the logged
counts for each of the three sub-steps (segmentation vote, RANSAC inlier
count, floater prune) individually — they log separately specifically so a
too-aggressive or too-permissive pass can be isolated to one step rather
than guessed at. A RANSAC plane that's eating the product itself no longer
needs manual `RANSAC_DISTANCE_RATIO` tuning — confirmed on vase2.mp4 that
tuning doesn't actually fix this class of failure (the angle off vertical
stayed 68-83° at every ratio tried, because there was no genuine flat
surface in the capture at all, just a smaller or larger *bad* one).
`is_plausible_support_surface()` now catches this automatically (checks the
plane's inlier residual relative to scene scale) and skips surface removal
entirely rather than risk deleting real product geometry — check for its
warning in the log before assuming a threshold needs adjusting. If
background is still visible in the final result after that, the real fix
is a proper `SAM2_CHECKPOINT` (segmentation happens *before* RANSAC and
isn't affected by this gate).

**The cleaned product looks see-through / ghostly, but the raw training
output doesn't.** Measured on real captures, not assumed: roughly 96% of
what `prune_floaters` removes sits *inside* the product's own volume, not
out in the room. Those are the low-opacity gaussians MCMC scatters through
the object's interior, and although each is individually near-invisible,
alpha compounds — N layers at opacity `a` composite toward `1-(1-a)^N` — so
together they're most of what makes a surface read as solid. Prune them and
the product hollows out. Note this only becomes *visible* once the
background is gone: against the original room those same thin gaussians
composite over real content, which is why the untouched splat looks fine
and the cleaned one doesn't.

`dilate_around_product()` is the fix and runs automatically as the last
masking step: it re-admits every gaussian within a few nearest-neighbour
spacings of a surviving product point, deliberately ignoring opacity, scale
and density (those are precisely the filters that dropped them). On
vase.mp4 that took 79,815 gaussians back to 129,937 (+63%); on vase2.mp4,
164,874 to 420,290, which also brought its SOG from 3.1MB up into the
4-20MB target band. Orientation and scale are still computed from the tight
pre-dilation mask, so this changes how solid the product looks without
touching how it's framed.

If dilation ever *does* drag in background, the cause is upstream: it grows
from whatever mask steps 1-3 produced, so a mask that already includes room
will grow a bigger room. Check the connectivity and surface-removal counts
before touching `DILATION_RADIUS_NN_MULTIPLE` — the radius is a thin shell
(~1.5% of the object's own radius on a real capture) and is rarely the
problem.

Dilation alone is not always enough. Accumulated alpha along a viewing ray
is `1-(1-a)^N`, and on an under-observed capture both the per-gaussian alpha
`a` and the layer count `N` are simply too small to reach 1 — once dilation
has put back every gaussian that exists, `a` is the only lever left.
`solidify_opacity_delta()` pulls the product's *median* gaussian alpha up to
`TARGET_MEDIAN_OPACITY` by adding a constant in logit space (monotonic, so
relative structure is preserved and nothing leaves 0-1). It's expressed as a
target rather than a fixed delta so it self-calibrates and never thins out a
product that already renders solid — vase.mp4 needed +1.98, vase2.mp4 +2.48,
both derived, neither tuned by hand.

**Do not judge translucency by looking at screenshots.** This was the actual
reason the problem survived several rounds of "fixed": a low-alpha pixel
over a dark background still looks dark and solid, so a splat measuring 0.80
mean alpha with only 24% of its pixels opaque looked completely fine by eye.
Use `apps/viewer/public/measure.html` instead — it renders the same view
against pure black and pure white and derives real per-pixel alpha from how
far each pixel shifts (`1 - (white - black)/255`), since an opaque pixel
doesn't move between the two and a transparent one moves the full 255:

```bash
# with the viewer dev server running
# open  /measure.html?sog=/vase.sog   then call  window.measure()
```

It reports mean alpha, the percentage of genuinely opaque pixels, and a
histogram. Expect roughly 90% opaque on a good result — the remainder is
the silhouette edge, where semi-transparency is correct antialiasing rather
than a defect.

## 5. Viewing the result

`compress` writes `work/my-product/compressed/model.sog`. To view it, copy
it into `apps/viewer/public/` and point the viewer at it directly — there's
no per-product manifest yet (that's `packages/schema`'s still-pending
product-manifest schema; see CLAUDE.md's Repo layout section).
