"""DENSE_PRODUCTS: adapt backend outputs into published measurement artifacts.

Rewrites backend rasters as Cloud Optimized GeoTIFFs, decides whether the DTM
qualifies for publication, and derives the coverage mask. DSM and DTM stay
distinct products — missing ground data is never passed off as bare earth.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..geo import Grid, read_grid, write_cog

logger = logging.getLogger(__name__)

# Below this valid-cell fraction (relative to DSM coverage) a DTM is withheld:
# publishing a mostly-empty "bare earth" grid invites misreading.
DTM_MIN_COVERAGE_FRACTION = 0.6


@dataclass
class DenseProductsResult:
    dsm_cog: Path
    dtm_cog: Path | None
    orthomosaic_cog: Path | None
    coverage_mask_cog: Path
    dtm_withheld_reason: str | None
    dsm_valid_fraction: float
    bounds: tuple[float, float, float, float]
    resolution_m: float


def coverage_fraction(grid: Grid) -> float:
    return float((~np.isnan(grid.data)).sum() / grid.data.size) if grid.data.size else 0.0


def qualify_dtm(dsm: Grid, dtm: Grid | None) -> tuple[bool, str | None]:
    """Publish the DTM only when its coverage justifies a bare-earth claim."""
    if dtm is None:
        return False, "the backend produced no terrain model"
    dsm_valid = int((~np.isnan(dsm.data)).sum())
    dtm_valid = int((~np.isnan(dtm.data)).sum())
    if dsm_valid == 0:
        return False, "the surface model itself has no valid coverage"
    fraction = dtm_valid / dsm_valid
    if fraction < DTM_MIN_COVERAGE_FRACTION:
        return False, (
            f"ground classification covers only {fraction:.0%} of the surveyed surface "
            f"(minimum {DTM_MIN_COVERAGE_FRACTION:.0%}); the DTM is withheld rather than "
            "presenting interpolated gaps as bare earth"
        )
    return True, None


def build_dense_products(
    dsm_path: Path,
    dtm_path: Path | None,
    orthomosaic_path: Path | None,
    output_dir: Path,
) -> DenseProductsResult:
    output_dir.mkdir(parents=True, exist_ok=True)

    dsm = read_grid(dsm_path)
    dsm_cog = output_dir / "dsm.tif"
    write_cog(dsm, dsm_cog)

    dtm = read_grid(dtm_path) if dtm_path and dtm_path.exists() else None
    publish_dtm, withheld_reason = qualify_dtm(dsm, dtm)
    dtm_cog = None
    if publish_dtm:
        dtm_cog = output_dir / "dtm.tif"
        write_cog(dtm, dtm_cog)
    elif withheld_reason:
        logger.info("DTM withheld: %s", withheld_reason)

    ortho_cog = None
    if orthomosaic_path and orthomosaic_path.exists():
        ortho_cog = output_dir / "orthomosaic.tif"
        # Orthomosaics are multi-band; copy as-is when already GeoTIFF.
        import shutil

        shutil.copyfile(orthomosaic_path, ortho_cog)

    # Coverage mask: 1 where the DSM has valid data.
    mask = Grid(
        data=np.where(np.isnan(dsm.data), np.nan, 1.0),
        transform=dsm.transform,
        crs=dsm.crs,
    )
    coverage_cog = output_dir / "coverage_mask.tif"
    write_cog(mask, coverage_cog)

    return DenseProductsResult(
        dsm_cog=dsm_cog,
        dtm_cog=dtm_cog,
        orthomosaic_cog=ortho_cog,
        coverage_mask_cog=coverage_cog,
        dtm_withheld_reason=withheld_reason,
        dsm_valid_fraction=coverage_fraction(dsm),
        bounds=dsm.bounds(),
        resolution_m=dsm.resolution,
    )
