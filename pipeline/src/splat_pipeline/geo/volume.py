"""Volume of material gained or lost, with an honest error band.

The measurement is an integral of M3C2 distance over surface area, computed
on a grid in a projection plane: each occupied cell contributes its mean
distance times the surface area it represents. Projected cell area is
divided by |normal . plane_normal| to recover true surface area, which is
the step that makes this work on a slope rather than only on flat ground.

That correction has a hard limit. A surface perpendicular to the projection
plane has a vanishing projected footprint, so its corrected area diverges.
Such cells are excluded and their extent is reported through
`excluded_steep_area_m2`, because a volume that quietly swallowed a
divide-by-near-zero is worse than one that admits it skipped the vertical
face.

The uncertainty is deliberately not a single RSS over all cells. The level
of detection has two parts that behave completely differently when summed
over area:

* the roughness term is independent between cells, so it grows as the root
  sum of squares — a large area averages it down;
* the registration error is *systematic*, identical and same-signed across
  every cell, so it grows linearly with area and cannot be averaged away.
  It usually dominates on a big region, which is exactly why a volume from a
  poorly registered pair of captures should not be quoted tightly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from ..errors import PipelineError
from .change import ChangeField

logger = logging.getLogger(__name__)

# Cell size as a multiple of the M3C2 cylinder radius. Below 1x, adjacent
# cells share most of their source points and the "independent roughness"
# assumption behind the RSS term stops holding.
CELL_SIZE_CYLINDER_RADIUS_MULTIPLE = 2.0
# Minimum |normal . plane_normal| for a cell to be integrable. cos(80 deg):
# past this the area correction exceeds 5.8x and is dominated by how the
# projection plane was chosen rather than by the surface.
MIN_PROJECTION_COSINE = 0.174


@dataclass(frozen=True)
class VolumeEstimate:
    """Signed volume change over a region.

    `net_m3` is gain minus loss. `gain_m3` and `loss_m3` are reported
    separately (loss as a positive magnitude) because they are different
    physical events on a slope — 200 m3 down from the crest and 200 m3
    piled at the toe is a developing failure, and its net volume is zero.
    """

    net_m3: float
    gain_m3: float
    loss_m3: float
    uncertainty_m3: float
    surface_area_m2: float
    cell_size_m: float
    cell_count: int
    excluded_steep_area_m2: float

    def as_dict(self) -> dict:
        return {
            "netM3": round(self.net_m3, 3),
            "gainM3": round(self.gain_m3, 3),
            "lossM3": round(self.loss_m3, 3),
            "uncertaintyM3": round(self.uncertainty_m3, 3),
            "surfaceAreaM2": round(self.surface_area_m2, 3),
            "cellSizeM": round(self.cell_size_m, 4),
            "cellCount": self.cell_count,
            "excludedSteepAreaM2": round(self.excluded_steep_area_m2, 3),
        }


def planar_grid_volume(
    field: ChangeField,
    mask: np.ndarray | None = None,
    plane_normal: np.ndarray | None = None,
    cell_size_m: float | None = None,
) -> VolumeEstimate:
    """Integrate `field`'s distances over area.

    `mask` selects which core points to include — a cluster's own members
    for a per-finding volume, or every significant point for a site total.
    Points outside the mask, unmeasured, or insignificant contribute
    nothing: including sub-LoD readings would sum up noise, and on a large
    area that sum is not small.
    """
    include = field.significant if mask is None else (field.significant & mask)
    if not include.any():
        return VolumeEstimate(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0.0)

    plane_normal = (
        np.array([0.0, 0.0, 1.0]) if plane_normal is None else np.asarray(plane_normal, dtype=np.float64)
    )
    norm = float(np.linalg.norm(plane_normal))
    if norm <= 0:
        raise PipelineError("geo:volume", "projection plane normal must be non-zero")
    plane_normal = plane_normal / norm

    cell_size_m = cell_size_m or field.config.cylinder_radius_m * CELL_SIZE_CYLINDER_RADIUS_MULTIPLE
    if cell_size_m <= 0:
        raise PipelineError("geo:volume", f"cell size must be positive, got {cell_size_m}")

    points = field.core_points[include]
    distances = field.distance_m[include]
    normals = field.normal[include]
    # The random half of the level of detection: the roughness term, with the
    # systematic registration error taken back out so it can be summed
    # coherently instead of in quadrature.
    random_lod = np.maximum(
        field.level_of_detection_m[include] - field.config.registration_error_m, 0.0
    )

    # Any orthonormal basis of the projection plane works; the volume is
    # invariant to how it's rotated within the plane.
    helper = np.array([1.0, 0.0, 0.0])
    if abs(float(helper @ plane_normal)) > 0.9:
        helper = np.array([0.0, 1.0, 0.0])
    basis_u = np.cross(plane_normal, helper)
    basis_u /= np.linalg.norm(basis_u)
    basis_v = np.cross(plane_normal, basis_u)

    cell_u = np.floor((points @ basis_u) / cell_size_m).astype(np.int64)
    cell_v = np.floor((points @ basis_v) / cell_size_m).astype(np.int64)
    _, cell_index = np.unique(np.stack([cell_u, cell_v], axis=1), axis=0, return_inverse=True)
    cell_count = int(cell_index.max()) + 1

    counts = np.bincount(cell_index, minlength=cell_count)
    mean_distance = np.bincount(cell_index, weights=distances, minlength=cell_count) / counts
    mean_cosine = np.abs(
        np.bincount(cell_index, weights=normals @ plane_normal, minlength=cell_count) / counts
    )
    # Cell-mean random LoD shrinks by sqrt(n) in the count of independent
    # core points averaged into the cell, the same reason M3C2's own
    # roughness term is divided by sqrt(n).
    cell_random_lod = (
        np.bincount(cell_index, weights=random_lod, minlength=cell_count) / counts
    ) / np.sqrt(counts)

    projected_area = cell_size_m ** 2
    integrable = mean_cosine >= MIN_PROJECTION_COSINE
    surface_area = np.zeros(cell_count)
    surface_area[integrable] = projected_area / mean_cosine[integrable]

    cell_volume = mean_distance[integrable] * surface_area[integrable]
    gain = float(cell_volume[cell_volume > 0].sum())
    # abs() rather than negation: summing an empty selection gives -0.0,
    # which serialises into the report as "-0.0" and reads as a measurement.
    loss = abs(float(cell_volume[cell_volume < 0].sum()))
    total_area = float(surface_area[integrable].sum())

    random_uncertainty = float(
        np.sqrt(((cell_random_lod[integrable] * surface_area[integrable]) ** 2).sum())
    )
    systematic_uncertainty = field.config.registration_error_m * total_area
    uncertainty = random_uncertainty + systematic_uncertainty

    excluded_steep_area = float(
        (projected_area / np.maximum(mean_cosine[~integrable], MIN_PROJECTION_COSINE)).sum()
    )
    if excluded_steep_area > 0:
        logger.warning(
            "geo:volume: %d cell(s) (~%.1f m2) are too close to perpendicular to the projection "
            "plane to integrate and were excluded from the volume",
            int((~integrable).sum()), excluded_steep_area,
        )

    logger.info(
        "geo:volume: net %+.2f m3 (gain %.2f, loss %.2f) +-%.2f over %.1f m2 in %d cells",
        gain - loss, gain, loss, uncertainty, total_area, int(integrable.sum()),
    )
    return VolumeEstimate(
        net_m3=gain - loss,
        gain_m3=gain,
        loss_m3=loss,
        uncertainty_m3=uncertainty,
        surface_area_m2=total_area,
        cell_size_m=cell_size_m,
        cell_count=int(integrable.sum()),
        excluded_steep_area_m2=excluded_steep_area,
    )
