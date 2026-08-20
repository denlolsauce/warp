# Video → Splat

How to turn phone video into a viewable Gaussian splat tour, end to end. This
covers the manual CLI path (`portal-pipeline <stage> ...`), which is what you
want for a one-off run or when debugging — the Redis worker (`worker.py`)
wraps the same stages for production use once R2/DB/Redis are configured.

## 1. Filming

**Every video** (overview and each room):

- Ultrawide lens (0.5x iPhone / 0.6x Android), exposure and focus **locked**
  before you start (Samsung: Pro Video mode, or tap-and-hold the preview in
  regular Video mode).
- Phone vertical, chest height, ~1 step/sec, stop and turn slowly at corners.
- Lights on, blinds open, TVs off — and don't move anything between videos.
- Turn off Scene optimizer, video HDR, and heavy digital stabilization
  ("Super Steady") — all three actively work against frame-to-frame
  consistency, which is what the reconstruction depends on.
- 4K/30fps is the sweet spot. Higher resolution/framerate doesn't help —
  frames get extracted at only 2-8fps regardless — and just means bigger
  files.

**Overview**: whole property, one natural walk, ~8-10s per room, finish where
you started.

**Each room** (area video): two perimeter loops in opposite directions, then
a diagonal cross, then close-ups at 30-60cm of anything worth capturing
sharply. **Must start standing under the door frame, looking into the room**
— this is what lets the pipeline detect the doorway crossing and connect the
room to the overview. Long corridors are their own area, walked in both
directions.

**Thin, reflective, or plain surfaces need deliberate extra attention**:
- Railings, glass, mirrors — circle them, get closer, capture several
  distinct angles. Don't just walk past at normal pace; specular highlights
  that shift with viewing angle are a genuinely harder reconstruction
  problem than general haze, and more frames from the same walking path
  doesn't fix it.
- Bare, uniform walls — SIFT feature matching needs texture to lock onto.
  If a wall is truly plain, tape up a poster or hang something patterned
  during filming and remove it after. This is the single most common cause
  of registration failures we've hit.

## 2. Environment

Required, with the specific versions/formats that actually work — the
generic "just install COLMAP" advice will bite you here:

| Tool | Notes |
|---|---|
| `ffmpeg` | Any recent build. |
| **COLMAP 3.12.6, not newer** | COLMAP ≥4.0 renamed CLI flags and changed its feature-matching database schema in a way GLOMAP 1.2.0 can't read (`SQL logic error`). There is no newer GLOMAP release. If `colmap --version` reports 4.x, you have the wrong build — get 3.12.6 specifically and make sure it resolves first on `PATH`. |
| `glomap` | 1.2.0. |
| A **FAISS-format** vocab tree | COLMAP switched from FLANN to FAISS in May 2025. Any vocab tree file predating that (including most publicly distributed ones, e.g. `vocab_tree_flickr100K_words32K.bin`) fails to load on a modern COLMAP build (`Check failed: file_version == 1`). Build your own locally instead: `colmap vocab_tree_builder --database_path <db> --vocab_tree_path <out.bin> --num_visual_words 256 --num_threads 1` against a completed `sfm` run's `db.db` — a few hundred words is plenty for a single-property capture (few hundred images), and this only needs doing once. |
| Node + `@playcanvas/splat-transform` | `npm i -g @playcanvas/splat-transform`. Used for the PLY→SOG compression step. |
| A separate Python venv for `gsplat_trainer` | gsplat's prebuilt wheels are cp310-only, incompatible with this package's own venv. Needs `torch` with CUDA. Point `PORTAL_GSPLAT_PYTHON` at its `python.exe`. |

`worker.py`'s `configure_tool_paths()` sets sane defaults for all of the
above (see `DEFAULT_GSPLAT_PYTHON` / `DEFAULT_VOCAB_TREE` /
`DEFAULT_EXTRA_PATH_DIRS`) — update those constants once your tools are
installed rather than re-discovering the right paths every run. The manual
CLI commands below don't call `configure_tool_paths()` automatically, so
either call it yourself first or set the equivalent env vars/`PATH` by hand.

## 3. Running the pipeline

Videos must be named `<role>_<areaName>.mp4` in one directory — `role` is
`overview` for the whole-property video and anything else (conventionally
`area`) for each room. Example for a two-room property:

```
videos/
  OVERVIEW_overview.mp4
  AREA_kitchen.mp4
  AREA_hallway.mp4
```

```bash
# From pipeline/, with the venv active (or use .venv/Scripts/portal-pipeline.exe directly)

# 1. Extract + blur-filter frames (fast, CPU-bound)
portal-pipeline extract videos/ --workdir work/my-tour

# 2. Joint SfM: one COLMAP+GLOMAP run across every video, one shared
#    coordinate frame. Slowest CPU-bound stage — scales with total frame
#    count across all videos.
portal-pipeline sfm --workdir work/my-tour --vocab-tree /path/to/vocab_tree.bin

# 3. Train each area with gsplat MCMC. GPU-bound; areas train sequentially
#    on a single GPU, concurrently if you have more than one.
export PORTAL_GSPLAT_PYTHON=/path/to/gsplat-venv/python.exe
portal-pipeline train --workdir work/my-tour

# 4. Convert trained PLYs to SOG, compute bboxes, render the floorplan,
#    chunk the overview per area.
portal-pipeline compress --workdir work/my-tour

# 5. Build the nav graph (doorway crossings via proximity), compute spawn
#    points, assemble + validate the final manifest.json.
portal-pipeline nav --workdir work/my-tour --tour-id my-tour
```

Each stage reads what the previous one wrote under `--workdir`; rerunning a
stage overwrites its own output but doesn't touch anything upstream, so you
can retry from any point without redoing earlier work.

## 4. Known gotchas

These are all things that actually happened running this pipeline for real,
not hypothetical edge cases.

**`sfm` fails immediately with a COLMAP error about `--version` or a faiss
index.** Wrong COLMAP build or legacy vocab tree — see the Environment
table above. Verify with `colmap help` (prints the version banner) before
spending time on anything else.

**A room's video registers well below 100% in `sfm`'s per-folder report,
and the stage fails.** This is a real content problem, not a bug — usually
long stretches of plain, low-texture wall, or a fast-moving pass over
something with too little frame-to-frame overlap. The error message names
the specific area and suggests a fix. Denser sampling helps partially (see
`extract.py`'s `fps=2` — re-extracting a single problem video at a higher
fps and re-running `sfm` is a cheap thing to try) but for genuinely
low-texture surfaces the real fix is reshooting slower or adding temporary
texture, not more frames from the same pass.

**Training finishes (final checkpoint + PLY written, GPU usage drops) but
the process never exits.** `gsplat_trainer`'s optional final
trajectory-video export hangs indefinitely on at least one real Windows
setup. The PLY export happens *before* this — check for
`out/<area>/ply/point_cloud_<max_steps - 1>.ply`; if it exists, the actual
training result is safe. Confirm the process is truly stuck (not just slow)
by sampling its CPU time twice a few seconds apart — if it hasn't moved,
kill it. `train_all` uses `asyncio.gather(..., return_exceptions=True)`
specifically so that killing one area's stuck export doesn't cancel other
areas still queued behind it on the GPU semaphore.

**The splat renders upside down, or a training run other than the one you
expect gets silently skipped.** Two independent issues, easy to conflate:

- Upside down → `compress.py`'s `detect_up_axis_flip()` guesses flip
  direction from whether the point cloud's median height sits above or
  below its mean, which assumes a clean dense-floor/sparse-ceiling split.
  A room with a staircase (or anything else that spreads points across an
  unusually large vertical range) can make this guess unreliable — we've
  seen it get it wrong on the same property twice. If a render looks wrong,
  don't trust a second heuristic either; look at an actual screenshot for
  an unambiguous reference point (a visible ceiling light or floor tile
  grid) before deciding, then override by monkey-patching
  `detect_up_axis_flip` to a fixed value in both `compress` and `nav`
  (both must agree, or the splat and the nav path disagree about which way
  is up).
- A multi-area `train` run only training the first area and then silently
  stopping → this was a real bug (fixed): before `train_all` used
  `return_exceptions=True`, killing one area's stuck export took down the
  whole batch via `asyncio.gather()`'s fail-fast behavior, abandoning every
  area still waiting on the GPU semaphore before it had even started. If
  you're on an older checkout without that fix, train areas one at a time
  instead of all at once.

**Multi-room tours need every area trained from the *same* `sfm` run.** A
room trained in isolation (its own separate `extract`→`sfm`→`train`) ends up
in an unrelated coordinate frame and can't be dropped into another tour's
manifest — positions simply won't line up. If you want a real multi-room
tour, all videos need to go through `extract`/`sfm` together from the start.

## 5. Viewing the result

`nav` writes `work/my-tour/manifest.json` referencing local `compressed/`
paths. To view it, copy the compressed assets into `apps/viewer/public/`
and rewrite the manifest's paths to the public-relative form:

```
apps/viewer/public/
  my-tour-overview.sog
  my-tour-chunk-<area>.sog       (one per area)
  my-tour-<area>.sog             (one per area)
  my-tour-floorplan.png
  my-tour-manifest.json          (paths rewritten to /my-tour-*.sog etc.)
```

Then open the viewer with `?manifest=/my-tour-manifest.json`.
