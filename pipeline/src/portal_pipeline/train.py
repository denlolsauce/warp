import asyncio
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pycolmap

from .capture_manifest import read_capture_manifest
from .errors import PipelineError
from .subprocess_utils import run_command_async

logger = logging.getLogger(__name__)

# gsplat_trainer lives in its own venv (gsplat's prebuilt wheels are cp310-only,
# separate from this package's Python version) — under `uv run`, a bare
# "python" on PATH resolves to *this* package's venv, not that one. Point
# PORTAL_GSPLAT_PYTHON at the training venv's interpreter explicitly.
#
# Read lazily (a function, not a module-level constant) rather than once at
# import time: worker.py does `from .train import run_train` at its own
# module level, which runs this module's top-level code — including
# configure_tool_paths()'s os.environ.setdefault(...) — before worker.main()
# ever calls configure_tool_paths(). A constant computed here would freeze at
# "python" and stay there for the life of the process no matter what
# configure_tool_paths() or PORTAL_GSPLAT_PYTHON later set (confirmed the
# hard way: a real run failed with "No module named gsplat_trainer" because
# it silently launched the wrong interpreter, not the training venv's).
def gsplat_trainer_python() -> str:
    return os.environ.get("PORTAL_GSPLAT_PYTHON", "python")


# simple_trainer.py's own default for max_steps. --steps-scaler (see
# train_one) is a single multiplier applied to *every* step-count default at
# once, so the effective step count is int(GSPLAT_BASE_MAX_STEPS * scaler).
# Keep this in sync if the pinned gsplat checkout's default ever changes —
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
    cap_max: int = 400_000
    max_steps: int = 12_000
    sh_degree: int = 1
    # Mip-Splatting screen-space compensation. Only correct because the viewer
    # enables the matching GSPLAT_AA define (see viewer.ts) — PlayCanvas 2.21.3
    # computes the identical sqrt(detOrig/detBlur) factor with the same 0.3px
    # dilation as gsplat's eps2d default. Flipping one side without the other
    # mis-calibrates the opacity of small/distant gaussians, so these two
    # settings must be changed together or not at all.
    antialiased: bool = True
    # Learns a per-training-image colour/exposure transform. Phone auto-exposure
    # and auto-white-balance drift between frames; without this the optimiser
    # cannot fit two brightnesses of the same surface with one opaque gaussian
    # and hedges with stacked translucent ones, which is the haze look. The grid
    # is applied to the *rendered* image inside the training loss only
    # (simple_trainer.py's `slice(...)` call), so the exported PLY stays in
    # canonical colour space and needs no viewer-side counterpart.
    use_bilateral_grid: bool = True


OVERVIEW_TRAIN_CONFIG = TrainConfig(cap_max=400_000, max_steps=12_000, sh_degree=1)
AREA_TRAIN_CONFIG = TrainConfig(cap_max=600_000, max_steps=15_000, sh_degree=2)


def default_train_config(role: str) -> TrainConfig:
    return OVERVIEW_TRAIN_CONFIG if role.strip().lower() == "overview" else AREA_TRAIN_CONFIG


def detect_gpu_count() -> int:
    try:
        result = subprocess.run(
            ["nvidia-smi", "-L"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
    except FileNotFoundError:
        return 1
    if result.returncode != 0:
        return 1
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    return max(1, len(lines))


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
            "train:split",
            f"failed to link {link_path} -> {target_dir}: {result.stderr or result.stdout}",
        )


def split_reconstruction(
    sparse_dir: Path, frames_dir: Path, sub_dir: Path, folder_names: list[str]
) -> None:
    full = pycolmap.Reconstruction(str(sparse_dir / "0"))
    frames_dir = frames_dir.resolve()

    for folder_name in folder_names:
        sub_model = pycolmap.Reconstruction(full)
        for image in list(sub_model.images.values()):
            if Path(image.name).parts[0] != folder_name:
                sub_model.deregister_frame(image.frame_id)

        if sub_model.num_reg_images() == 0:
            raise PipelineError(
                "train:split", f"{folder_name}: no registered images survived the split"
            )

        sparse_out = sub_dir / folder_name / "sparse" / "0"
        sparse_out.mkdir(parents=True, exist_ok=True)
        sub_model.write(str(sparse_out))
        logger.info(
            "%s: split sub-model with %d registered images",
            folder_name,
            sub_model.num_reg_images(),
        )

        images_link = sub_dir / folder_name / "images"
        if images_link.is_symlink():
            images_link.unlink()
        elif images_link.exists():
            # Junctions (the Windows fallback below) read as a plain existing
            # directory to pathlib, not as a symlink — try to remove it as a
            # reparse point first; only refuse if it's turns out to be a real,
            # populated directory.
            try:
                os.rmdir(images_link)
            except OSError as error:
                raise PipelineError(
                    "train:split",
                    f"{images_link} exists and isn't an empty dir/symlink/junction; refusing to overwrite",
                ) from error
        link_images_dir(images_link, frames_dir)


async def train_one(
    sub_dir: Path,
    out_dir: Path,
    folder_name: str,
    config: TrainConfig,
    semaphore: asyncio.Semaphore,
) -> None:
    async with semaphore:
        scaler = steps_scaler_for(config.max_steps)
        actual_steps = effective_max_steps(scaler)
        if actual_steps != config.max_steps:
            logger.warning(
                "%s: requested %d steps, --steps-scaler %.6f resolves to %d "
                "(pick a max_steps that divides %d evenly for an exact match)",
                folder_name, config.max_steps, scaler, actual_steps, GSPLAT_BASE_MAX_STEPS,
            )
        await run_command_async(
            f"train:{folder_name}",
            [
                # gsplat_trainer is a tyro-based CLI (real flags are hyphenated,
                # and cap_max lives under the strategy sub-config) — verified
                # against the actual examples/simple_trainer.py, not guessed.
                gsplat_trainer_python(), "-m", "gsplat_trainer", config.method,
                "--data-dir", str(sub_dir / folder_name),
                "--result-dir", str(out_dir / folder_name),
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
                "--steps-scaler", f"{steps_scaler_for(config.max_steps):.6f}",
                "--sh-degree", str(config.sh_degree),
                # compress needs a real PLY on disk; --save-ply defaults to
                # False and the export at the final step is silently skipped
                # without this (confirmed the hard way — first real run had
                # to be salvaged with a separate --ckpt eval-only pass).
                "--save-ply",
                # gsplat's Parser defaults normalize_world_space=True: it
                # recenters/rotates/rescales camera poses and points before
                # training (datasets/normalize.py), and the exported PLY's
                # means are never transformed back. nav.py's camera-centre
                # extraction reads the raw joint COLMAP reconstruction with
                # no such transform, so a normalized splat and the raw-frame
                # nav path land in two different coordinate systems — the
                # nav tube walks through space the splat was recentered away
                # from. CLAUDE.md requires one global frame from the joint
                # SfM run with "no post-hoc alignment step", and per-area
                # normalization would also make each area's independent
                # transform incompatible with every other area's, breaking
                # Phase 2's shared frame. Train directly in raw COLMAP space
                # instead, which nav.py already assumes (its distances are
                # hardcoded in metres against that same raw frame).
                "--no-normalize-world-space",
                *(["--antialiased"] if config.antialiased else ["--no-antialiased"]),
                *(
                    ["--use-bilateral-grid"]
                    if config.use_bilateral_grid
                    else ["--no-use-bilateral-grid"]
                ),
            ],
        )


async def train_all(
    sub_dir: Path, out_dir: Path, configs: dict[str, TrainConfig], gpu_count: int
) -> dict[str, BaseException | None]:
    semaphore = asyncio.Semaphore(gpu_count)
    folder_names = list(configs.keys())
    tasks = [
        train_one(sub_dir, out_dir, folder_name, configs[folder_name], semaphore)
        for folder_name in folder_names
    ]
    # return_exceptions=True: areas share one GPU semaphore, so a fail-fast
    # gather() here would cancel every area still queued behind whichever one
    # failed first — losing real training work for areas that had nothing to
    # do with the failure. Confirmed the hard way: killing one area's hung
    # subprocess to free the GPU slot for the next area took a completely
    # untouched sibling area down with it, which never even got as far as
    # creating a result directory.
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(folder_names, results))


def run_train(workdir: Path, config_override: TrainConfig | None = None) -> None:
    frames_dir = workdir / "frames"
    sparse_dir = workdir / "sparse"
    sub_dir = workdir / "sub"
    out_dir = workdir / "out"

    if not (sparse_dir / "0").is_dir():
        raise PipelineError(
            "train", f"sparse model not found: {sparse_dir / '0'} — run `sfm` first"
        )

    manifest = read_capture_manifest(frames_dir)
    folder_names = sorted(manifest.keys())

    split_reconstruction(sparse_dir, frames_dir, sub_dir, folder_names)

    configs = {
        folder_name: (config_override or default_train_config(manifest[folder_name].role))
        for folder_name in folder_names
    }

    gpu_count = detect_gpu_count()
    logger.info("training %d area(s) with %d concurrent GPU slot(s)", len(configs), gpu_count)

    results = asyncio.run(train_all(sub_dir, out_dir, configs, gpu_count))
    failures = {name: error for name, error in results.items() if error is not None}
    if failures:
        detail = "\n".join(f"{name}: {error}" for name, error in failures.items())
        raise PipelineError(
            "train",
            f"{len(failures)}/{len(results)} area(s) failed to train: {', '.join(failures)}",
            detail,
        )
