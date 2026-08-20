import logging
from pathlib import Path

import cv2
import numpy as np

from .capture_manifest import CaptureEntry, write_capture_manifest
from .errors import PipelineError
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)

# Motion blur is the direct cause of ghosting, so the aim here is to drop
# blurred frames and nothing else.
#
# Laplacian variance is the usual sharpness proxy, but it scales with how much
# texture is in view, not just with focus: a sharp frame of a bare wall scores
# below a motion-blurred frame of a bookshelf. Thresholding it at a single
# percentile over the whole video therefore does the opposite of what's wanted
# — it deletes sharp frames precisely in the low-texture regions that already
# struggle to register (the failure sfm.py's verify_reconstruction message is
# written about), while keeping blurred frames wherever the scene is textured.
#
# Compare each frame against its temporal neighbours instead. Consecutive
# frames of a walking capture see nearly the same content, so a score gap
# inside a short window really is a sharpness gap rather than a texture gap. A
# frame is dropped when it scores below BLUR_RATIO of its window's median,
# which also means a uniformly sharp stretch loses nothing at all — a fixed
# percentile always throws away its bottom slice however good it is.
BLUR_WINDOW = 15  # frames either side; ~15s of context at the fps=2 extraction rate
BLUR_RATIO = 0.6
# A backstop against pathological input (a whole video shot in the dark, a
# score distribution nothing like the ones seen so far): however bad the
# frames look relative to each other, never remove so many that the area is
# left too sparsely observed to reconstruct. Above this fraction only the
# relatively worst frames are dropped.
MAX_DROP_FRACTION = 0.4


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


def blur_drop_mask(
    scores: np.ndarray,
    window: int = BLUR_WINDOW,
    ratio: float = BLUR_RATIO,
    max_drop_fraction: float = MAX_DROP_FRACTION,
) -> np.ndarray:
    """Which frames to drop, given per-frame sharpness scores in capture order."""
    count = len(scores)
    medians = np.array(
        [np.median(scores[max(0, i - window) : min(count, i + window + 1)]) for i in range(count)]
    )
    # medians == 0 (an entirely flat stretch) makes the threshold 0, so nothing
    # is dropped there rather than everything — scores are non-negative.
    drop = scores < ratio * medians

    max_drops = int(count * max_drop_fraction)
    if drop.sum() > max_drops:
        relative = np.divide(scores, medians, out=np.full(count, np.inf), where=medians > 0)
        candidates = np.flatnonzero(drop)
        worst = candidates[np.argsort(relative[candidates], kind="stable")][:max_drops]
        drop = np.zeros(count, dtype=bool)
        drop[worst] = True
    return drop


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

    # sorted() above puts the frames in ffmpeg's zero-padded numbering order,
    # i.e. capture order — which is what makes the window a temporal one.
    drop = blur_drop_mask(np.array(scores, dtype=np.float64))

    for frame_path, should_drop in zip(frame_paths, drop):
        if should_drop:
            frame_path.unlink()
    dropped = int(drop.sum())
    return len(frame_paths) - dropped, dropped


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
