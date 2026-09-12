"""Raster and CRS operations for the measurement branch.

All elevation grids are handled as (array, transform, crs, nodata) tuples via
rasterio. Grid harmonization never resamples to a finer resolution than the
coarsest source — that would imply information the data does not contain.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine, rowcol
from rasterio.warp import reproject
from pyproj import CRS, Transformer

logger = logging.getLogger(__name__)


@dataclass
class Grid:
    """One single-band elevation grid in a projected CRS."""

    data: np.ndarray  # float64, NaN = nodata
    transform: Affine
    crs: str  # "EPSG:xxxx"

    @property
    def resolution(self) -> float:
        return abs(self.transform.a)

    def bounds(self) -> tuple[float, float, float, float]:
        h, w = self.data.shape
        left, top = self.transform @ (0, 0)
        right, bottom = self.transform @ (w, h)
        return (min(left, right), min(top, bottom), max(left, right), max(top, bottom))


def read_grid(path: Path) -> Grid:
    with rasterio.open(path) as src:
        data = src.read(1).astype(np.float64)
        if src.nodata is not None:
            data[data == src.nodata] = np.nan
        crs = f"EPSG:{src.crs.to_epsg()}" if src.crs and src.crs.to_epsg() else str(src.crs)
        return Grid(data=data, transform=src.transform, crs=crs)


def write_cog(grid: Grid, path: Path) -> None:
    """Write a Cloud Optimized GeoTIFF (tiled + overviews, deflate)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = grid.data.astype(np.float32)
    nodata = -9999.0
    out = np.where(np.isnan(data), nodata, data)
    h, w = out.shape
    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "width": w,
        "height": h,
        "count": 1,
        "crs": grid.crs,
        "transform": grid.transform,
        "nodata": nodata,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "compress": "deflate",
        "interleave": "band",
    }
    # Small grids cannot be tiled at 256; fall back to strips.
    if w < 256 or h < 256:
        profile.pop("tiled")
        profile.pop("blockxsize")
        profile.pop("blockysize")
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(out, 1)
        factors = [f for f in (2, 4, 8, 16) if w // f >= 64 and h // f >= 64]
        if factors:
            dst.build_overviews(factors, Resampling.average)


def harmonize_grids(a: Grid, b: Grid) -> tuple[Grid, Grid]:
    """Resample both grids onto a common grid at the COARSER resolution.

    Requires an identical CRS (datum compatibility is checked upstream and is
    a hard gate, not something silently reprojected away here).
    """
    if a.crs != b.crs:
        raise ValueError(f"CRS mismatch: {a.crs} vs {b.crs} — harmonization requires a common CRS")

    res = max(a.resolution, b.resolution)
    ab, bb = a.bounds(), b.bounds()
    left = max(ab[0], bb[0])
    bottom = max(ab[1], bb[1])
    right = min(ab[2], bb[2])
    top = min(ab[3], bb[3])
    if right <= left or top <= bottom:
        raise ValueError("grids share no common extent")

    width = max(1, int(math.floor((right - left) / res)))
    height = max(1, int(math.floor((top - bottom) / res)))
    transform = Affine(res, 0.0, left, 0.0, -res, top)

    def _resample(src: Grid) -> Grid:
        dst = np.full((height, width), np.nan, dtype=np.float64)
        reproject(
            source=np.where(np.isnan(src.data), -9999.0, src.data),
            destination=dst,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=-9999.0,
            dst_transform=transform,
            dst_crs=src.crs,
            dst_nodata=np.nan,
            resampling=Resampling.average if res > src.resolution else Resampling.bilinear,
        )
        return Grid(data=dst, transform=transform, crs=src.crs)

    return _resample(a), _resample(b)


def sample_grid(grid: Grid, easting: float, northing: float) -> float:
    """Bilinear sample; NaN outside coverage or on nodata neighbours."""
    col, row = ~grid.transform @ (easting, northing)
    # Shift to cell-center coordinates for interpolation.
    col -= 0.5
    row -= 0.5
    r0, c0 = int(math.floor(row)), int(math.floor(col))
    h, w = grid.data.shape
    if r0 < 0 or c0 < 0 or r0 + 1 >= h or c0 + 1 >= w:
        return float("nan")
    fr, fc = row - r0, col - c0
    q = grid.data[r0 : r0 + 2, c0 : c0 + 2]
    if np.any(np.isnan(q)):
        return float("nan")
    top = q[0, 0] * (1 - fc) + q[0, 1] * fc
    bot = q[1, 0] * (1 - fc) + q[1, 1] * fc
    return float(top * (1 - fr) + bot * fr)


# --- CRS transforms ---------------------------------------------------------

def make_transformer(source_crs: str, target_crs: str) -> Transformer:
    return Transformer.from_crs(CRS(source_crs), CRS(target_crs), always_xy=True)


def geographic_to_projected(
    lon: np.ndarray, lat: np.ndarray, alt: np.ndarray, projected_crs: str
) -> np.ndarray:
    """WGS84 geographic → projected engineering frame. Heights pass through
    unchanged; vertical datum handling is explicit metadata, never implicit."""
    t = make_transformer("EPSG:4326", projected_crs)
    e, n = t.transform(lon, lat)
    return np.column_stack([e, n, alt])


def crs_is_compatible(a: str, b: str) -> bool:
    try:
        return CRS(a).equals(CRS(b))
    except Exception:
        return False
