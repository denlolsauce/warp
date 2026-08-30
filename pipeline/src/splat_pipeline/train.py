import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import PipelineError
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)

# gsplat_trainer lives in its own venv (gsplat's prebuilt wheels are cp310-only,
# separate from this package's Python version) — under `uv run`, a bare
# "python" on PATH resolves to *this* package's venv, not that one. Point
# SPLAT_GSPLAT_PYTHON at the training venv's interpreter explicitly.
#
# Read lazily (a function, not a module-level constant) rather than once at
# import time: worker.py does `from .train import run_train` at its own
# module level, which runs this module's top-level code before
# worker.main() ever configures tool paths. A constant computed here would
# freeze at "python" and stay there for the life of the process no matter
# what's set later (confirmed the hard way: a real run failed with "No
# module named gsplat_trainer" because it silently launched the wrong
# interpreter, not the training venv's).
def gsplat_trainer_python() -> str:
    return os.environ.get("SPLAT_GSPLAT_PYTHON", "python")


# A separate, isolated venv/checkout from SPLAT_GSPLAT_PYTHON's — PPISP is a
# hand-patched addition to a *second* clone of gsplat-src (see pipeline
# README's Environment section), kept apart so an experimental training
# add-on can never break the proven default training path.
def gsplat_trainer_ppisp_python() -> str:
    return os.environ.get("SPLAT_GSPLAT_PPISP_PYTHON", "python")


# simple_trainer.py's own default for max_steps. --steps-scaler (see train())
# is a single multiplier applied to *every* step-count default at once, so
# the effective step count is int(GSPLAT_BASE_MAX_STEPS * scaler). Keep this
# in sync if the pinned gsplat checkout's default ever changes —
# effective_max_steps() below logs a warning when the round-trip is inexact,
# which is what a drifted default would look like.
GSPLAT_BASE_MAX_STEPS = 30_000


def steps_scaler_for(max_steps: int) -> float:
    return max_steps / GSPLAT_BASE_MAX_STEPS


def effective_max_steps(scaler: float) -> int:
    """The step count simple_trainer will actually run for a given scaler.

    Mirrors Config.adjust_steps()'s `int(self.max_steps * factor)`.
    """
    return int(GSPLAT_BASE_MAX_STEPS * scaler)


@dataclass(frozen=True)
class TrainConfig:
    method: str = "mcmc"
    cap_max: int = 600_000  # CLAUDE.md Training stage: "target 300k-800k for a single object"
    max_steps: int = 15_000  # CLAUDE.md Training stage: "start at 15k and tune"
    sh_degree: int = 2
    # Mip-Splatting screen-space compensation. Only correct because the viewer
    # enables the matching GSPLAT_AA define (see apps/viewer) — PlayCanvas
    # 2.21.3 computes the identical sqrt(detOrig/detBlur) factor with the
    # same 0.3px dilation as gsplat's eps2d default. Flipping one side
    # without the other mis-calibrates the opacity of small/distant
    # gaussians, so these two settings must be changed together or not at
    # all.
    antialiased: bool = True
    # Learns a per-training-image colour/exposure transform. Phone
    # auto-exposure and auto-white-balance drift between frames; without
    # this the optimiser cannot fit two brightnesses of the same surface
    # with one opaque gaussian and hedges with stacked translucent ones,
    # which is the haze look. The grid is applied to the *rendered* image
    # inside the training loss only (simple_trainer.py's `slice(...)`
    # call), so the exported PLY stays in canonical colour space and needs
    # no viewer-side counterpart.
    use_bilateral_grid: bool = True
    # PPISP (physically-plausible exposure/vignetting/color/CRF correction)
    # instead of the bilateral grid above -- both correct the same kind of
    # per-image photometric variation, so enabling this implies
    # use_bilateral_grid is disabled regardless of that field's value (see
    # train()). Runs against a separate, hand-patched gsplat checkout
    # (SPLAT_GSPLAT_PPISP_PYTHON) -- see pipeline/README.md.
    use_ppisp: bool = False


DEFAULT_TRAIN_CONFIG = TrainConfig()


def link_images_dir(link_path: Path, target_dir: Path) -> None:
    try:
        link_path.symlink_to(target_dir, target_is_directory=True)
        return
    except OSError:
        if os.name != "nt":
            raise
    # Windows without symlink privilege (Developer Mode/admin not set up) —
    # a junction needs no special privilege and works identically here, since
    # images/ is only ever read through, never written.
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link_path), str(target_dir)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise PipelineError(
            "train:link",
            f"failed to link {link_path} -> {target_dir}: {result.stderr or result.stdout}",
        )


def prepare_images_link(workdir: Path, frames_dir: Path) -> Path:
    """gsplat_trainer expects <data-dir>/images next to <data-dir>/sparse/0.
    The job's frames already live at workdir/frames, so link workdir/images
    to it rather than copying — a single capture's frames can be gigabytes.
    """
    images_link = workdir / "images"
    if images_link.is_symlink():
        images_link.unlink()
    elif images_link.exists():
        # A junction (the Windows fallback above) reads as a plain existing
        # directory to pathlib, not as a symlink — try to remove it as a
        # reparse point first; only refuse if it turns out to be a real,
        # populated directory.
        try:
            os.rmdir(images_link)
        except OSError as error:
            raise PipelineError(
                "train:link",
                f"{images_link} exists and isn't an empty dir/symlink/junction; refusing to overwrite",
            ) from error
    link_images_dir(images_link, frames_dir.resolve())
    return images_link


def train(workdir: Path, out_dir: Path, config: TrainConfig) -> None:
    scaler = steps_scaler_for(config.max_steps)
    actual_steps = effective_max_steps(scaler)
    if actual_steps != config.max_steps:
        logger.warning(
            "requested %d steps, --steps-scaler %.6f resolves to %d "
            "(pick a max_steps that divides %d evenly for an exact match)",
            config.max_steps, scaler, actual_steps, GSPLAT_BASE_MAX_STEPS,
        )
    python = gsplat_trainer_ppisp_python() if config.use_ppisp else gsplat_trainer_python()
    run_command(
        "train",
        [
            # gsplat_trainer is a tyro-based CLI (real flags are hyphenated,
            # and cap_max lives under the strategy sub-config) — verified
            # against the actual examples/simple_trainer.py, not guessed.
            python, "-m", "gsplat_trainer", config.method,
            "--data-dir", str(workdir),
            "--result-dir", str(out_dir),
            # extract already downsamples to a fixed height; don't let the
            # trainer's own Mip-NeRF-360-style factor look for a
            # pre-downsampled images_<N>/ folder that doesn't exist.
            "--data-factor", "1",
            "--strategy.cap-max", str(config.cap_max),
            # NOT --max-steps. Setting max_steps directly leaves every other
            # step-count default at its 30k-run value, and the one that
            # matters is MCMCStrategy.refine_stop_iter (default 25_000):
            # simple_trainer only rescales it inside Config.adjust_steps(),
            # which runs off cfg.steps_scaler. With --max-steps 12000 the
            # strategy therefore kept relocating and adding gaussians until
            # step 11_999, so the final relocated batch got ~100 steps to
            # converge and shipped as unconverged translucent blobs — haze.
            # --steps-scaler rescales max_steps, refine_start/stop/every,
            # sh_degree_interval and the eval/save/ply step lists together.
            "--steps-scaler", f"{scaler:.6f}",
            "--sh-degree", str(config.sh_degree),
            # cleanup.py needs a real PLY on disk; --save-ply defaults to
            # False and the export at the final step is silently skipped
            # without this (confirmed the hard way — first real run had
            # to be salvaged with a separate --ckpt eval-only pass).
            "--save-ply",
            # gsplat's Parser defaults normalize_world_space=True: it
            # recenters/rotates/rescales camera poses and points before
            # training (datasets/normalize.py), and the exported PLY's
            # means are never transformed back. cleanup.py's RANSAC plane
            # fit and recentre/align/scale step is the one place that's
            # meant to own that transform (CLAUDE.md's Cleanup stage) —
            # doing it again inside training would just be a second,
            # uncoordinated normalization fighting the first. Train
            # directly in raw COLMAP space instead.
            "--no-normalize-world-space",
            *(["--antialiased"] if config.antialiased else ["--no-antialiased"]),
            *(
                ["--use-bilateral-grid"]
                # use_ppisp implies bilateral grid off, regardless of that
                # field's own value -- see TrainConfig's comment.
                if config.use_bilateral_grid and not config.use_ppisp
                else ["--no-use-bilateral-grid"]
            ),
            *(["--use-ppisp"] if config.use_ppisp else []),
        ],
    )


def run_train(workdir: Path, config: TrainConfig | None = None) -> None:
    frames_dir = workdir / "frames"
    sparse_dir = workdir / "sparse"
    out_dir = workdir / "out"

    if not (sparse_dir / "0").is_dir():
        raise PipelineError("train", f"sparse model not found: {sparse_dir / '0'} — run `sfm` first")

    prepare_images_link(workdir, frames_dir)
    train(workdir, out_dir, config or DEFAULT_TRAIN_CONFIG)
