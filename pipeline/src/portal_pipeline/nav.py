import json
import logging
import subprocess
from pathlib import Path

import numpy as np
import pycolmap

from .capture_manifest import read_capture_manifest
from .compress import detect_up_axis_flip, read_compress_manifest
from .errors import PipelineError
from .subprocess_utils import resolve_executable

logger = logging.getLogger(__name__)

MOVING_AVERAGE_WINDOW = 5
RESAMPLE_SPACING_METERS = 0.25
PROXIMITY_THRESHOLD_METERS = 0.8
UP_AXIS_INDEX = 1
UP_AXIS = [0.0, 1.0, 0.0]
CAMERA_TO_FLOOR_OFFSET_METERS = 1.55
MANIFEST_VERSION = 1
DEFAULT_FLOOR_LABEL = "0"
SCHEMA_VALIDATOR_RELATIVE_PATH = Path("packages") / "schema" / "scripts" / "validate.mjs"


def extract_camera_centres_by_folder(sparse_dir: Path, needs_flip: bool) -> dict[str, np.ndarray]:
    reconstruction = pycolmap.Reconstruction(str(sparse_dir))

    by_folder: dict[str, list[tuple[str, np.ndarray]]] = {}
    for image in reconstruction.images.values():
        parts = Path(image.name).parts
        folder_name, frame_name = parts[0], parts[-1]
        center = np.array(image.projection_center(), dtype=np.float64)
        # needs_flip must come from compress.py's detect_up_axis_flip() on
        # this same sparse_dir — raw COLMAP world orientation isn't
        # gravity-aligned, so both the nav path and the splat need the
        # identical correction or they land right-side-up but no longer
        # agree with each other's floor/up direction.
        if needs_flip:
            center[[1, 2]] *= -1
        by_folder.setdefault(folder_name, []).append((frame_name, center))

    return {
        folder_name: np.array([center for _, center in sorted(entries, key=lambda e: e[0])])
        for folder_name, entries in by_folder.items()
    }


def moving_average(points: np.ndarray, window: int = MOVING_AVERAGE_WINDOW) -> np.ndarray:
    if len(points) < window:
        return points.copy()
    pad = window // 2
    padded = np.pad(points, ((pad, pad), (0, 0)), mode="edge")
    kernel = np.ones(window) / window
    return np.stack(
        [np.convolve(padded[:, axis], kernel, mode="valid") for axis in range(points.shape[1])],
        axis=1,
    )


def _catmull_rom_segment(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray, p3: np.ndarray, t: float) -> np.ndarray:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def fit_catmull_rom(points: np.ndarray, samples_per_segment: int = 20) -> np.ndarray:
    if len(points) < 2:
        return points.copy()

    extended = np.vstack([points[0], points, points[-1]])
    n_segments = len(points) - 1
    dense = []
    for i in range(n_segments):
        p0, p1, p2, p3 = extended[i], extended[i + 1], extended[i + 2], extended[i + 3]
        ts = np.linspace(0.0, 1.0, samples_per_segment, endpoint=(i == n_segments - 1))
        dense.extend(_catmull_rom_segment(p0, p1, p2, p3, t) for t in ts)
    return np.array(dense)


def resample_by_arc_length(
    dense_points: np.ndarray, spacing: float = RESAMPLE_SPACING_METERS
) -> np.ndarray:
    if len(dense_points) < 2:
        return dense_points.copy()

    deltas = np.linalg.norm(np.diff(dense_points, axis=0), axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(deltas)])
    total_length = cumulative[-1]
    if total_length == 0:
        return dense_points[:1].copy()

    n_samples = max(2, int(total_length // spacing) + 1)
    target_distances = np.arange(n_samples) * spacing
    target_distances = target_distances[target_distances <= total_length]
    if target_distances[-1] < total_length:
        target_distances = np.append(target_distances, total_length)

    resampled = np.empty((len(target_distances), dense_points.shape[1]))
    for axis in range(dense_points.shape[1]):
        resampled[:, axis] = np.interp(target_distances, cumulative, dense_points[:, axis])
    return resampled


def build_nav_path(
    centres: np.ndarray,
    window: int = MOVING_AVERAGE_WINDOW,
    spacing: float = RESAMPLE_SPACING_METERS,
) -> np.ndarray:
    smoothed = moving_average(centres, window)
    dense = fit_catmull_rom(smoothed)
    return resample_by_arc_length(dense, spacing)


def build_nav_graph(
    paths: dict[str, np.ndarray], proximity_threshold: float = PROXIMITY_THRESHOLD_METERS
) -> tuple[list[list[float]], list[list[int]], list[dict]]:
    nodes: list[list[float]] = []
    folder_node_range: dict[str, tuple[int, int]] = {}
    edges: list[list[int]] = []

    folder_names = sorted(paths.keys())
    for folder_name in folder_names:
        start = len(nodes)
        nodes.extend(point.tolist() for point in paths[folder_name])
        end = len(nodes)
        folder_node_range[folder_name] = (start, end)
        edges.extend([i, i + 1] for i in range(start, end - 1))

    positions = np.array(nodes)
    crossings: list[dict] = []
    for a_index, folder_a in enumerate(folder_names):
        a_start, a_end = folder_node_range[folder_a]
        for folder_b in folder_names[a_index + 1 :]:
            b_start, b_end = folder_node_range[folder_b]
            for i in range(a_start, a_end):
                for j in range(b_start, b_end):
                    if np.linalg.norm(positions[i] - positions[j]) < proximity_threshold:
                        edges.append([i, j])
                        crossings.append(
                            {
                                "folder_a": folder_a,
                                "folder_b": folder_b,
                                "pos": positions[i].tolist(),
                            }
                        )

    return nodes, edges, crossings


def build_thresholds(
    crossings: list[dict], radius: float = PROXIMITY_THRESHOLD_METERS
) -> dict[str, list[dict]]:
    grouped: dict[tuple[str, str], list[list[float]]] = {}
    for crossing in crossings:
        key = (crossing["folder_a"], crossing["folder_b"])
        grouped.setdefault(key, []).append(crossing["pos"])

    thresholds_by_folder: dict[str, list[dict]] = {}
    for (folder_a, folder_b), positions in grouped.items():
        centroid = np.mean(np.array(positions), axis=0).tolist()
        thresholds_by_folder.setdefault(folder_a, []).append(
            {"pos": centroid, "radius": radius, "connects": folder_b}
        )
        thresholds_by_folder.setdefault(folder_b, []).append(
            {"pos": centroid, "radius": radius, "connects": folder_a}
        )
    return thresholds_by_folder


def compute_floor_y(
    all_nodes: list[list[float]],
    offset: float = CAMERA_TO_FLOOR_OFFSET_METERS,
    up_axis_index: int = UP_AXIS_INDEX,
) -> float:
    heights = np.array([node[up_axis_index] for node in all_nodes])
    return float(np.median(heights) - offset)


def compute_spawn(path: np.ndarray) -> dict:
    pos = path[0].tolist()
    if len(path) < 2:
        return {"pos": pos, "yaw": 0.0}
    direction = path[1] - path[0]
    yaw = float(np.degrees(np.arctan2(direction[0], direction[2])))
    return {"pos": pos, "yaw": yaw}


def assemble_manifest(
    tour_id: str,
    capture_manifest: dict,
    compress_manifest: dict,
    paths: dict[str, np.ndarray],
    nodes: list[list[float]],
    edges: list[list[int]],
    thresholds_by_folder: dict[str, list[dict]],
) -> dict:
    overview_folder = next(
        (name for name, entry in capture_manifest.items() if entry.role.strip().lower() == "overview"),
        None,
    )

    overview = None
    if overview_folder is not None:
        overview = {
            "common": compress_manifest[overview_folder].sog_path,
            "chunks": compress_manifest[overview_folder].chunks or {},
        }

    areas = []
    for folder_name in sorted(capture_manifest.keys()):
        if folder_name == overview_folder:
            continue
        capture_entry = capture_manifest[folder_name]
        compress_entry = compress_manifest[folder_name]
        areas.append(
            {
                "id": folder_name,
                "name": capture_entry.area_name,
                "floor": DEFAULT_FLOOR_LABEL,
                "splatUrl": compress_entry.sog_path,
                "bbox": compress_entry.bbox,
                "spawn": compute_spawn(paths[folder_name]),
                "thresholds": thresholds_by_folder.get(folder_name, []),
            }
        )

    return {
        "tourId": tour_id,
        "version": MANIFEST_VERSION,
        "upAxis": UP_AXIS,
        "floorY": compute_floor_y(nodes),
        "overview": overview,
        "areas": areas,
        "nav": {"nodes": nodes, "edges": edges},
    }


def validate_manifest(manifest: dict, repo_root: Path) -> None:
    validator_path = repo_root / SCHEMA_VALIDATOR_RELATIVE_PATH
    if not validator_path.is_file():
        raise PipelineError("nav:validate", f"schema validator script not found: {validator_path}")

    try:
        result = subprocess.run(
            resolve_executable(["node", str(validator_path)]),
            input=json.dumps(manifest),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as error:
        raise PipelineError("nav:validate", f"executable not found: node ({error})") from error

    if result.returncode != 0:
        raise PipelineError(
            "nav:validate",
            "SceneManifest failed Zod validation",
            "\n".join((result.stdout + result.stderr).splitlines()[-40:]),
        )
    logger.info("SceneManifest validated against packages/schema")


def run_nav(workdir: Path, tour_id: str, repo_root: Path) -> None:
    frames_dir = workdir / "frames"
    sparse_dir = workdir / "sparse" / "0"
    compressed_dir = workdir / "compressed"

    if not sparse_dir.is_dir():
        raise PipelineError("nav", f"sparse model not found: {sparse_dir} — run `sfm` first")

    capture_manifest = read_capture_manifest(frames_dir)
    compress_manifest = read_compress_manifest(compressed_dir)

    needs_flip = detect_up_axis_flip(sparse_dir)
    centres_by_folder = extract_camera_centres_by_folder(sparse_dir, needs_flip)
    paths = {
        folder_name: build_nav_path(centres)
        for folder_name, centres in centres_by_folder.items()
    }

    for folder_name, path in paths.items():
        logger.info("%s: %d camera centres -> %d nav nodes", folder_name, len(centres_by_folder[folder_name]), len(path))

    nodes, edges, crossings = build_nav_graph(paths)
    logger.info("%d nav nodes, %d edges, %d doorway crossing(s)", len(nodes), len(edges), len(crossings))
    thresholds_by_folder = build_thresholds(crossings)

    manifest = assemble_manifest(
        tour_id, capture_manifest, compress_manifest, paths, nodes, edges, thresholds_by_folder
    )

    validate_manifest(manifest, repo_root)

    manifest_path = workdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    logger.info("wrote %s", manifest_path)
