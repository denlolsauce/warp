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


def inside_box_mask(positions: np.ndarray, bbox: BBox) -> np.ndarray:
    mins, maxs = bbox
    return np.all((positions >= mins) & (positions <= maxs), axis=1)


def write_ply_subset(ply: PlyData, mask: np.ndarray, out_path: Path) -> int:
    """Writes the subset of ply's vertex element selected by mask to
    out_path, preserving every other property (SH coefficients, opacity,
    scale, rotation) untouched — this only ever selects rows, never
    transforms Gaussian data, so unlike a rotation it can't get quaternion/SH
    math wrong.

    Returns the number of vertices written.
    """
    vertex = ply["vertex"]
    subset = vertex.data[mask]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    element = PlyElement.describe(subset, "vertex")
    PlyData([element], text=ply.text, byte_order=ply.byte_order).write(str(out_path))
    return int(mask.sum())
