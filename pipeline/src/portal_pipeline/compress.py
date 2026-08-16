import json
import logging
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pycolmap

from .capture_manifest import read_capture_manifest
from .errors import PipelineError
from .plysplit import BBox, inside_box_mask, load_ply_positions, write_ply_subset
from .subprocess_utils import resolve_executable, run_command

logger = logging.getLogger(__name__)

BBOX_PAD_METERS = 0.5
MIN_SOG_BYTES = 3 * 1024 * 1024
MAX_SOG_BYTES = 12 * 1024 * 1024
REQUIRED_HELP_MARKERS = ["--overwrite", ".ply", ".sog"]

COMPRESS_MANIFEST_FILENAME = "compress_manifest.json"


@dataclass
class CompressEntry:
    bbox: list[list[float]]
    sog_path: str
    sog_bytes: int
    # OVERVIEW only: area id -> that area's overview-chunk sog path. None
    # for AREA entries and for an overview that wasn't split (no areas).
    chunks: dict[str, str] | None = None


def write_compress_manifest(compressed_dir: Path, entries: dict[str, CompressEntry]) -> None:
    payload = {name: asdict(entry) for name, entry in entries.items()}
    (compressed_dir / COMPRESS_MANIFEST_FILENAME).write_text(json.dumps(payload, indent=2))


def read_compress_manifest(compressed_dir: Path) -> dict[str, CompressEntry]:
    path = compressed_dir / COMPRESS_MANIFEST_FILENAME
    if not path.is_file():
        raise PipelineError(
            "compress_manifest", f"missing {path} — run `portal-pipeline compress` first"
        )
    raw = json.loads(path.read_text())
    return {name: CompressEntry(**fields) for name, fields in raw.items()}


def compute_padded_bbox(
    points: np.ndarray, pad: float = BBOX_PAD_METERS
) -> list[list[float]]:
    mins = (points.min(axis=0) - pad).tolist()
    maxs = (points.max(axis=0) + pad).tolist()
    return [mins, maxs]


def bbox_from_submodel(
    sparse_dir: Path, needs_flip: bool, pad: float = BBOX_PAD_METERS
) -> list[list[float]]:
    reconstruction = pycolmap.Reconstruction(str(sparse_dir))
    centers = [image.projection_center() for image in reconstruction.images.values()]
    xyz = [point.xyz for point in reconstruction.points3D.values()]

    all_points = np.array(centers + xyz, dtype=np.float64)
    if all_points.size == 0:
        raise PipelineError("compress", f"no camera centres or points found in {sparse_dir}")
    if needs_flip:
        all_points[:, [1, 2]] *= -1  # keep in sync with UP_AXIS_FLIP_EULER_XYZ below
    return compute_padded_bbox(all_points, pad)


def _bbox_arrays(bbox: list[list[float]]) -> BBox:
    mins, maxs = bbox
    return np.array(mins, dtype=np.float64), np.array(maxs, dtype=np.float64)


# Raw COLMAP world orientation is arbitrary (inherited from the seed camera's
# local axes, since there's no gravity reference) — it is not reliably
# gravity-aligned. gsplat's own normalize.py fixes this as one part of its
# broader normalize_world_space step, which train.py now disables entirely to
# keep the splat in the same raw-COLMAP frame nav.py uses (see train.py's
# --no-normalize-world-space comment). detect_up_axis_flip() below ports just
# the orientation half of that fix — determined from this reconstruction's
# own data rather than assumed, since whether (or how) a given capture needs
# correcting isn't a fixed pipeline property, it depends on which camera
# pair COLMAP happened to seed the reconstruction from.
UP_AXIS_FLIP_EULER_XYZ = "180,0,0"  # matches gsplat normalize.py's "rotate 180 about X" fix


def detect_up_axis_flip(sparse_dir: Path) -> bool:
    """Whether this reconstruction needs a 180-degree flip (world Y up,
    Z forward) to be right-side up.

    Two things are inferred from the data rather than assumed:

    - Which axis is vertical: the capture protocol holds the phone at a
      roughly constant chest height while walking around (CLAUDE.md's
      capture checklist), so camera centres should vary far less along the
      true vertical axis than horizontally. Pick whichever of COLMAP's X/Y/Z
      axes has the lowest variance across camera centres.
    - Which sign is up: mirrors gsplat's own normalize.py heuristic — a room
      scan's point cloud clusters densely at floor height with a sparser
      tail toward the ceiling, so median > mean on the vertical axis means
      the dense (floor) cluster sits at the high end, i.e. "+axis" currently
      points down and needs flipping.

    Only the case verified against a real capture (vertical axis = Y) is
    handled; a reconstruction whose low-variance axis comes out as X or Z
    instead raises rather than silently applying an unverified rotation.
    """
    reconstruction = pycolmap.Reconstruction(str(sparse_dir))
    centres = np.array([image.projection_center() for image in reconstruction.images.values()])
    points = np.array([point.xyz for point in reconstruction.points3D.values()])
    if centres.size == 0 or points.size == 0:
        raise PipelineError("compress:up-axis", f"no camera centres or points found in {sparse_dir}")

    vertical_axis = int(np.argmin(centres.var(axis=0)))
    if vertical_axis != 1:
        raise PipelineError(
            "compress:up-axis",
            f"detected vertical axis is COLMAP axis {vertical_axis}, not Y (index 1) — "
            "every capture verified so far has Y as the low-variance (chest-height) axis; "
            "this reconstruction differs and needs a rotation this pipeline hasn't verified. "
            "Add and verify the corresponding case before proceeding.",
        )

    needs_flip = bool(np.median(points[:, vertical_axis]) > np.mean(points[:, vertical_axis]))
    logger.info(
        "up-axis check: vertical=COLMAP axis %d (Y), %s",
        vertical_axis,
        "flip needed" if needs_flip else "no flip needed",
    )
    return needs_flip


def resolve_splat_transform_invocation() -> list[str]:
    try:
        result = subprocess.run(
            resolve_executable(["splat-transform", "--help"]),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as error:
        raise PipelineError(
            "compress:splat-transform", f"executable not found: splat-transform ({error})"
        ) from error

    help_text = result.stdout + result.stderr
    missing = [marker for marker in REQUIRED_HELP_MARKERS if marker not in help_text]
    if missing:
        raise PipelineError(
            "compress:splat-transform",
            f"splat-transform --help is missing expected marker(s) {missing}; "
            "its CLI surface may have changed since this pipeline was written",
        )

    logger.info(
        "splat-transform --help verified: positional <input.ply> <output.sog>, flags %s",
        REQUIRED_HELP_MARKERS,
    )
    return ["-w"]


def find_trained_ply(result_dir: Path) -> Path:
    candidates = sorted(result_dir.rglob("*.ply"))
    if not candidates:
        raise PipelineError("compress", f"no .ply file found under {result_dir}")
    if len(candidates) == 1:
        return candidates[0]

    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    logger.warning(
        "%s: multiple .ply files found, using most recently modified: %s",
        result_dir.name,
        newest,
    )
    return newest


def convert_to_sog(ply_path: Path, sog_path: Path, extra_flags: list[str], needs_flip: bool) -> None:
    sog_path.parent.mkdir(parents=True, exist_ok=True)
    rotate_args = ["-r", UP_AXIS_FLIP_EULER_XYZ] if needs_flip else []
    run_command(
        "compress:splat-transform",
        ["splat-transform", *extra_flags, str(ply_path), *rotate_args, str(sog_path)],
    )


def check_sog_size(folder_name: str, sog_path: Path) -> int:
    size = sog_path.stat().st_size
    if not (MIN_SOG_BYTES <= size <= MAX_SOG_BYTES):
        logger.warning(
            "%s: SOG is %.1f MB, outside the expected 3-12 MB range",
            folder_name,
            size / (1024 * 1024),
        )
    return size


def chunk_overview(
    overview_ply_path: Path,
    area_raw_bboxes: dict[str, BBox],
    compressed_dir: Path,
    overview_folder: str,
    flags: list[str],
    needs_flip: bool,
) -> tuple[Path, int, dict[str, str]]:
    """Splits the overview PLY into one SOG per area bbox — the overview's
    own low-detail coverage of that room, meant to be hidden once the area's
    own high-detail splat is showing — plus a "common" SOG for everything
    outside every area box (MIN_SOG_BYTES/MAX_SOG_BYTES's normal range check
    is skipped for individual chunks since a partial slice of the overview
    has no reason to land in the same size band as a full splat).

    Masking runs on the raw (pre-rotation) PLY positions, matching
    area_raw_bboxes — the same rotation then gets applied to every resulting
    chunk via convert_to_sog, same as any other splat, so chunk and common
    end up in the same corrected frame as everything else in the manifest.

    Only ever selects which Gaussians to keep; splat-transform does the
    actual rotation, exactly as for any other splat, so this can't get
    quaternion/SH rotation math wrong the way hand-rolling it would.
    """
    ply, positions = load_ply_positions(overview_ply_path)
    chunks_dir = compressed_dir / "overview_chunks"

    outside_all = np.ones(len(positions), dtype=bool)
    chunk_paths: dict[str, str] = {}

    for area_id, bbox in area_raw_bboxes.items():
        mask = inside_box_mask(positions, bbox)
        outside_all &= ~mask

        chunk_ply_path = chunks_dir / f"{area_id}.ply"
        count = write_ply_subset(ply, mask, chunk_ply_path)
        if count == 0:
            logger.warning(
                "%s: no overview gaussians fall inside %s's bbox — skipping its chunk",
                overview_folder,
                area_id,
            )
            continue

        chunk_sog_path = chunks_dir / f"{area_id}.sog"
        convert_to_sog(chunk_ply_path, chunk_sog_path, flags, needs_flip)
        chunk_paths[area_id] = str(chunk_sog_path)
        logger.info(
            "%s: overview chunk for %s -> %d gaussians, %.1f MB",
            overview_folder,
            area_id,
            count,
            chunk_sog_path.stat().st_size / (1024 * 1024),
        )

    common_ply_path = compressed_dir / f"{overview_folder}_common.ply"
    common_count = write_ply_subset(ply, outside_all, common_ply_path)
    if common_count == 0:
        # Confirmed empirically, not just a theoretical worry: splat-transform
        # errors on a zero-vertex PLY ("Unsupported data in file") rather than
        # producing an empty SOG, and manifest.overview.common isn't optional
        # the way a chunk is, so there's no "just skip it" fallback here.
        raise PipelineError(
            "compress:overview-chunks",
            f"{overview_folder}: every Gaussian falls inside some area's bbox, leaving nothing for "
            "'common' — check whether the area boxes (with padding) now cover the whole overview",
        )
    common_sog_path = compressed_dir / f"{overview_folder}.sog"
    convert_to_sog(common_ply_path, common_sog_path, flags, needs_flip)
    common_size = check_sog_size(f"{overview_folder} (common)", common_sog_path)
    logger.info("%s: common region -> %d gaussians, %.1f MB", overview_folder, common_count, common_size / (1024 * 1024))

    return common_sog_path, common_size, chunk_paths


def run_compress(workdir: Path) -> None:
    frames_dir = workdir / "frames"
    sparse_dir = workdir / "sparse" / "0"
    sub_dir = workdir / "sub"
    out_dir = workdir / "out"
    compressed_dir = workdir / "compressed"

    manifest = read_capture_manifest(frames_dir)
    folder_names = sorted(manifest.keys())
    overview_folder = next(
        (name for name in folder_names if manifest[name].role.strip().lower() == "overview"),
        None,
    )
    area_folders = [name for name in folder_names if name != overview_folder]

    flags = resolve_splat_transform_invocation()

    # Detected once from the joint reconstruction, not per area: it's a
    # property of the one shared coordinate frame the whole capture was
    # reconstructed in (CLAUDE.md), so every area must apply the identical
    # correction or they'd stop agreeing with each other and with nav.py.
    if not sparse_dir.is_dir():
        raise PipelineError("compress", f"sparse model not found: {sparse_dir} — run `sfm` first")
    needs_flip = detect_up_axis_flip(sparse_dir)

    entries: dict[str, CompressEntry] = {}
    # Raw-frame (pre-rotation) bboxes, cached while processing areas so the
    # overview chunking pass below can mask against them without redoing
    # the COLMAP read.
    area_raw_bboxes: dict[str, BBox] = {}

    for folder_name in area_folders:
        sparse_path = sub_dir / folder_name / "sparse" / "0"
        if not sparse_path.is_dir():
            raise PipelineError(
                "compress", f"sub-model not found: {sparse_path} — run `train` first"
            )

        bbox = bbox_from_submodel(sparse_path, needs_flip)
        area_raw_bboxes[folder_name] = _bbox_arrays(bbox_from_submodel(sparse_path, needs_flip=False))

        ply_path = find_trained_ply(out_dir / folder_name)
        sog_path = compressed_dir / f"{folder_name}.sog"
        convert_to_sog(ply_path, sog_path, flags, needs_flip)
        size = check_sog_size(folder_name, sog_path)

        entries[folder_name] = CompressEntry(bbox=bbox, sog_path=str(sog_path), sog_bytes=size)
        logger.info(
            "%s: bbox=%s sog=%s (%.1f MB)",
            folder_name,
            bbox,
            sog_path.name,
            size / (1024 * 1024),
        )

    if overview_folder is not None:
        overview_sparse_path = sub_dir / overview_folder / "sparse" / "0"
        if not overview_sparse_path.is_dir():
            raise PipelineError(
                "compress", f"sub-model not found: {overview_sparse_path} — run `train` first"
            )
        overview_bbox = bbox_from_submodel(overview_sparse_path, needs_flip)
        overview_ply_path = find_trained_ply(out_dir / overview_folder)

        if area_raw_bboxes:
            common_sog_path, common_size, chunk_paths = chunk_overview(
                overview_ply_path, area_raw_bboxes, compressed_dir, overview_folder, flags, needs_flip
            )
            entries[overview_folder] = CompressEntry(
                bbox=overview_bbox, sog_path=str(common_sog_path), sog_bytes=common_size, chunks=chunk_paths
            )
            logger.info(
                "%s: split into %d area chunk(s) + common (%.1f MB)",
                overview_folder,
                len(chunk_paths),
                common_size / (1024 * 1024),
            )
        else:
            # No areas to chunk against (Phase 1: overview-only capture) —
            # same single-sog path as before.
            sog_path = compressed_dir / f"{overview_folder}.sog"
            convert_to_sog(overview_ply_path, sog_path, flags, needs_flip)
            size = check_sog_size(overview_folder, sog_path)
            entries[overview_folder] = CompressEntry(bbox=overview_bbox, sog_path=str(sog_path), sog_bytes=size)
            logger.info(
                "%s: bbox=%s sog=%s (%.1f MB)",
                overview_folder,
                overview_bbox,
                sog_path.name,
                size / (1024 * 1024),
            )

    write_compress_manifest(compressed_dir, entries)
