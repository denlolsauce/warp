import shutil
from pathlib import Path

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from colmap_fixtures import build_synthetic_reconstruction
from ply_fixtures import write_gaussian_ply_at_positions
from splat_pipeline.cleanup import (
    AlignmentTransform,
    PlaneFit,
    apply_alignment_transform,
    camera_trajectory_up_hint,
    compute_alignment_transform,
    dilate_around_product,
    solidify_opacity_delta,
    estimate_up_axis,
    fit_plane_ransac,
    is_plausible_support_surface,
    largest_connected_component,
    orient_normal_away_from,
    principal_axis,
    project_points,
    prune_floaters,
    vote_foreground_mask,
)
from splat_pipeline.errors import PipelineError
from splat_pipeline.plysplit import load_ply_positions

HAS_SPLAT_TRANSFORM = shutil.which("splat-transform") is not None


# ---------------------------------------------------------------------------
# fit_plane_ransac
# ---------------------------------------------------------------------------


def test_fit_plane_ransac_recovers_a_clean_axis_aligned_plane():
    rng = np.random.default_rng(0)
    # A y=0 "table" plus an off-plane "product" cluster well above it.
    surface = np.column_stack([rng.uniform(-5, 5, 200), np.zeros(200), rng.uniform(-5, 5, 200)])
    product = rng.normal([0, 2, 0], 0.3, size=(50, 3))
    points = np.vstack([surface, product])

    plane = fit_plane_ransac(points, iterations=500, rng=np.random.default_rng(1))

    # Normal is +-Y (a plane's normal has no inherent sign) and inliers are
    # exactly the surface points, not the product cluster.
    assert abs(abs(plane.normal[1]) - 1.0) < 1e-6
    assert plane.inlier_mask[:200].all()
    assert not plane.inlier_mask[200:].any()


def test_fit_plane_ransac_tolerates_noise_within_threshold():
    rng = np.random.default_rng(2)
    surface = np.column_stack([rng.uniform(-5, 5, 300), rng.normal(0, 0.02, 300), rng.uniform(-5, 5, 300)])

    plane = fit_plane_ransac(surface, iterations=500, rng=np.random.default_rng(3))

    assert plane.inlier_mask.sum() > 280  # nearly everything is within the noise band


def test_fit_plane_ransac_raises_with_fewer_than_three_points():
    with pytest.raises(PipelineError) as excinfo:
        fit_plane_ransac(np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]))
    assert excinfo.value.stage == "cleanup:ransac"


def test_fit_plane_ransac_handles_a_large_inlier_set_without_exhausting_memory():
    # Regression test: the SVD refit's full_matrices defaulted to True,
    # which for an (N, 3) matrix computes U at (N, N) instead of (N, 3).
    # At N in the hundreds this is invisible; at real scale (found against
    # an actual trained splat: 340k+ plane inliers out of 600k gaussians)
    # it was an 865 GiB allocation. 40k inliers alone would already be a
    # 12.8 GiB full U if this regresses -- enough to fail loudly on most
    # CI/dev machines without needing real production-scale data here.
    rng = np.random.default_rng(10)
    surface = np.column_stack([rng.uniform(-5, 5, 40_000), np.zeros(40_000), rng.uniform(-5, 5, 40_000)])

    plane = fit_plane_ransac(surface, iterations=50, rng=np.random.default_rng(11))

    assert plane.inlier_mask.sum() > 39_000


def test_fit_plane_ransac_is_not_fooled_by_a_few_extreme_floaters():
    # MCMC densification strands stray points far from the real geometry
    # throughout training (see RANSAC_SPREAD_PERCENTILES's comment) — a
    # handful of them must not blow up the true min/max bbox enough to make
    # the distance threshold so loose that everything looks like "the
    # plane". Reproduces the failure mode found against a real trained PLY:
    # before this was fixed, a few floaters like these made 49993/50000
    # real gaussians register as plane inliers.
    rng = np.random.default_rng(8)
    surface = np.column_stack([rng.uniform(-2, 2, 300), np.zeros(300), rng.uniform(-2, 2, 300)])
    product = rng.normal([0, 1, 0], 0.3, size=(100, 3))
    floaters = np.array([[500.0, 500.0, 500.0], [-600.0, 200.0, -300.0], [100.0, -800.0, 400.0]])
    points = np.vstack([surface, product, floaters])

    plane = fit_plane_ransac(points, iterations=500, rng=np.random.default_rng(9))

    # The surface (not the product, and not dragged into ambiguity by the
    # floaters) should still be exactly what's identified as the plane.
    assert plane.inlier_mask[:300].all()
    assert not plane.inlier_mask[300:400].any()
    assert not plane.inlier_mask[400:].any()  # the floaters themselves aren't "inliers" of anything


# ---------------------------------------------------------------------------
# solidify_opacity_delta
# ---------------------------------------------------------------------------


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def test_solidify_opacity_delta_lands_the_median_on_the_target():
    # Regression test for a product that still measured see-through after
    # every masking fix: mean rendered alpha 0.796, only 24% of its pixels
    # actually opaque (measured black-vs-white, see TARGET_MEDIAN_OPACITY).
    rng = np.random.default_rng(60)
    opacities = sigmoid(rng.normal(-2.7, 0.6, size=5000))

    delta = solidify_opacity_delta(opacities, target_median=0.33)

    boosted = sigmoid(np.log(opacities / (1 - opacities)) + delta)
    assert np.isclose(np.median(boosted), 0.33, atol=0.01)


def test_solidify_opacity_delta_reproduces_the_measured_optimum():
    # The real capture's median gaussian alpha was 0.0635, and sweeping the
    # boost against the render harness found +2.0 to be the knee. The
    # derivation has to land there on its own, or the target is just a
    # magic number wearing a formula.
    delta = solidify_opacity_delta(np.array([0.0635]), target_median=0.33)
    assert 1.9 < delta < 2.1


def test_solidify_opacity_delta_leaves_an_already_dense_product_alone():
    # Must never thin out a product that already renders solid.
    rng = np.random.default_rng(61)
    opacities = sigmoid(rng.normal(1.5, 0.3, size=2000))  # median alpha ~0.82

    assert solidify_opacity_delta(opacities, target_median=0.33) == 0.0


def test_solidify_opacity_delta_survives_degenerate_opacities():
    # Exactly 0 and exactly 1 would be -inf/+inf in logit space.
    assert solidify_opacity_delta(np.array([0.0, 0.0])) > 0
    assert solidify_opacity_delta(np.array([1.0, 1.0])) == 0.0


# ---------------------------------------------------------------------------
# dilate_around_product
# ---------------------------------------------------------------------------


def test_dilate_around_product_recovers_low_opacity_interior_detail():
    # Regression test for the real complaint that a cleaned product looked
    # see-through next to its own untouched training output. Measured cause:
    # ~96% of what prune_floaters removes sits inside the product's own
    # volume — low-opacity gaussians whose alpha compounds into the solid
    # surface — so pruning them by opacity is what hollows the product out.
    rng = np.random.default_rng(50)
    surface_shell = rng.uniform(-0.3, 0.3, size=(2000, 3))
    # Interior detail occupying the same volume, which an opacity/density
    # filter would have dropped; dilation must take it back regardless.
    interior = rng.uniform(-0.28, 0.28, size=(1500, 3))
    room = rng.uniform([5.0, 5.0, 5.0], [7.0, 7.0, 7.0], size=(800, 3))
    positions = np.vstack([surface_shell, interior, room])

    product_mask = np.zeros(len(positions), dtype=bool)
    product_mask[:2000] = True  # only the shell survived pruning

    dilated = dilate_around_product(positions, product_mask)

    assert dilated[:2000].all()  # nothing already kept is lost
    assert dilated[2000:3500].mean() > 0.9  # interior detail comes back
    assert not dilated[3500:].any()  # the room stays gone


def test_dilate_around_product_leaves_a_distant_support_surface_out():
    # The radius is sized off the product's own point spacing precisely so
    # it can reach the contact ring under an object without dragging in the
    # support surface proper.
    rng = np.random.default_rng(51)
    product = rng.uniform([-0.3, 1.0, -0.3], [0.3, 2.0, 0.3], size=(2000, 3))
    tabletop = np.column_stack([
        rng.uniform(-6, 6, 3000), np.full(3000, 0.0), rng.uniform(-6, 6, 3000)
    ])
    positions = np.vstack([product, tabletop])

    product_mask = np.zeros(len(positions), dtype=bool)
    product_mask[:2000] = True

    dilated = dilate_around_product(positions, product_mask)

    assert dilated[:2000].all()
    # A thin contact ring may legitimately return; the tabletop must not.
    assert dilated[2000:].mean() < 0.02


def test_dilate_around_product_handles_a_degenerate_mask():
    positions = np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]])
    product_mask = np.array([True, False])

    assert dilate_around_product(positions, product_mask).tolist() == [True, False]


# ---------------------------------------------------------------------------
# is_plausible_support_surface
# ---------------------------------------------------------------------------


def test_is_plausible_support_surface_accepts_a_genuine_clean_plane():
    rng = np.random.default_rng(30)
    surface = np.column_stack([rng.uniform(-5, 5, 300), rng.normal(0, 0.001, 300), rng.uniform(-5, 5, 300)])
    product = rng.normal([0, 2, 0], 0.3, size=(100, 3))
    points = np.vstack([surface, product])

    plane = fit_plane_ransac(points, iterations=500, rng=np.random.default_rng(31))

    assert is_plausible_support_surface(plane, points)


def test_is_plausible_support_surface_rejects_a_loose_fit_with_no_real_surface():
    # Regression test: reproduces the real cleanup bug found on vase2.mp4,
    # where no genuine flat support surface existed in the capture but
    # fit_plane_ransac still confidently returned *a* "winning" plane —
    # 98.6% of what it classified as surface turned out to be the
    # product's own geometry, and removing it deleted ~60% of the vase.
    # Simulated here as a "surface" candidate spread loosely relative to
    # the scene's own scale — RANSAC still finds *a* best-fitting plane
    # through it, it's just not a real flat surface.
    rng = np.random.default_rng(32)
    loose = np.column_stack([rng.uniform(-5, 5, 300), rng.normal(0, 0.3, 300), rng.uniform(-5, 5, 300)])
    product = rng.normal([0, 2, 0], 0.3, size=(100, 3))
    points = np.vstack([loose, product])

    plane = fit_plane_ransac(points, iterations=500, rng=np.random.default_rng(33))

    assert not is_plausible_support_surface(plane, points)


# ---------------------------------------------------------------------------
# largest_connected_component
# ---------------------------------------------------------------------------


def test_largest_connected_component_isolates_product_from_separate_debris():
    # Reproduces the real failure this function was added for: a dense
    # product cluster plus a smaller, spatially separate cluster (a support
    # structure's legs, surviving because RANSAC only removes the flat
    # plane itself) — the debris cluster is internally as dense as the
    # product, so density-based floater pruning alone wouldn't catch it.
    # Uniform, not normal: a real trained splat's surviving points are
    # fairly uniformly dense across the object's surface, not thinned out
    # toward the edges the way a Gaussian-distributed blob would be — a
    # normal distribution's own sparse tails were enough to fragment a
    # single real cluster in an earlier version of this test.
    rng = np.random.default_rng(14)
    product = rng.uniform(-0.3, 0.3, size=(2000, 3))
    debris = rng.uniform([4.7, 4.7, 4.7], [5.3, 5.3, 5.3], size=(300, 3))  # far away, its own cluster
    positions = np.vstack([product, debris])

    keep = largest_connected_component(positions)

    assert keep[:2000].all()
    assert not keep[2000:].any()


def test_largest_connected_component_keeps_a_single_cluster_intact():
    rng = np.random.default_rng(15)
    positions = rng.uniform(-0.3, 0.3, size=(500, 3))

    keep = largest_connected_component(positions)

    assert keep.all()


def test_largest_connected_component_handles_trivial_input():
    assert largest_connected_component(np.zeros((0, 3))).shape == (0,)
    assert largest_connected_component(np.array([[1.0, 2.0, 3.0]])).tolist() == [True]


# ---------------------------------------------------------------------------
# orient_normal_away_from
# ---------------------------------------------------------------------------


def test_orient_normal_away_from_flips_when_reference_is_on_the_negative_side():
    plane = PlaneFit(normal=np.array([0.0, -1.0, 0.0]), point=np.array([0.0, 0.0, 0.0]), inlier_mask=np.array([True]))
    reference = np.array([[0.0, 3.0, 0.0], [0.0, 2.0, 0.0]])  # above the plane, +Y side

    oriented = orient_normal_away_from(plane, reference)

    assert np.allclose(oriented, [0.0, 1.0, 0.0])


def test_orient_normal_away_from_leaves_correctly_oriented_normal_untouched():
    plane = PlaneFit(normal=np.array([0.0, 1.0, 0.0]), point=np.array([0.0, 0.0, 0.0]), inlier_mask=np.array([True]))
    reference = np.array([[0.0, 3.0, 0.0], [0.0, 2.0, 0.0]])

    oriented = orient_normal_away_from(plane, reference)

    assert np.allclose(oriented, [0.0, 1.0, 0.0])


# ---------------------------------------------------------------------------
# prune_floaters
# ---------------------------------------------------------------------------


def test_prune_floaters_keeps_the_dense_cluster_and_drops_isolated_points():
    rng = np.random.default_rng(4)
    cluster = rng.normal([0, 0, 0], 0.1, size=(200, 3))
    isolated = np.array([[50.0, 50.0, 50.0], [-60.0, 0.0, 0.0]])  # far from anything
    positions = np.vstack([cluster, isolated])
    opacities = np.full(len(positions), 0.5)
    scales = np.full((len(positions), 3), 0.05)

    keep = prune_floaters(positions, opacities, scales)

    assert keep[:200].all()
    assert not keep[200:].any()


def test_prune_floaters_drops_low_opacity_points():
    rng = np.random.default_rng(5)
    positions = rng.normal([0, 0, 0], 0.1, size=(100, 3))
    opacities = np.full(100, 0.5)
    opacities[:10] = 0.01  # below MIN_OPACITY
    scales = np.full((100, 3), 0.05)

    keep = prune_floaters(positions, opacities, scales)

    assert not keep[:10].any()
    assert keep[10:].all()


def test_prune_floaters_drops_abnormally_large_gaussians():
    rng = np.random.default_rng(6)
    positions = rng.normal([0, 0, 0], 0.1, size=(100, 3))
    opacities = np.full(100, 0.5)
    scales = np.full((100, 3), 0.05)
    scales[:5] = 5.0  # far above MAX_SCALE_RATIO x the median

    keep = prune_floaters(positions, opacities, scales)

    assert not keep[:5].any()
    assert keep[5:].all()


def test_prune_floaters_drops_needle_shaped_gaussians_the_mean_would_hide():
    # Regression test: reproduces a real cleanup bug found on vase2.mp4,
    # where a cluster of extremely anisotropic ("needle") gaussians (one
    # axis far larger than the other two) survived pruning and rendered as
    # a visible streak. scales.mean(axis=1) diluted the huge axis enough to
    # land under MAX_SCALE_RATIO even though the gaussian's actual visible
    # footprint — its largest axis — was ~9x the median.
    rng = np.random.default_rng(24)
    positions = rng.normal([0, 0, 0], 0.1, size=(100, 3))
    opacities = np.full(100, 0.5)
    scales = np.full((100, 3), 0.01)
    scales[:5] = [0.09, 0.0002, 0.0003]  # mean ~0.03 (under 8x median); max axis ~9x median

    keep = prune_floaters(positions, opacities, scales)

    assert not keep[:5].any()
    assert keep[5:].all()


# ---------------------------------------------------------------------------
# project_points
# ---------------------------------------------------------------------------


def test_project_points_matches_hand_computed_pinhole_projection():
    # Identity rotation, camera at world origin, simple pinhole with
    # fx=fy=100, principal point (50, 50).
    cam_from_world = np.hstack([np.eye(3), np.zeros((3, 1))])
    k = np.array([[100.0, 0.0, 50.0], [0.0, 100.0, 50.0], [0.0, 0.0, 1.0]])
    # A point straight ahead at z=2, offset (0.5, 0) in camera space should
    # land at pixel (50 + 100*0.5/2, 50) = (75, 50).
    positions = np.array([[0.5, 0.0, 2.0], [0.0, 0.0, -1.0]])  # second point is behind the camera

    pixel_xy, in_front = project_points(positions, cam_from_world, k)

    assert in_front.tolist() == [True, False]
    assert np.allclose(pixel_xy[0], [75.0, 50.0])


# ---------------------------------------------------------------------------
# vote_foreground_mask (against a real, synthetic pycolmap.Reconstruction)
# ---------------------------------------------------------------------------


class FakeBackend:
    """Returns a fixed all-foreground or all-background mask regardless of
    the image, for isolating the voting/projection logic from segmentation
    itself (see cleanup.py's Sam2SegmentationBackend docstring for why the
    real backend isn't exercised here)."""

    def __init__(self, foreground: bool, shape=(100, 100)):
        self.mask = np.full(shape, foreground, dtype=bool)

    def segment(self, image_path: Path) -> np.ndarray:
        return self.mask


def test_vote_foreground_mask_keeps_points_seen_as_foreground(tmp_path: Path):
    images = [(1, "00001.jpg", (0.0, 0.0, -5.0)), (2, "00002.jpg", (0.0, 0.0, -6.0))]
    reconstruction = build_synthetic_reconstruction(images)
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    (frames_dir / "00001.jpg").touch()
    (frames_dir / "00002.jpg").touch()

    # Camera centres at z=-5/-6 looking toward +Z (identity rotation), so a
    # point at the origin is well in front of and centred in both cameras.
    positions = np.array([[0.0, 0.0, 0.0]])

    keep = vote_foreground_mask(positions, reconstruction, frames_dir, FakeBackend(foreground=True))
    assert keep.tolist() == [True]

    keep = vote_foreground_mask(positions, reconstruction, frames_dir, FakeBackend(foreground=False))
    assert keep.tolist() == [False]


def test_vote_foreground_mask_keeps_points_no_camera_can_see(tmp_path: Path):
    images = [(1, "00001.jpg", (0.0, 0.0, -5.0))]
    reconstruction = build_synthetic_reconstruction(images)
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    (frames_dir / "00001.jpg").touch()

    # Far behind the camera (negative camera-space z), so in_front is False
    # and no vote is cast at all.
    positions = np.array([[10_000.0, 0.0, -100_000.0]])

    keep = vote_foreground_mask(positions, reconstruction, frames_dir, FakeBackend(foreground=False))

    assert keep.tolist() == [True]  # "no evidence it's background" defaults to keep


def test_vote_foreground_mask_skips_missing_frame_files(tmp_path: Path):
    images = [(1, "00001.jpg", (0.0, 0.0, -5.0))]
    reconstruction = build_synthetic_reconstruction(images)
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    # Deliberately no 00001.jpg on disk.

    positions = np.array([[0.0, 0.0, 0.0]])
    keep = vote_foreground_mask(positions, reconstruction, frames_dir, FakeBackend(foreground=False))

    assert keep.tolist() == [True]  # camera skipped entirely, so still "no evidence"


# ---------------------------------------------------------------------------
# principal_axis / estimate_up_axis
# ---------------------------------------------------------------------------


def test_principal_axis_recovers_the_long_axis_of_an_elongated_cluster():
    rng = np.random.default_rng(23)
    # Elongated along a non-axis-aligned direction, so this isn't trivially
    # satisfied by accidentally reading off the wrong column.
    direction = np.array([1.0, 2.0, -2.0])
    direction /= np.linalg.norm(direction)
    lengths = rng.uniform(-3.0, 3.0, size=2000)
    spread = rng.normal(0, 0.05, size=(2000, 3))
    positions = lengths[:, None] * direction[None, :] + spread

    axis = principal_axis(positions)

    assert abs(axis @ direction) > 0.99  # parallel, either sign


def test_estimate_up_axis_prefers_product_pca_over_an_unreliable_ransac_normal():
    # Regression test: reproduces the real cleanup failure found on
    # vase2.mp4, where no genuine flat support surface existed in the
    # capture and RANSAC's best-fitting "plane" had a normal ~83 degrees off
    # vertical — using it directly for orientation tipped the whole product
    # onto its side once splat-transform applied the resulting rotation.
    # Sweeping RANSAC_DISTANCE_RATIO up and down on that same real capture
    # never brought the angle much under 68 degrees, confirming this needs a
    # different signal, not a threshold tweak.
    rng = np.random.default_rng(21)
    # Product is clearly elongated along +Y, like a real vase: narrow
    # footprint (x, z), tall in y, centred above the ground plane at y=0.
    product = rng.uniform([-0.5, 2.0, -0.5], [0.5, 8.0, 0.5], size=(2000, 3))

    # A plane RANSAC found nearby, almost perpendicular to the product's own
    # true (Y) axis — the vase2.mp4 failure shape, not a contrived extreme.
    bad_normal = np.array([0.6, 0.1, 0.8])
    bad_normal /= np.linalg.norm(bad_normal)
    plane = PlaneFit(normal=bad_normal, point=np.array([0.0, 0.0, 0.0]), inlier_mask=np.array([True]))

    up = estimate_up_axis(plane, product)

    # Tracks the product's real long axis, not the unreliable plane normal
    # (whose own Y component is only ~0.1 — using it directly would fail
    # this same assertion).
    assert abs(up[1]) > 0.9
    # Correctly signed: the product sits above y=0, so "up" must point
    # toward +Y.
    assert up[1] > 0


def test_estimate_up_axis_matches_ransac_when_they_agree():
    # Sanity/regression-safety net for the common case, where RANSAC found
    # a genuine flat surface and its normal already agrees with the
    # product's own PCA axis — the fix for the unreliable case shouldn't
    # perturb this one.
    rng = np.random.default_rng(22)
    product = rng.uniform([-0.5, 2.0, -0.5], [0.5, 8.0, 0.5], size=(2000, 3))
    plane = PlaneFit(normal=np.array([0.0, -1.0, 0.0]), point=np.array([0.0, 0.0, 0.0]), inlier_mask=np.array([True]))

    up = estimate_up_axis(plane, product)

    assert np.allclose(up, [0.0, 1.0, 0.0], atol=0.05)


def test_estimate_up_axis_uses_fallback_sign_hint_when_given():
    # Regression test: reproduces a second real bug found on vase2.mp4,
    # downstream of the first fix. Once RANSAC's plane was correctly
    # rejected as unreliable (is_plausible_support_surface), it was *still*
    # being used for sign via orient_normal_away_from — but plane.point
    # landed just 0.11 units from the product's own centroid (well inside
    # its p95 radius of 1.50), so "which side of plane.point is the
    # product on" was a near-coin-flip that came up wrong, rendering the
    # vase upside down despite the axis itself being correct.
    rng = np.random.default_rng(25)
    product = rng.uniform([-0.5, 2.0, -0.5], [0.5, 8.0, 0.5], size=(2000, 3))
    # plane.point far from the product, on the "wrong" side relative to
    # its normal -- orient_normal_away_from would resolve this to point
    # down, same failure shape as the real bug.
    plane = PlaneFit(
        normal=np.array([0.0, -1.0, 0.0]), point=np.array([0.0, 100.0, 0.0]), inlier_mask=np.array([True])
    )

    up_without_hint = estimate_up_axis(plane, product)
    up_with_hint = estimate_up_axis(plane, product, fallback_sign_hint=np.array([0.0, 1.0, 0.0]))

    assert up_without_hint[1] < 0  # the bug this hint exists to override
    assert up_with_hint[1] > 0


# ---------------------------------------------------------------------------
# camera_trajectory_up_hint
# ---------------------------------------------------------------------------


def test_camera_trajectory_up_hint_finds_the_top_down_pass():
    # Orbit frames at roughly constant height (y~0), finishing with a
    # top-down pass clearly above them (y~5) — CLAUDE.md's capture protocol
    # ("3-4 orbits... plus a top-down pass") always finishes with the
    # top-down pass, so it's the last frames in capture order (sorted by
    # image name, which extract.py names sequentially).
    rng = np.random.default_rng(40)
    orbit_images = [
        (i, f"{i:05d}.jpg", (float(np.cos(i)), float(rng.normal(0, 0.05)), float(np.sin(i))))
        for i in range(1, 41)
    ]
    topdown_images = [
        (
            40 + i,
            f"{40 + i:05d}.jpg",
            (float(rng.normal(0, 0.1)), 5.0 + float(rng.normal(0, 0.1)), float(rng.normal(0, 0.1))),
        )
        for i in range(1, 7)
    ]
    reconstruction = build_synthetic_reconstruction(orbit_images + topdown_images)

    hint = camera_trajectory_up_hint(reconstruction)

    assert hint[1] > 0
    assert abs(hint[1]) > abs(hint[0])
    assert abs(hint[1]) > abs(hint[2])


# ---------------------------------------------------------------------------
# compute_alignment_transform
# ---------------------------------------------------------------------------


def test_compute_alignment_transform_recentres_aligns_and_scales():
    rng = np.random.default_rng(7)
    # A product cluster whose "up" in its own raw frame is +Z, offset away
    # from the origin, spanning 4 units along its longest (Z) axis.
    local = rng.uniform([-0.5, -0.5, -2.0], [0.5, 0.5, 2.0], size=(500, 3))
    positions = local + np.array([10.0, -3.0, 7.0])
    up_normal = np.array([0.0, 0.0, 1.0])

    transform = compute_alignment_transform(positions, up_normal)

    rotation = Rotation.from_euler("xyz", transform.rotate_euler_xyz_degrees, degrees=True)
    result = rotation.apply(positions + transform.translate) * transform.scale

    # Median-centred (not mean) and percentile-scaled (not exact min/max) —
    # both robust-statistics choices, so a uniform cluster with no outliers
    # lands close to but not touching these exactly.
    assert np.allclose(np.median(result, axis=0), 0.0, atol=0.05)
    p1, p99 = np.percentile(result, [1, 99], axis=0)
    assert np.isclose((p99 - p1).max(), 1.0, atol=0.05)
    # The original up_normal (+Z) should now point along canonical +Y.
    assert np.allclose(rotation.apply(up_normal), [0.0, 1.0, 0.0], atol=1e-6)


def test_compute_alignment_transform_ignores_a_few_extreme_floaters():
    # Regression test: reproduces the failure found against a real cleaned
    # splat, where a handful of gaussians survived pruning far outside the
    # product's real extent (1st-99th percentile span 4.05 vs raw bbox
    # 46.86 — 11x). Sizing scale off the raw bbox shrank the real product
    # down to a few sparse pixels instead of filling the target frame.
    rng = np.random.default_rng(12)
    product = rng.uniform([-0.5, -0.5, -2.0], [0.5, 0.5, 2.0], size=(2000, 3))
    floaters = np.array([[50.0, 0.0, 0.0], [-60.0, 0.0, 0.0], [0.0, 80.0, 0.0]])
    positions = np.vstack([product, floaters])
    up_normal = np.array([0.0, 0.0, 1.0])

    transform = compute_alignment_transform(positions, up_normal)

    # Had this used the raw bbox, scale would be ~1/140th of this.
    assert transform.scale > 0.2


def test_compute_alignment_transform_median_centroid_is_not_pulled_by_floaters():
    rng = np.random.default_rng(13)
    product = rng.uniform([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], size=(2000, 3))
    floaters = np.full((3, 3), 100.0)  # far off to one side, not centred on the product
    positions = np.vstack([product, floaters])

    transform = compute_alignment_transform(positions, np.array([0.0, 1.0, 0.0]))

    # translate = -centroid; a mean-based centroid would be dragged well
    # away from the product's own centre (near the origin) by the floaters.
    assert np.allclose(transform.translate, 0.0, atol=0.1)


def test_compute_alignment_transform_handles_a_single_point():
    # Degenerate bbox (zero extent) shouldn't divide by zero.
    transform = compute_alignment_transform(np.array([[1.0, 2.0, 3.0]]), np.array([0.0, 1.0, 0.0]))
    assert transform.scale == 1.0


# ---------------------------------------------------------------------------
# apply_alignment_transform against the real splat-transform CLI
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_apply_alignment_transform_matches_intended_geometry(tmp_path: Path):
    # splat-transform's -t/-r arguments are NOT plain right-handed math
    # applied to the PLY's stored (x, y, z) (see apply_alignment_transform's
    # _XY_MIRROR comment) — this pins that conversion against the real CLI
    # so a future splat-transform upgrade, or someone "simplifying away"
    # the mirror, gets caught immediately rather than silently shipping
    # sideways splats.
    positions = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (2.0, 3.0, 4.0), (0.3, 0.7, 0.5)]
    ply_path = tmp_path / "in.ply"
    write_gaussian_ply_at_positions(ply_path, positions, opacity_logit=5.0)

    transform = AlignmentTransform(
        translate=np.array([-1.0, -1.0, -1.0]),
        rotate_euler_xyz_degrees=np.array([90.0, 25.0, 40.0]),  # all three axes nonzero
        scale=2.0,
    )
    out_path = tmp_path / "out.ply"
    apply_alignment_transform(ply_path, transform, out_path)

    _, actual = load_ply_positions(out_path)
    rotation = Rotation.from_euler("xyz", transform.rotate_euler_xyz_degrees, degrees=True)
    expected = rotation.apply(np.array(positions) + transform.translate) * transform.scale

    assert np.allclose(actual, expected, atol=1e-4)
