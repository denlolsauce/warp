"""LAZ point-cloud I/O and spatial queries (laspy + numpy).

Coordinates are double precision end to end. A uniform grid index supports the
neighbourhood queries M3C2 needs without a compiled KD-tree dependency.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np

logger = logging.getLogger(__name__)


def read_laz(path: Path) -> np.ndarray:
    """Read a LAS/LAZ file into an (N, 3) float64 array of x, y, z."""
    with laspy.open(path) as reader:
        las = reader.read()
    return np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)]).astype(np.float64)


def write_laz(points: np.ndarray, path: Path, crs_epsg: int | None = None, extra_dims: dict[str, np.ndarray] | None = None) -> None:
    """Write an (N, 3) array to LAZ; optional per-point float64 extra dimensions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    header = laspy.LasHeader(point_format=6, version="1.4")
    header.offsets = points.min(axis=0)
    header.scales = np.array([0.001, 0.001, 0.001])
    if crs_epsg is not None:
        import pyproj

        header.add_crs(pyproj.CRS.from_epsg(crs_epsg))
    las = laspy.LasData(header)
    las.x = points[:, 0]
    las.y = points[:, 1]
    las.z = points[:, 2]
    for name, values in (extra_dims or {}).items():
        las.add_extra_dim(laspy.ExtraBytesParams(name=name, type=np.float64))
        las[name] = values
    las.write(path)


@dataclass
class GridIndex:
    """Uniform 2D grid over x/y for radius queries on terrain-like clouds."""

    points: np.ndarray
    cell: float
    origin: tuple[float, float]
    cells: dict[tuple[int, int], np.ndarray]

    @classmethod
    def build(cls, points: np.ndarray, cell: float) -> "GridIndex":
        ox, oy = float(points[:, 0].min()), float(points[:, 1].min())
        ix = np.floor((points[:, 0] - ox) / cell).astype(np.int64)
        iy = np.floor((points[:, 1] - oy) / cell).astype(np.int64)
        order = np.lexsort((iy, ix))
        sx, sy = ix[order], iy[order]
        cells: dict[tuple[int, int], np.ndarray] = {}
        if len(order):
            start = 0
            for i in range(1, len(order) + 1):
                if i == len(order) or sx[i] != sx[start] or sy[i] != sy[start]:
                    cells[(int(sx[start]), int(sy[start]))] = order[start:i]
                    start = i
        return cls(points=points, cell=cell, origin=(ox, oy), cells=cells)

    def query_radius_2d(self, x: float, y: float, radius: float) -> np.ndarray:
        """Indices of points within `radius` of (x, y) in the horizontal plane."""
        ox, oy = self.origin
        r = int(math.ceil(radius / self.cell))
        cx = int(math.floor((x - ox) / self.cell))
        cy = int(math.floor((y - oy) / self.cell))
        candidates = []
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                idx = self.cells.get((cx + dx, cy + dy))
                if idx is not None:
                    candidates.append(idx)
        if not candidates:
            return np.empty(0, dtype=np.int64)
        cand = np.concatenate(candidates)
        pts = self.points[cand]
        d2 = (pts[:, 0] - x) ** 2 + (pts[:, 1] - y) ** 2
        return cand[d2 <= radius * radius]


def estimate_normal(points: np.ndarray) -> np.ndarray:
    """Least-squares plane normal of a neighbourhood, oriented +Z."""
    centered = points - points.mean(axis=0)
    # Smallest right singular vector of the centered neighbourhood.
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    normal = vt[-1]
    if normal[2] < 0:
        normal = -normal
    return normal / np.linalg.norm(normal)
