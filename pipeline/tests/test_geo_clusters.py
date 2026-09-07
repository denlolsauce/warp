import numpy as np

from geo_fixtures import displace_disc, slope_surface
from splat_pipeline.geo.change import ChangeConfig, compute_change
from splat_pipeline.geo.cloud import median_point_spacing
from splat_pipeline.geo.clusters import cluster_significant_change
from splat_pipeline.geo.survey import subsample_core_points
from test_geo_volume import flat_grid, synthetic_field


def test_separates_two_distinct_movements_into_two_findings():
    points = flat_grid(extent_m=30.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.zeros(len(points))
    near_first = np.linalg.norm(points[:, :2] - np.array([5.0, 5.0]), axis=1) < 3.0
    near_second = np.linalg.norm(points[:, :2] - np.array([25.0, 25.0]), axis=1) < 3.0
    distances[near_first] = -0.4
    distances[near_second] = -0.15
    field = synthetic_field(distances, points, normals)

    clusters = cluster_significant_change(field)

    assert len(clusters) == 2
    # Ranked by measured magnitude, so the head of the queue is where to
    # walk first.
    assert clusters[0].peak_distance_m < clusters[1].peak_distance_m
    assert np.allclose(clusters[0].centroid[:2], [5.0, 5.0], atol=0.5)
    assert np.allclose(clusters[1].centroid[:2], [25.0, 25.0], atol=0.5)
    assert [cluster.cluster_id for cluster in clusters] == [0, 1]


def test_adjacent_loss_and_gain_stay_separate_findings():
    # Material off a crest arriving at the toe is one mechanism but two
    # findings; merging them would net their volumes toward zero and hide
    # exactly the pattern worth escalating.
    points = flat_grid(extent_m=20.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.where(points[:, 0] < 10.0, -0.3, 0.3)
    field = synthetic_field(distances, points, normals)

    clusters = cluster_significant_change(field)

    assert sorted(cluster.direction for cluster in clusters) == ["gain", "loss"]
    loss = next(c for c in clusters if c.direction == "loss")
    gain = next(c for c in clusters if c.direction == "gain")
    assert loss.volume.loss_m3 > 50.0
    assert gain.volume.gain_m3 > 50.0


def test_isolated_significant_points_are_not_reported_as_findings():
    # At LoD95%, ~5% of stable ground reads as significant by chance.
    # Reporting those as findings is what makes an inspection queue
    # unusable.
    points = flat_grid(extent_m=30.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    rng = np.random.default_rng(70)
    distances = np.zeros(len(points))
    distances[rng.choice(len(points), size=int(len(points) * 0.05), replace=False)] = -0.3
    field = synthetic_field(distances, points, normals)

    clusters = cluster_significant_change(field)

    assert field.significant.sum() > 100
    assert clusters == []


def test_peak_confidence_ratio_qualifies_a_peak_against_its_own_threshold():
    # 30 mm measured against a 25 mm LoD is not the same finding as 30 mm
    # against 4 mm, and the report has to say which one it is.
    points = flat_grid(extent_m=10.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.full(len(points), -0.030)

    marginal = cluster_significant_change(synthetic_field(distances, points, normals, random_lod_m=0.025))
    confident = cluster_significant_change(synthetic_field(distances, points, normals, random_lod_m=0.004))

    assert marginal[0].peak_confidence_ratio < 1.5
    assert confident[0].peak_confidence_ratio > 5.0


def test_finding_bbox_and_volume_locate_and_quantify_the_region():
    points = flat_grid(extent_m=20.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.zeros(len(points))
    inside = np.linalg.norm(points[:, :2] - np.array([10.0, 10.0]), axis=1) < 4.0
    distances[inside] = -0.25
    field = synthetic_field(distances, points, normals)

    cluster = cluster_significant_change(field)[0]

    lower, upper = cluster.bbox
    assert np.allclose(lower[:2], [6.0, 6.0], atol=0.6)
    assert np.allclose(upper[:2], [14.0, 14.0], atol=0.6)
    # 0.25 m over a 4 m-radius disc = 12.6 m3, within grid quantisation of
    # the disc's curved edge.
    assert np.isclose(cluster.volume.loss_m3, 0.25 * np.pi * 16, rtol=0.2)


def test_as_dict_is_json_serialisable_with_no_numpy_types():
    points = flat_grid(extent_m=10.0, step_m=0.4)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), -0.2), points, normals)

    import json

    payload = json.loads(json.dumps(cluster_significant_change(field)[0].as_dict()))

    assert payload["direction"] == "loss"
    assert len(payload["centroid"]) == 3
    assert payload["volume"]["lossM3"] > 0


def test_clusters_a_movement_measured_through_the_real_change_path():
    baseline = slope_surface(n=20000, seed=80)
    repeat = displace_disc(baseline, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.35)
    spacing = median_point_spacing(baseline)
    core = subsample_core_points(baseline, spacing * 3.0)

    field = compute_change(baseline, repeat, core, ChangeConfig.from_point_spacing(spacing, 0.0))
    clusters = cluster_significant_change(field, plane_normal=np.array([0.0, 0.0, 1.0]))

    assert len(clusters) >= 1
    finding = clusters[0]
    assert finding.direction == "loss"
    assert np.allclose(finding.centroid[:2], [10.0, 10.0], atol=1.0)
    assert finding.peak_confidence_ratio > 3.0
