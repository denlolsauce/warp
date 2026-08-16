import logging
from pathlib import Path

import cv2
import numpy as np

from .capture_manifest import CaptureEntry, write_capture_manifest
from .errors import PipelineError
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)

BLUR_PERCENTILE = 20


def parse_video_filename(path: Path) -> tuple[str, str]:
    role, _, area_name = path.stem.partition("_")
    if not area_name:
        raise PipelineError(
            "extract",
            f"video filename '{path.name}' does not match <role>_<areaName>.mp4",
        )
    return role, area_name


def extract_frames(video_path: Path, out_dir: Path) -> None:
    run_command(
        "extract:ffmpeg",
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vf", "fps=2,scale=-2:1600",
            "-q:v", "2",
            str(out_dir / "%05d.jpg"),
        ],
    )


def blur_filter(out_dir: Path) -> tuple[int, int]:
    frame_paths = sorted(out_dir.glob("*.jpg"))
    if not frame_paths:
        raise PipelineError("extract:blur_filter", f"no frames extracted into {out_dir}")

    scores = []
    for frame_path in frame_paths:
        image = cv2.imread(str(frame_path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise PipelineError("extract:blur_filter", f"could not read frame: {frame_path}")
        scores.append(cv2.Laplacian(image, cv2.CV_64F).var())

    threshold = float(np.percentile(scores, BLUR_PERCENTILE))

    kept = dropped = 0
    for frame_path, score in zip(frame_paths, scores):
        if score < threshold:
            frame_path.unlink()
            dropped += 1
        else:
            kept += 1
    return kept, dropped


def run_extract(videos_dir: Path, frames_dir: Path) -> None:
    videos = sorted(videos_dir.glob("*.mp4"))
    if not videos:
        raise PipelineError("extract", f"no .mp4 files found in {videos_dir}")

    entries: dict[str, CaptureEntry] = {}
    for index, video_path in enumerate(videos):
        role, area_name = parse_video_filename(video_path)
        folder_name = f"{index:02d}_{area_name}"
        out_dir = frames_dir / folder_name
        out_dir.mkdir(parents=True, exist_ok=True)

        extract_frames(video_path, out_dir)
        kept, dropped = blur_filter(out_dir)
        logger.info("%s: kept %d, dropped %d", out_dir.name, kept, dropped)
        entries[folder_name] = CaptureEntry(role=role, area_name=area_name)

    write_capture_manifest(frames_dir, entries)
