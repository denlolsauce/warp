"""Significant change -> a ranked inspection queue.

A per-point change field is not a deliverable. Nobody inspects 200,000
distances; they inspect "the north-east batter, upper bench" and they need
to know which of the several places that moved to walk to first.

So contiguous significant change is grouped into regions, each with its own
volume, extent, peak movement and location, then ranked. Two decisions here
are load-bearing:

* **Only sign-consistent neighbours are grouped.** Loss and gain are
  different events even when adjacent — material leaving a crest and
  arriving at the toe of the same slope is one mechanism but two findings,
  and merging them would net their volumes toward zero and hide it.
* **Regions below a minimum size are dropped.** Isolated significant points
  are what a 95% threshold is *expected* to produce from noise: at LoD95%,
  ~5% of a stable surface reads as significant by chance. Requiring a
  contiguous group is what separates a real feature from that background,
  and it is the difference between a queue an engineer trusts and one they
  learn to ignore.

Ranking is by measured magnitude — peak movement, then volume. It is
explicitly not a risk score. Whether 40mm on a bench crest matters more than
200mm on a spoil pile depends on the structure below it, the geology and the
design case, none of which are in this data. The ordering surfaces the
largest measured movements; the engineer decides what they mean.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from .change import ChangeField
from .volume import VolumeEstimate, planar_grid_volume

logger = logging.getLogger(__name__)

# Two significant points within this many cylinder radii belong to the same
# feature. 2.5x spans the gaps left where individual core points inside a
# real changed region fell just under their own local LoD.
NEIGHBOUR_RADIUS_CYLINDER_MULTIPLE = 2.5
# Minimum core points in a reported region — see the module docstring on the
# 5% false-positive rate inherent to a 95% threshold.
MIN_CLUSTER_POINTS = 12


@dataclass(frozen=True)
class ChangeCluster:
    """One contiguous region of significant, sign-consistent change."""

    cluster_id: int
    direction: str  # "loss" | "gain"
    point_count: int
    centroid: np.ndarray  # (3,) metres
    bbox: tuple[np.ndarray, np.ndarray]
    peak_distance_m: float  # signed, the largest-magnitude reading in the region
    mean_distance_m: float
    # The local 95% level of detection where the peak was measured — the
    # honest companion to peak_distance_m, so a 30 mm peak against a 25 mm
    # LoD is never read as equivalent to 30 mm against 4 mm.
    peak_level_of_detection_m: float
    volume: VolumeEstimate

    @property
    def peak_confidence_ratio(self) -> float:
        """How far past its own detection threshold the peak sits. 1.0 is
        exactly at the limit of what this survey can resolve."""
        if self.peak_level_of_detection_m <= 0:
            return float("inf")
        return abs(self.peak_distance_m) / self.peak_level_of_detection_m

    def as_dict(self) -> dict:
        return {
            "clusterId": self.cluster_id,
            "direction": self.direction,
            "pointCount": self.point_count,
            "centroid": [round(float(v), 3) for v in self.centroid],
            "bbox": [
                [round(float(v), 3) for v in self.bbox[0]],
                [round(float(v), 3) for v in self.bbox[1]],
            ],
            "peakDistanceM": round(self.peak_distance_m, 4),
            "meanDistanceM": round(self.mean_distance_m, 4),
            "peakLevelOfDetectionM": round(self.peak_level_of_detection_m, 4),
            "peakConfidenceRatio": round(self.peak_confidence_ratio, 2),
            "volume": self.volume.as_dict(),
        }


def _components_within(points: np.ndarray, radius_m: float) -> np.ndarray:
    if len(points) < 2:
        return np.zeros(len(points), dtype=np.int64)
    pairs = cKDTree(points).query_pairs(r=radius_m, output_type="ndarray")
    n = len(points)
    if not len(pairs):
        return np.arange(n, dtype=np.int64)
    graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    return labels


def cluster_significant_change(
    field: ChangeField,
    plane_normal: np.ndarray | None = None,
    min_cluster_points: int = MIN_CLUSTER_POINTS,
) -> list[ChangeCluster]:
    """Group `field`'s significant change into ranked findings.

    Returned largest-movement-first, so the head of the list is where to
    walk first.
    """
    radius = field.config.cylinder_radius_m * NEIGHBOUR_RADIUS_CYLINDER_MULTIPLE
    clusters: list[ChangeCluster] = []

    for direction, sign_mask in (
        ("loss", field.significant & (field.distance_m < 0)),
        ("gain", field.significant & (field.distance_m > 0)),
    ):
        indices = np.flatnonzero(sign_mask)
        if not len(indices):
            continue

        labels = _components_within(field.core_points[indices], radius)
        for label in np.unique(labels):
            member_indices = indices[labels == label]
            if len(member_indices) < min_cluster_points:
                continue

            member_points = field.core_points[member_indices]
            member_distances = field.distance_m[member_indices]
            peak_offset = int(np.argmax(np.abs(member_distances)))

            member_mask = np.zeros(len(field.core_points), dtype=bool)
            member_mask[member_indices] = True

            clusters.append(
                ChangeCluster(
                    cluster_id=len(clusters),
                    direction=direction,
                    point_count=len(member_indices),
                    centroid=member_points.mean(axis=0),
                    bbox=(member_points.min(axis=0), member_points.max(axis=0)),
                    peak_distance_m=float(member_distances[peak_offset]),
                    mean_distance_m=float(member_distances.mean()),
                    peak_level_of_detection_m=float(
                        field.level_of_detection_m[member_indices[peak_offset]]
                    ),
                    volume=planar_grid_volume(field, mask=member_mask, plane_normal=plane_normal),
                )
            )

    clusters.sort(key=lambda c: (abs(c.peak_distance_m), abs(c.volume.net_m3)), reverse=True)
    # Renumber after sorting so cluster_id is the queue position an engineer
    # reads off the report, not an artefact of the order regions were found.
    ranked = [replace(cluster, cluster_id=position) for position, cluster in enumerate(clusters)]

    logger.info(
        "geo:clusters: %d finding(s) from %d significant points (%d loss, %d gain)",
        len(ranked), int(field.significant.sum()),
        sum(1 for c in ranked if c.direction == "loss"),
        sum(1 for c in ranked if c.direction == "gain"),
    )
    return ranked
