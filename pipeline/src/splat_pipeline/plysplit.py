from __future__ import annotations

from pathlib import Path

import numpy as np
from plyfile import PlyData, PlyElement

# (mins, maxs), each shape (3,) — an axis-aligned box in whatever coordinate
# frame the caller's positions are already in.
BBox = tuple[np.ndarray, np.ndarray]


def load_ply_positions(ply_path: Path) -> tuple[PlyData, np.ndarray]:
    """Reads a Gaussian-splat PLY, returning the parsed PlyData (every
    property intact) alongside just its (N, 3) vertex positions for spatial
    masking."""
    ply = PlyData.read(str(ply_path))
    vertex = ply["vertex"]
    positions = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1).astype(np.float64)
    return ply, positions


def load_ply_opacity(ply: PlyData) -> np.ndarray:
    """Decoded (N,) opacity in [0, 1] — gsplat stores it as a pre-sigmoid logit."""
    vertex = ply["vertex"]
    return 1.0 / (1.0 + np.exp(-vertex["opacity"].astype(np.float64)))


def load_ply_scale(ply: PlyData) -> np.ndarray:
    """Decoded (N, 3) per-axis scale — gsplat stores it as a log-scale."""
    vertex = ply["vertex"]
    return np.exp(
        np.stack([vertex["scale_0"], vertex["scale_1"], vertex["scale_2"]], axis=1).astype(np.float64)
    )


def inside_box_mask(positions: np.ndarray, bbox: BBox) -> np.ndarray:
    mins, maxs = bbox
    return np.all((positions >= mins) & (positions <= maxs), axis=1)


def write_ply_subset(
    ply: PlyData, mask: np.ndarray, out_path: Path, opacity_logit_delta: float = 0.0
) -> int:
    """Writes the subset of ply's vertex element selected by mask to
    out_path, preserving every other property (SH coefficients, scale,
    rotation) untouched — this only ever selects rows, never transforms
    Gaussian *geometry*, so unlike a rotation it can't get quaternion/SH
    math wrong.

    opacity_logit_delta, when non-zero, is added to the stored (pre-sigmoid)
    opacity. That stays firmly on the safe side of the same line: opacity is
    a single scalar per Gaussian with no orientation to it, so shifting it
    needs none of the Wigner-D basis rotation that makes transforming SH
    coefficients dangerous. Adding in logit space is a monotonic remap of
    alpha — relative ordering is exactly preserved and the result cannot
    leave (0, 1) — see cleanup.solidify_opacity_delta for why it's needed.

    Returns the number of vertices written.
    """
    vertex = ply["vertex"]
    subset = vertex.data[mask].copy()
    if opacity_logit_delta:
        subset["opacity"] = (
            subset["opacity"].astype(np.float64) + opacity_logit_delta
        ).astype(subset["opacity"].dtype)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    element = PlyElement.describe(subset, "vertex")
    PlyData([element], text=ply.text, byte_order=ply.byte_order).write(str(out_path))
    return int(mask.sum())
