import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import PipelineError
from .subprocess_utils import resolve_executable

logger = logging.getLogger(__name__)

# Mirrors apps/web/src/lib/videoConstraints.ts's constants — CLAUDE.md's
# Ingest stage: "Reject videos with heavy rolling-shutter warping, under
# 60s, or above 4K60."
MIN_DURATION_SEC = 60
MAX_RESOLUTION_HEIGHT_PX = 2160
MAX_FPS = 60


@dataclass(frozen=True)
class VideoProbe:
    duration_sec: float
    width: int
    height: int
    fps: float


def probe_video(video_path: Path) -> VideoProbe:
    try:
        result = subprocess.run(
            resolve_executable([
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_entries", "format=duration:stream=width,height,r_frame_rate",
                "-select_streams", "v:0",
                str(video_path),
            ]),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
    except FileNotFoundError as error:
        raise PipelineError("ingest:ffprobe", f"executable not found: ffprobe ({error})") from error
    if result.returncode != 0:
        raise PipelineError("ingest:ffprobe", f"ffprobe failed on {video_path}", result.stderr)

    try:
        payload = json.loads(result.stdout)
        stream = payload["streams"][0]
        duration_sec = float(payload["format"]["duration"])
        width, height = int(stream["width"]), int(stream["height"])
        num, den = stream["r_frame_rate"].split("/")
        fps = float(num) / float(den) if float(den) != 0 else 0.0
    except (KeyError, IndexError, ValueError, ZeroDivisionError) as error:
        raise PipelineError("ingest:ffprobe", f"could not parse ffprobe output for {video_path}: {error}") from error

    return VideoProbe(duration_sec=duration_sec, width=width, height=height, fps=fps)


# NOT implemented: rolling-shutter warping detection. CLAUDE.md names it as
# a reject condition, but detecting it (versus ordinary parallax/motion) is
# a real CV problem — not attempted here rather than faking a check that
# doesn't actually catch anything. Duration/resolution/frame-rate are
# checked; rolling shutter isn't, yet.
def run_ingest(video_path: Path) -> VideoProbe:
    if not video_path.is_file():
        raise PipelineError("ingest", f"video not found: {video_path}")

    probe = probe_video(video_path)
    logger.info(
        "ingest: %.1fs, %dx%d @ %.1ffps", probe.duration_sec, probe.width, probe.height, probe.fps
    )

    if probe.duration_sec < MIN_DURATION_SEC:
        raise PipelineError(
            "ingest",
            f"video is only {probe.duration_sec:.0f}s — needs to be at least {MIN_DURATION_SEC}s "
            "(3-4 orbits plus a top-down pass takes longer than that to shoot properly)",
        )
    if probe.height > MAX_RESOLUTION_HEIGHT_PX:
        raise PipelineError(
            "ingest", f"video resolution ({probe.width}x{probe.height}) is above the 4K limit"
        )
    if probe.fps > MAX_FPS:
        raise PipelineError("ingest", f"video frame rate ({probe.fps:.0f}fps) is above the {MAX_FPS}fps limit")

    return probe
