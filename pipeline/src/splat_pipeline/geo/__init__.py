"""Geotechnical monitoring: turn two captures of the same slope into a
measured, defensible change report.

The product-splat stages (ingest -> compress) answer "what does this thing
look like". These stages answer the question a geotechnical engineer is
actually paid to answer: *what moved since last time, by how much, and is
that number bigger than my measurement error*.

Order of operations, and why it can't be reordered:

1. `cloud`        - which gaussians count as ground surface at all.
2. `georeference` - GCP similarity fit. SfM recovers geometry only up to an
                    arbitrary 7-DoF similarity, so until this runs there is
                    no such thing as a distance in metres.
3. `register`     - trimmed rigid ICP of the new capture onto the baseline.
                    GCP residuals alone (cm-scale) are larger than the
                    change worth reporting, so a fine alignment on the
                    parts that didn't move is what makes small change
                    detectable. Its inlier RMSE *is* the registration error
                    the level of detection is built from.
4. `change`       - M3C2 (Lague et al. 2013): signed distance along the
                    local surface normal, with a per-point 95% level of
                    detection from local roughness plus that registration
                    error. Change below its own LoD is reported as not
                    significant rather than as a small number.
5. `volume`       - signed volume per changed region, with an uncertainty
                    band derived from the same LoD.
6. `clusters`     - group significant change into ranked, individually
                    describable findings: the inspection queue.

Nothing here scores or classifies risk. Every output is a measurement with
an error bar attached, because the engineer signing the report is the one
who owns the interpretation.
"""

from .change import ChangeConfig, ChangeField, compute_change
from .cloud import load_surface_points
from .clusters import ChangeCluster, cluster_significant_change
from .georeference import GroundControlPoint, SimilarityTransform, fit_similarity_transform
from .register import CaptureAlignment, align_captures
from .volume import VolumeEstimate, planar_grid_volume

__all__ = [
    "CaptureAlignment",
    "ChangeCluster",
    "ChangeConfig",
    "ChangeField",
    "GroundControlPoint",
    "SimilarityTransform",
    "VolumeEstimate",
    "align_captures",
    "cluster_significant_change",
    "compute_change",
    "fit_similarity_transform",
    "load_surface_points",
    "planar_grid_volume",
]
