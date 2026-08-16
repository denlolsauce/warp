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
GSPLAT_TRAINER_PYTHON = os.environ.get("PORTAL_GSPLAT_PYTHON", "python")


@dataclass(frozen=True)
class TrainConfig:
    method: str = "mcmc"
    cap_max: int = 400_000
    max_steps: int = 12_000
    sh_degree: int = 1


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
        await run_command_async(
            f"train:{folder_name}",
            [
                # gsplat_trainer is a tyro-based CLI (real flags are hyphenated,
                # and cap_max lives under the strategy sub-config) — verified
                # against the actual examples/simple_trainer.py, not guessed.
                GSPLAT_TRAINER_PYTHON, "-m", "gsplat_trainer", config.method,
                "--data-dir", str(sub_dir / folder_name),
                "--result-dir", str(out_dir / folder_name),
                # extract already downsamples to a fixed height; don't let the
                # trainer's own Mip-NeRF-360-style factor look for a
                # pre-downsampled images_<N>/ folder that doesn't exist.
                "--data-factor", "1",
                "--strategy.cap-max", str(config.cap_max),
                "--max-steps", str(config.max_steps),
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
            ],
        )


async def train_all(
    sub_dir: Path, out_dir: Path, configs: dict[str, TrainConfig], gpu_count: int
) -> None:
    semaphore = asyncio.Semaphore(gpu_count)
    tasks = [
        train_one(sub_dir, out_dir, folder_name, config, semaphore)
        for folder_name, config in configs.items()
    ]
    await asyncio.gather(*tasks)


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

    asyncio.run(train_all(sub_dir, out_dir, configs, gpu_count))
