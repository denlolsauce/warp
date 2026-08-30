"""CLAUDE.md's Cleanup stage — this is where the perceived quality actually
comes from. Four sub-steps, run in the order CLAUDE.md lists them (step 2
additionally isolates the largest connected component after plane removal —
see largest_connected_component's docstring for why that's still "detect and
remove the support surface", not a fifth step of its own):

1. Segment the product with SAM 2, prune background Gaussians by the masks.
2. Detect and remove the support surface via RANSAC plane fit, then isolate
   the product from whatever non-planar part of that surface remains (e.g.
   a table's legs).
3. Prune floaters by opacity/scale thresholds plus a k-NN spatial-density filter.
4. Recentre at the centroid, align the up-axis, normalise scale. The up-axis
   itself is the isolated product's own PCA principal axis, not the RANSAC
   plane's normal directly — see estimate_up_axis's docstring for why.

Steps 1-3 only ever select which Gaussians survive (a boolean mask fed to
plysplit.write_ply_subset) — never transform one. Step 4 is the one place
that must move surviving Gaussians, and it deliberately does not hand-roll
that: gsplat's PLY stores each Gaussian's orientation as SH coefficients plus
a rotation quaternion, and rotating those correctly needs a Wigner-D-style
rotation of the SH basis, not a naive per-field transform (compress.py's own
UP_AXIS_FLIP_EULER_XYZ comment is the precedent for this — it delegates
rotation to splat-transform for exactly this reason). Step 4 only computes
*what* transform is needed, in plain numpy on positions, and hands the actual
application to `splat-transform -t -r -s`, the same tool compress.py already
shells out to.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import pycolmap
from plyfile import PlyData
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

from .errors import PipelineError
from .plysplit import load_ply_opacity, load_ply_positions, load_ply_scale, write_ply_subset
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step 1: SAM 2 segmentation -> background pruning
# ---------------------------------------------------------------------------


class SegmentationBackend(Protocol):
    """CLAUDE.md: pose-estimation and training sit behind swappable
    interfaces "from day one; both will be replaced within a year" — SAM 2
    is named as the concrete choice for segmentation but is exactly as
    likely to be swapped, so it gets the same treatment.
    """

    def segment(self, image_path: Path) -> np.ndarray:
        """Returns a boolean (H, W) foreground mask for the image."""
        ...


# Running SAM 2 on every extracted frame (250-400 of them) would add real
# GPU-minutes cost — CLAUDE.md's own non-negotiable — for little extra
# accuracy in a majority-vote scheme; a spread-out subsample is enough
# for each Gaussian to be seen from several angles.
SEGMENTATION_SAMPLE_FRAMES = 30
# A Gaussian seen by zero sampled cameras is kept, not dropped — this step
# should only remove what it has positive evidence is background; anything
# it can't judge is left for the floater pass (step 3) to catch instead.
SEGMENTATION_VOTE_THRESHOLD = 0.5


@dataclass
class Sam2SegmentationBackend:
    """Point-prompted SAM 2: prompts the image centre and keeps the
    highest-scoring returned mask — the standard single-prompt usage pattern
    from Meta's own SAM/SAM2 examples, and a reasonable default given the
    capture checklist ("single product... filling most of the frame")
    reliably puts the product under the centre pixel.

    NOT verified against a real checkpoint in this environment — there's no
    GPU/model checkpoint available here to run it against. Everything below
    the segment() boundary (projection, voting, pruning) is plain numpy and
    unit-tested; this class is the one piece that needs a real run against a
    real capture before it can be trusted the way the rest of this pipeline's
    "confirmed the hard way" comments mean it.
    """

    checkpoint_path: Path
    model_config: str = "sam2_hiera_l.yaml"
    device: str = "cuda"

    def __post_init__(self) -> None:
        # Lazy import: torch + sam2 are heavy, CUDA-oriented dependencies
        # that the rest of this package (extract/sfm/compress, and every
        # test that doesn't touch segmentation) has no reason to require.
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        sam2_model = build_sam2(self.model_config, str(self.checkpoint_path), device=self.device)
        self._predictor = SAM2ImagePredictor(sam2_model)

    def segment(self, image_path: Path) -> np.ndarray:
        import cv2

        image = cv2.cvtColor(cv2.imread(str(image_path)), cv2.COLOR_BGR2RGB)
        self._predictor.set_image(image)
        height, width = image.shape[:2]
        center = np.array([[width / 2, height / 2]])

        masks, scores, _ = self._predictor.predict(
            point_coords=center, point_labels=np.array([1]), multimask_output=True
        )
        return masks[int(np.argmax(scores))].astype(bool)


def project_points(
    positions: np.ndarray, cam_from_world: np.ndarray, calibration_matrix: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised pinhole projection of world-space points into one camera.

    Ignores lens distortion (pycolmap's per-point Image.project_point()
    applies the camera's real OPENCV distortion model and would be more
    accurate, but calling it once per Gaussian per sampled frame — hundreds
    of thousands of Python-level calls — has runtime that scales with job
    size in a way this pipeline can't budget for). Acceptable here
    specifically because this is a majority vote across many cameras
    feeding a segmentation mask that already has soft, imprecise edges, not
    a measurement anything downstream treats as exact.

    Returns (pixel_xy, in_front_mask) — pixel_xy is only meaningful where
    in_front_mask is True.
    """
    rotation, translation = cam_from_world[:, :3], cam_from_world[:, 3]
    cam_space = positions @ rotation.T + translation
    in_front = cam_space[:, 2] > 0

    pixels_homogeneous = cam_space @ calibration_matrix.T
    with np.errstate(invalid="ignore", divide="ignore"):
        pixel_xy = pixels_homogeneous[:, :2] / pixels_homogeneous[:, 2:3]
    return pixel_xy, in_front


def vote_foreground_mask(
    positions: np.ndarray,
    reconstruction: pycolmap.Reconstruction,
    frames_dir: Path,
    backend: SegmentationBackend,
    sample_frames: int = SEGMENTATION_SAMPLE_FRAMES,
    vote_threshold: float = SEGMENTATION_VOTE_THRESHOLD,
) -> np.ndarray:
    images = sorted(reconstruction.images.values(), key=lambda image: image.name)
    if not images:
        raise PipelineError("cleanup:segment", "reconstruction has no registered images")

    step = max(1, len(images) // sample_frames)
    sampled = images[::step][:sample_frames]

    foreground_votes = np.zeros(len(positions), dtype=np.int32)
    total_votes = np.zeros(len(positions), dtype=np.int32)

    for image in sampled:
        frame_path = frames_dir / image.name
        if not frame_path.is_file():
            logger.warning("cleanup:segment: frame not found, skipping: %s", frame_path)
            continue

        mask = backend.segment(frame_path)
        height, width = mask.shape
        camera = image.camera

        pixel_xy, in_front = project_points(
            positions, image.cam_from_world().matrix(), camera.calibration_matrix()
        )
        x, y = pixel_xy[:, 0], pixel_xy[:, 1]
        in_bounds = in_front & (x >= 0) & (x < width) & (y >= 0) & (y < height)

        visible_idx = np.flatnonzero(in_bounds)
        px = np.clip(x[visible_idx].astype(np.int64), 0, width - 1)
        py = np.clip(y[visible_idx].astype(np.int64), 0, height - 1)

        total_votes[visible_idx] += 1
        foreground_votes[visible_idx] += mask[py, px]

    with np.errstate(invalid="ignore", divide="ignore"):
        vote_ratio = np.divide(foreground_votes, total_votes, out=np.ones(len(positions)), where=total_votes > 0)
    keep = (total_votes == 0) | (vote_ratio >= vote_threshold)
    logger.info(
        "cleanup:segment: %d/%d gaussians kept (%d unseen by any sampled camera, kept by default)",
        int(keep.sum()), len(keep), int((total_votes == 0).sum()),
    )
    return keep


# ---------------------------------------------------------------------------
# Step 2: RANSAC support-surface removal
# ---------------------------------------------------------------------------

RANSAC_ITERATIONS = 1000
# In reconstruction units, not metres — COLMAP/GLOMAP's monocular
# reconstruction has an unknown, un-calibrated global scale (see the scale
# note on compute_alignment_transform below), so this threshold is relative
# to the capture's own point spread rather than a fixed physical distance.
RANSAC_DISTANCE_RATIO = 0.01  # fraction of the point cloud's robust spread
# Percentiles, not true min/max, define that spread — confirmed against a
# real trained PLY, not assumed: MCMC densification strands stray "floater"
# points far from the real geometry throughout training (the same
# phenomenon this project's old floorplan.py bounds computation had to
# work around), and a handful of such points inflated a real capture's raw
# bbox diagonal ~200x over its 5th-95th-percentile spread. Sizing the RANSAC
# distance threshold off the raw bbox made it enormous relative to the
# actual object, which made nearly every point count as a "plane inlier" —
# confirmed the hard way: 49993/50000 gaussians misclassified as surface on
# a real (if under-trained) capture before this fix.
RANSAC_SPREAD_PERCENTILES = (5.0, 95.0)


@dataclass(frozen=True)
class PlaneFit:
    normal: np.ndarray  # unit vector
    point: np.ndarray  # any point on the plane (the centroid of its inliers)
    inlier_mask: np.ndarray


def fit_plane_ransac(
    points: np.ndarray,
    iterations: int = RANSAC_ITERATIONS,
    distance_ratio: float = RANSAC_DISTANCE_RATIO,
    rng: np.random.Generator | None = None,
) -> PlaneFit:
    """Classic 3-point RANSAC: the support surface is the largest flat
    inlier set in the scene — a table or floor fits a plane far better than
    a product's own curved/irregular geometry does, so the best-fitting
    plane's inliers *are* the surface to remove, not the product.
    """
    if len(points) < 3:
        raise PipelineError("cleanup:ransac", f"need at least 3 points to fit a plane, got {len(points)}")

    rng = rng or np.random.default_rng()
    low, high = np.percentile(points, RANSAC_SPREAD_PERCENTILES, axis=0)
    diagonal = float(np.linalg.norm(high - low))
    distance_threshold = diagonal * distance_ratio

    best_inliers: np.ndarray | None = None
    best_count = -1
    for _ in range(iterations):
        sample_idx = rng.choice(len(points), size=3, replace=False)
        p0, p1, p2 = points[sample_idx]
        normal = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(normal)
        if norm < 1e-12:  # degenerate (near-collinear) sample
            continue
        normal = normal / norm

        distances = np.abs((points - p0) @ normal)
        inliers = distances < distance_threshold
        count = int(inliers.sum())
        if count > best_count:
            best_count, best_inliers = count, inliers

    if best_inliers is None or best_count < 3:
        raise PipelineError("cleanup:ransac", "RANSAC found no plane — every sampled triple was degenerate")

    inlier_points = points[best_inliers]
    centroid = inlier_points.mean(axis=0)
    # Refit through all inliers via SVD, rather than keeping the lucky
    # 3-point sample's own plane — the same idea as OpenCV/PCL's RANSAC
    # implementations, which always conclude with a least-squares refit.
    #
    # full_matrices=False is not an optimization here, it's required: this
    # matrix is (num_inliers, 3), and full_matrices=True (numpy's default)
    # computes U at (num_inliers, num_inliers) instead of the (num_inliers,
    # 3) economy form. On real data (340k+ inliers on a real trained splat)
    # that is hundreds of GiB and an immediate MemoryError — invisible in
    # this file's own tests, which only ever used a few hundred synthetic
    # points.
    _, _, vh = np.linalg.svd(inlier_points - centroid, full_matrices=False)
    normal = vh[-1]
    logger.info("cleanup:ransac: %d/%d points on the support surface", best_count, len(points))
    return PlaneFit(normal=normal, point=centroid, inlier_mask=best_inliers)


# Relative to the scene's own scale (the same percentile-spread diagonal
# fit_plane_ransac sizes its distance threshold from), not an absolute
# distance — same reasoning as RANSAC_DISTANCE_RATIO above. Confirmed
# against two real captures, not assumed: a genuine flat support surface's
# inliers sit far closer to the fitted plane, relative to scene scale, than
# RANSAC's forced "best available" fit does when no real surface exists.
# vase.mp4 (a real capture with a real table): median residual ~0.047% of
# the scene diagonal. vase2.mp4 (no real flat surface in frame — RANSAC
# still confidently returned a "winning" plane, and 98.6% of what it
# classified as surface turned out to be the product's own geometry):
# ~0.495%, ~10x looser. Raw inlier count/fraction doesn't discriminate the
# two cases — vase.mp4's genuine table is *also* the majority of all
# gaussians (56.8%) — so this checks fit tightness instead. The threshold
# sits at roughly the geometric mean of those two real measurements, with
# a >3x margin to either side.
RANSAC_MAX_RELATIVE_RESIDUAL = 0.0015


def is_plausible_support_surface(plane: PlaneFit, points: np.ndarray) -> bool:
    """Whether fit_plane_ransac's plane looks like a genuine flat surface,
    rather than just the best (non-flat) compromise available on a capture
    that doesn't have one — see RANSAC_MAX_RELATIVE_RESIDUAL for the real
    data this was confirmed against. Skipping a bad "removal" entirely is
    the safe failure mode: it leaves some background for later steps
    (largest_connected_component, prune_floaters) to catch what they can,
    rather than actively deleting real product geometry.
    """
    low, high = np.percentile(points, RANSAC_SPREAD_PERCENTILES, axis=0)
    diagonal = float(np.linalg.norm(high - low))
    if diagonal <= 0:
        return True
    inlier_points = points[plane.inlier_mask]
    residuals = np.abs((inlier_points - plane.point) @ plane.normal)
    relative_residual = float(np.median(residuals)) / diagonal
    return relative_residual <= RANSAC_MAX_RELATIVE_RESIDUAL


def orient_normal_away_from(plane: PlaneFit, reference_points: np.ndarray) -> np.ndarray:
    """Flips the plane's normal, if needed, so it points from the surface
    toward the product rather than away from it — needed before step 4 can
    align it to canonical "up" and have the product end up above the origin
    rather than below it.
    """
    signed_distance = (reference_points - plane.point) @ plane.normal
    if np.median(signed_distance) < 0:
        return -plane.normal
    return plane.normal


# RANSAC only removes the flat plane itself — a support surface's non-flat
# parts (a table's legs, a stand's base) are real, well-observed geometry,
# neither "the surface" (fit_plane_ransac only claims points near the plane)
# nor "a floater" (prune_floaters targets low-opacity/oddly-scaled/isolated
# noise, and legs are none of those). Confirmed against a real capture, not
# hypothetical: a real cleanup run left a four-legged table intact and
# attached above the product, and — because it wasn't excluded from
# orient_normal_away_from's reference points — biased the up-axis decision
# enough to flip the whole result upside down.
#
# CONNECTIVITY_RADIUS_NN_MULTIPLE tuned against that same real capture: 5x
# the median nearest-neighbour distance cleanly separated one ~77k-point
# component (the product, by shape) from several hundred/thousand-point
# fragments (the table's legs) without yet bridging them back together.
CONNECTIVITY_RADIUS_NN_MULTIPLE = 5.0


def largest_connected_component(positions: np.ndarray) -> np.ndarray:
    """Boolean mask selecting only the largest spatially-connected group of
    points, at a radius derived from this point cloud's own density. Two
    points are "connected" if within that radius of each other (directly,
    or transitively through a chain of other surviving points) — RANSAC's
    plane removal typically leaves a real gap between a product and a
    support structure's remaining (non-planar) parts once their point of
    contact is gone, which is what makes this separation possible at all.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    if len(positions) < 2:
        return np.ones(len(positions), dtype=bool)

    tree = cKDTree(positions)
    nn_distance, _ = tree.query(positions, k=2)
    median_nn_distance = float(np.median(nn_distance[:, 1]))
    radius = median_nn_distance * CONNECTIVITY_RADIUS_NN_MULTIPLE

    pairs = tree.query_pairs(r=radius, output_type="ndarray")
    n = len(positions)
    if len(pairs) == 0:
        graph = coo_matrix((n, n))
    else:
        graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, labels = connected_components(graph, directed=False)

    sizes = np.bincount(labels)
    largest_label = int(np.argmax(sizes))
    keep = labels == largest_label
    logger.info(
        "cleanup:connectivity: %d/%d gaussians in the largest connected component (%d components total)",
        int(keep.sum()), n, len(sizes),
    )
    return keep


# Steps 1-3 decide *where the product is*. This last spatial pass decides
# *how much of what's there to keep*, and it exists because those two
# questions have different right answers.
#
# Confirmed by measurement on real captures, not assumed: ~96% of the
# gaussians prune_floaters removes sit inside the product's own volume, not
# out in the room. They're the low-opacity ones MCMC scatters through the
# object's interior, and while each is individually near-invisible, alpha
# compounds — N layers at opacity a composite toward 1-(1-a)^N — so
# collectively they're most of what makes the surface read as solid rather
# than ghostly. Dropping them is exactly why a cleaned product can look
# see-through next to its own untouched training output.
#
# So the recovery pass is deliberately blind to opacity, scale and density:
# it re-admits every gaussian within DILATION_RADIUS_NN_MULTIPLE nearest-
# neighbour spacings of a surviving product point, whatever its own
# properties. The product renders as it does untouched; the room stays gone.
# On a real capture this took 79,815 gaussians back up to 129,937 (+63%).
#
# Sized from the product's own point spacing rather than an absolute
# distance (same reasoning as RANSAC_DISTANCE_RATIO). 4.0 is the knee of the
# measured curve — recovery plateaus hard past it (8x adds only 1.7% more),
# so a larger radius buys nothing and only risks reaching into the support
# surface. It is a thin shell either way: on that capture 4x was 0.014
# units against a product radius of 0.918, i.e. ~1.5% of the object's size.
DILATION_RADIUS_NN_MULTIPLE = 4.0


def dilate_around_product(
    all_positions: np.ndarray,
    product_mask: np.ndarray,
    radius_nn_multiple: float = DILATION_RADIUS_NN_MULTIPLE,
) -> np.ndarray:
    """Grows product_mask to re-admit nearby gaussians of *any* opacity,
    scale or density — see DILATION_RADIUS_NN_MULTIPLE for why that's the
    point rather than an oversight.

    Draws from the full pre-pruning set, including what RANSAC removed as
    support surface. That's deliberate: a product physically rests on its
    support, so its lowest gaussians are genuine plane inliers that surface
    removal necessarily takes with it, and this is what puts them back. The
    radius is far too small to drag in the surface proper — it only reaches
    the contact ring directly beneath the object.
    """
    product_points = all_positions[product_mask]
    if len(product_points) < 2:
        return product_mask

    tree = cKDTree(product_points)
    nn_distance, _ = tree.query(product_points, k=2)
    radius = float(np.median(nn_distance[:, 1])) * radius_nn_multiple

    distance_to_product, _ = cKDTree(product_points).query(all_positions, k=1)
    dilated = distance_to_product <= radius

    logger.info(
        "cleanup:dilate: %d -> %d gaussians recovered within %.5f of the product "
        "(low-opacity interior detail pruning would otherwise drop)",
        int(product_mask.sum()), int(dilated.sum()), radius,
    )
    return dilated


# Measured, not chosen by eye: rendering a product twice — once against pure
# black, once against pure white — and taking `1 - (white - black)/255` per
# pixel gives its true per-pixel alpha, since an opaque pixel doesn't move
# between the two backgrounds and a fully transparent one moves the whole
# 255. On a real capture that put the supposedly-fixed product at mean alpha
# 0.796 with only 24% of its pixels actually opaque: still visibly
# see-through, which eyeballing screenshots against a dark background had
# completely hidden (a thin pixel over black still *looks* dark and solid).
# apps/viewer/public/measure.html is that harness, kept for re-checking.
#
# Even after dilation recovers every gaussian in the product's volume, the
# accumulated alpha along a ray is 1-(1-a)^N, and both a and N are simply too
# small on an under-observed capture to reach 1. There are no more gaussians
# left to add, so the only remaining lever is a itself.
#
# Sweeping the boost against that harness: +1.0 -> 0.924 mean / 74.5% opaque,
# +2.0 -> 0.947 / 89.2%, +3.0 -> 0.951 / 90.5%. It flattens out after +2.0,
# and the ~10% that never reaches opaque is the silhouette edge, where
# semi-transparency is correct antialiasing rather than a defect.
#
# Expressed as a target median alpha rather than a fixed delta so it
# self-calibrates: a capture whose gaussians are already dense gets a delta
# near zero and is left alone. Solving for this target on that capture
# (median alpha 0.0635) yields +1.98, which is the empirical optimum above —
# the derivation and the measurement agree.
TARGET_MEDIAN_OPACITY = 0.33


def solidify_opacity_delta(
    opacities: np.ndarray, target_median: float = TARGET_MEDIAN_OPACITY
) -> float:
    """The constant to add to stored opacity logits so the product's *median*
    gaussian alpha lands on target_median — see TARGET_MEDIAN_OPACITY.

    Never returns a negative delta: this exists to fix products that render
    too thin, and it must not thin out one that already renders correctly.
    """
    median_alpha = float(np.median(opacities))
    median_alpha = min(max(median_alpha, 1e-6), 1.0 - 1e-6)
    if median_alpha >= target_median:
        logger.info(
            "cleanup:solidify: median gaussian alpha %.4f already at or above the "
            "%.2f target, leaving opacity untouched",
            median_alpha, target_median,
        )
        return 0.0

    current_logit = float(np.log(median_alpha / (1.0 - median_alpha)))
    target_logit = float(np.log(target_median / (1.0 - target_median)))
    delta = target_logit - current_logit
    logger.info(
        "cleanup:solidify: median gaussian alpha %.4f -> %.4f (opacity logit %+.3f)",
        median_alpha, target_median, delta,
    )
    return delta


# ---------------------------------------------------------------------------
# Step 3: floater pruning — opacity, scale, k-NN spatial density
# ---------------------------------------------------------------------------

MIN_OPACITY = 0.05
# Relative to the surviving cloud's own median, not an absolute size — same
# reasoning as extract.py's temporal-relative blur threshold: an absolute
# cutoff can't be portable across products of very different real sizes,
# but "much bigger than the typical gaussian in this capture" is. Measured
# against a gaussian's *largest* axis, not the mean of all three — see
# prune_floaters' own comment for why the mean version missed a real bug.
MAX_SCALE_RATIO = 8.0
KNN_NEIGHBORS = 8
KNN_DENSITY_RATIO = 4.0


def prune_floaters(
    positions: np.ndarray,
    opacities: np.ndarray,
    scales: np.ndarray,
    min_opacity: float = MIN_OPACITY,
    max_scale_ratio: float = MAX_SCALE_RATIO,
    knn_neighbors: int = KNN_NEIGHBORS,
    knn_density_ratio: float = KNN_DENSITY_RATIO,
) -> np.ndarray:
    # Largest single axis, not scales.mean(axis=1) — confirmed against a
    # real cleanup run (vase2.mp4): a splat's visible footprint is set by
    # its largest axis, but a handful of needle-shaped gaussians there (one
    # axis ~0.05, the other two ~0.0002-0.002) had a mean pulled down to
    # ~6.9x the median — just under MAX_SCALE_RATIO — so they survived and
    # rendered as a visible streak. Their largest axis alone was ~9x the
    # median largest-axis, well over the same ratio.
    largest_axis_scale = scales.max(axis=1)
    median_scale = float(np.median(largest_axis_scale))
    scale_ok = largest_axis_scale <= median_scale * max_scale_ratio
    opacity_ok = opacities >= min_opacity

    k = min(knn_neighbors + 1, len(positions))  # +1: a point is its own nearest neighbour
    tree = cKDTree(positions)
    distances, _ = tree.query(positions, k=k)
    knn_distance = distances[:, -1] if k > 1 else np.zeros(len(positions))
    median_knn_distance = float(np.median(knn_distance))
    density_ok = knn_distance <= median_knn_distance * knn_density_ratio if median_knn_distance > 0 else np.ones(len(positions), dtype=bool)

    keep = scale_ok & opacity_ok & density_ok
    logger.info(
        "cleanup:floaters: %d/%d kept (opacity dropped %d, scale dropped %d, density dropped %d)",
        int(keep.sum()), len(keep),
        int((~opacity_ok).sum()), int((~scale_ok).sum()), int((~density_ok).sum()),
    )
    return keep


# ---------------------------------------------------------------------------
# Step 4: recentre, align up-axis, normalise scale
# ---------------------------------------------------------------------------

# NOT metric. A monocular SfM reconstruction has an unknown global scale —
# nothing in this pipeline observes a real-world distance (no known-size
# calibration object, no depth sensor, no IMU) — so "normalise scale to
# real-world metres" (CLAUDE.md) can't be made literally true yet. What this
# *can* do honestly is put every product on the same predictable scale
# (longest bbox dimension -> TARGET_LONGEST_DIMENSION reconstruction-units),
# which is enough for a consistent default camera distance in the viewer.
# True metric scale needs a calibration signal this pipeline doesn't have —
# AR placement (CLAUDE.md's stated reason for wanting metres) is also an
# explicit v1 non-goal, so this isn't blocking anything today.
TARGET_LONGEST_DIMENSION = 1.0
# Percentiles, not true min/max -- confirmed against a real cleaned splat,
# not assumed: even after every prune_floaters/RANSAC pass, a handful of
# gaussians survive far outside the product's real extent (the 1st-99th
# percentile span was 4.05 units against a raw bbox of 46.86 — an 11x
# difference on real data). Sizing the scale off the raw bbox shrank the
# actual vase down to a few sparse specks in the corner of its own frame.
# Same failure shape as RANSAC_SPREAD_PERCENTILES above; kept as a separate
# constant since there's no reason the two steps must agree exactly.
ALIGNMENT_SPREAD_PERCENTILES = (1.0, 99.0)


@dataclass(frozen=True)
class AlignmentTransform:
    translate: np.ndarray  # (3,), apply first
    rotate_euler_xyz_degrees: np.ndarray  # (3,), apply second, about the now-centred origin
    scale: float  # apply third


def principal_axis(positions: np.ndarray) -> np.ndarray:
    """Unit vector along the direction of greatest positional variance —
    sign is arbitrary (SVD has no notion of which end is "up");
    estimate_up_axis resolves that separately.
    """
    centroid = positions.mean(axis=0)
    # full_matrices=False for the same reason as fit_plane_ransac's own SVD:
    # this is (N, 3) with N in the tens of thousands on a real capture, and
    # the default full_matrices=True computes a (N, N) U this never uses.
    _, _, vh = np.linalg.svd(positions - centroid, full_matrices=False)
    return vh[0]


def camera_trajectory_up_hint(reconstruction: pycolmap.Reconstruction, tail_fraction: float = 0.15) -> np.ndarray:
    """A fallback "which way is up" signal from camera poses alone, not
    point-cloud geometry — for estimate_up_axis's sign, when the RANSAC
    plane isn't trustworthy enough to resolve it from (see
    is_plausible_support_surface). CLAUDE.md's capture protocol always
    finishes with one top-down pass, so the last portion of frames, sorted
    by capture order, are the cameras positioned above the product — the
    displacement from the rest of the (roughly constant-height orbit)
    cameras to that tail is a coarse but genuinely independent "up" signal,
    since it never touches the trained splat's own (possibly-misleading)
    geometry at all.

    Confirmed against two real captures, not assumed: at this tail_fraction,
    the resulting direction agreed in sign with each capture's own
    known-correct up axis (vase.mp4: dot=+0.67; vase2.mp4, checked against
    the manually-verified correct orientation once the RANSAC-plane sign
    bug below was found: dot=+1.96). A 5% tail was unreliable — wrong sign
    on vase.mp4's own 99-frame capture, too few frames to average out
    per-camera noise; 15% was correct and reasonably confident on both.
    """
    images = sorted(reconstruction.images.values(), key=lambda image: image.name)
    centers = np.array([image.projection_center() for image in images])
    tail_count = max(1, int(len(images) * tail_fraction))
    return centers[-tail_count:].mean(axis=0) - centers[:-tail_count].mean(axis=0)


def estimate_up_axis(
    plane: PlaneFit,
    product_points: np.ndarray,
    fallback_sign_hint: np.ndarray | None = None,
) -> np.ndarray:
    """The "up" direction step 4 aligns to canonical +Y — the product's own
    PCA principal axis, not the RANSAC plane's normal directly.

    Confirmed against two real captures, not assumed: when RANSAC finds a
    genuine flat support surface, its normal and the product's own PCA axis
    agree closely (32.6 vs 33.2 degrees off the reconstruction's raw Y axis,
    on vase.mp4's capture). When it doesn't — vase2.mp4 produced a real
    cleanup run where the best-fitting "plane" RANSAC could find was a poor,
    non-flat compromise (~10x worse inlier residual relative to scene scale
    than vase.mp4's) — its normal ended up 83 degrees off vertical and
    rotated the whole product onto its side once applied. Sweeping
    RANSAC_DISTANCE_RATIO up and down on that same capture never brought it
    much under 68 degrees, so this isn't a threshold-tuning problem: for
    that capture there just isn't a clean horizontal surface for RANSAC to
    find, at any threshold. The product's own PCA axis, in contrast, was
    still accurate (32.4 degrees) — CLAUDE.md's capture protocol (3-4 orbits
    around a single centred product, plus a top-down pass) makes the product
    the most vertically-elongated mass in its own isolated point cloud close
    to by construction, which "there happens to be a flat surface in frame"
    never guaranteed.

    Sign is a separate story from the axis, and RANSAC's plane is NOT
    automatically trustworthy for it either, despite this function's own
    earlier assumption that it would be: confirmed wrong on vase2.mp4, where
    plane.point (the "surface" inlier centroid) landed just 0.11 units from
    the product's own centroid — well inside its p95 radius of 1.50, i.e.
    plane.point was near the *middle* of the product, not below it — making
    orient_normal_away_from's "which side of plane.point is the product on"
    judgement a near-coin-flip that, on that capture, landed wrong (caught
    by cross-checking against camera_trajectory_up_hint). Callers pass
    fallback_sign_hint (that function's output) whenever
    is_plausible_support_surface rejected the plane; when it's None, this
    still uses the plane directly, unchanged from the vase.mp4-validated
    behaviour for the (far more common) case where the plane is trustworthy.
    """
    axis = principal_axis(product_points)
    sign_reference = (
        fallback_sign_hint if fallback_sign_hint is not None else orient_normal_away_from(plane, product_points)
    )
    if axis @ sign_reference < 0:
        axis = -axis

    agreement_degrees = float(np.degrees(np.arccos(np.clip(abs(axis @ plane.normal), 0.0, 1.0))))
    logger.info(
        "cleanup:orientation: PCA axis vs RANSAC plane normal disagree by %.1f degrees "
        "(large means no reliable flat surface was found; PCA axis wins either way); "
        "sign source: %s",
        agreement_degrees, "camera trajectory" if fallback_sign_hint is not None else "RANSAC plane",
    )
    return axis


def compute_alignment_transform(positions: np.ndarray, up_normal: np.ndarray) -> AlignmentTransform:
    """The geometric transform in plain terms: translate, then rotate about
    the now-centred origin, then uniformly scale, all using ordinary
    right-handed math against the positions as this pipeline sees them
    (i.e. `Rotation.from_euler("xyz", ...).apply(positions + translate) *
    scale`). apply_alignment_transform() is responsible for converting this
    into whatever arguments actually make splat-transform produce that
    result — this function stays independent of that tool's own quirks.
    """
    # Median, not mean: a mean is pulled toward a handful of far-away
    # floaters in proportion to how far away they are (unbounded), whereas
    # a per-axis median only cares how many there are — negligible against
    # 100k+ real product points either way, but median is the same
    # discipline as the percentile-based scale below and costs nothing extra.
    centroid = np.median(positions, axis=0)
    centred = positions - centroid

    # Rotation.align_vectors gives the minimal rotation taking up_normal to
    # canonical +Y; converting that to Euler angles (rather than passing a
    # quaternion or matrix straight through) is what apply_alignment_transform
    # ultimately needs to hand to splat-transform's -r flag.
    rotation, _ = Rotation.align_vectors([[0.0, 1.0, 0.0]], [up_normal])
    rotate_euler_xyz_degrees = rotation.as_euler("xyz", degrees=True)

    rotated = rotation.apply(centred)
    low, high = np.percentile(rotated, ALIGNMENT_SPREAD_PERCENTILES, axis=0)
    longest_dimension = float((high - low).max())
    scale = TARGET_LONGEST_DIMENSION / longest_dimension if longest_dimension > 0 else 1.0

    return AlignmentTransform(translate=-centroid, rotate_euler_xyz_degrees=rotate_euler_xyz_degrees, scale=scale)


# splat-transform's -t/-r arguments are NOT plain right-handed math applied
# to the PLY's stored (x, y, z) — verified empirically (round-tripped known
# points through the real CLI and compared against plain numpy/scipy), not
# assumed: every -t/-r call behaves as though x and y are negated on the way
# in and negated again on the way out (equivalently: conjugated by a 180°
# rotation about Z), while z and uniform -s scale are unaffected. This
# matches CLAUDE.md's rule about never hand-rolling Gaussian rotation math —
# what's hand-rolled here is only the CLI-argument conversion, confirmed
# against the real tool in test_cleanup.py's
# test_apply_alignment_transform_matches_intended_geometry; the actual
# per-Gaussian SH/quaternion rotation is still entirely splat-transform's.
_XY_MIRROR = np.array([-1.0, -1.0, 1.0])


def apply_alignment_transform(ply_path: Path, transform: AlignmentTransform, out_path: Path) -> None:
    tx, ty, tz = transform.translate * _XY_MIRROR
    rx, ry, rz = transform.rotate_euler_xyz_degrees * _XY_MIRROR
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run_command(
        "cleanup:align",
        [
            # splat-transform's syntax is `[GLOBAL] input [ACTIONS] output` —
            # actions apply to whatever file precedes them, so -t/-r/-s must
            # come after ply_path, not before it (see compress.py's original
            # convert_to_sog, which got this right; this function initially
            # didn't).
            "splat-transform", "-w", str(ply_path),
            "-t", f"{tx},{ty},{tz}",
            "-r", f"{rx},{ry},{rz}",
            "-s", str(transform.scale),
            str(out_path),
        ],
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def find_trained_ply(out_dir: Path) -> Path:
    candidates = sorted(out_dir.rglob("*.ply"))
    if not candidates:
        raise PipelineError("cleanup", f"no .ply file found under {out_dir}")
    if len(candidates) == 1:
        return candidates[0]
    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    logger.warning("multiple .ply files found under %s, using most recently modified: %s", out_dir, newest)
    return newest


def run_cleanup(workdir: Path, segmentation_backend: SegmentationBackend | None = None) -> Path:
    frames_dir = workdir / "frames"
    sparse_dir = workdir / "sparse" / "0"
    out_dir = workdir / "out"
    cleaned_path = workdir / "cleaned.ply"

    if not sparse_dir.is_dir():
        raise PipelineError("cleanup", f"sparse model not found: {sparse_dir} — run `sfm` first")
    trained_ply_path = find_trained_ply(out_dir)
    # Always loaded, not just when segmentation_backend is set: cheap (reads
    # the already-computed sparse model, no GPU/heavy compute) and also
    # needed for camera_trajectory_up_hint's fallback below.
    reconstruction = pycolmap.Reconstruction(str(sparse_dir))

    ply, positions = load_ply_positions(trained_ply_path)
    opacities = load_ply_opacity(ply)
    scales = load_ply_scale(ply)

    if segmentation_backend is not None:
        segmented_keep = vote_foreground_mask(positions, reconstruction, frames_dir, segmentation_backend)
    else:
        logger.warning("cleanup: no segmentation backend configured, skipping background pruning")
        segmented_keep = np.ones(len(positions), dtype=bool)

    plane = fit_plane_ransac(positions[segmented_keep])
    plane_is_plausible = is_plausible_support_surface(plane, positions[segmented_keep])
    # inlier_mask was computed against the segmented subset's own indices;
    # project it back onto the full-length array so every mask this function
    # combines is the same length and directly comparable.
    surface_keep = np.ones(len(positions), dtype=bool)
    if plane_is_plausible:
        surface_keep[np.flatnonzero(segmented_keep)[plane.inlier_mask]] = False
    else:
        # Confirmed against a real capture (vase2.mp4): forcing RANSAC's
        # best-available-but-not-actually-flat plane through as "the
        # surface" deleted ~60% of the product's own gaussians — 98.6% of
        # what it removed was within the final product's own bounding
        # volume, not a real background surface. Skipping removal entirely
        # is the safe fallback; largest_connected_component and
        # prune_floaters still get a chance at whatever background remains.
        logger.warning(
            "cleanup:ransac: best-fit plane doesn't look like a genuine flat surface "
            "(relative residual too high) — skipping surface removal rather than risk "
            "deleting real product geometry"
        )
    keep = segmented_keep & surface_keep

    # Isolate the product from whatever non-planar support-structure debris
    # (table legs, a stand's base) survived plane removal *before* deciding
    # which way is up — orient_normal_away_from's answer is only as good as
    # its reference points, and a support structure's mass can otherwise
    # outweigh the product's and flip the decision (see
    # largest_connected_component's docstring).
    connected_keep = np.ones(len(positions), dtype=bool)
    connected_keep[np.flatnonzero(keep)] = largest_connected_component(positions[keep])
    keep &= connected_keep

    floater_keep = np.ones(len(positions), dtype=bool)
    floater_keep[np.flatnonzero(keep)] = prune_floaters(positions[keep], opacities[keep], scales[keep])
    keep &= floater_keep

    if keep.sum() < 3:
        raise PipelineError(
            "cleanup",
            f"only {int(keep.sum())} gaussians survived segmentation/plane/floater pruning — "
            "cleanup was too aggressive, or the trained splat itself was mostly noise",
        )

    # Orientation and scale are computed from the *tight* mask, before
    # dilation: PCA wants the product's own well-localised geometry, not the
    # low-opacity halo around it, and this keeps both decisions identical to
    # the behaviour already verified against real captures.
    #
    # See estimate_up_axis's docstring for why the PCA axis, not
    # plane.normal, is what step 4 aligns to +Y — and why a plane that
    # wasn't trustworthy enough to remove as a surface isn't trustworthy for
    # sign either, so the camera trajectory resolves that instead.
    fallback_sign_hint = None if plane_is_plausible else camera_trajectory_up_hint(reconstruction)
    up_normal = estimate_up_axis(plane, positions[keep], fallback_sign_hint)
    transform = compute_alignment_transform(positions[keep], up_normal)

    # Only now widen the mask, to put back the interior detail that carries
    # the product's apparent solidity (see DILATION_RADIUS_NN_MULTIPLE).
    keep = dilate_around_product(positions, keep)

    # Dilation puts back every gaussian there is to put back; this covers the
    # gap that remains when even all of them don't accumulate to an opaque
    # surface (see TARGET_MEDIAN_OPACITY). Derived from the final surviving
    # set, so it responds to this product's own density rather than a guess.
    opacity_delta = solidify_opacity_delta(opacities[keep])

    pruned_path = workdir / "pruned.ply"
    write_ply_subset(ply, keep, pruned_path, opacity_logit_delta=opacity_delta)
    logger.info("cleanup: %d/%d gaussians survived pruning", int(keep.sum()), len(keep))
    apply_alignment_transform(pruned_path, transform, cleaned_path)
    logger.info(
        "cleanup: recentred, aligned, scaled by %.4f -> %s",
        transform.scale, cleaned_path,
    )
    return cleaned_path
