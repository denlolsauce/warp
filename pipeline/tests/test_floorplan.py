from pathlib import Path

from PIL import Image

from ply_fixtures import write_gaussian_ply_at_positions
from portal_pipeline.floorplan import BOUNDS_PAD_METERS, render_floorplan

# Comfortably above BOUNDS_OPACITY_THRESHOLD after sigmoid (~0.88) — these
# tests are about bounds/geometry correctness, so every point should count
# toward the bounds; only test_render_floorplan_excludes_low_opacity_floaters
# below is actually about the opacity filter itself.
HIGH_OPACITY_LOGIT = 2.0


def test_render_floorplan_produces_a_readable_png_with_matching_aspect_ratio(tmp_path: Path):
    positions = [(x, 1.6, z) for x in (-4.0, 4.0) for z in (-2.0, 2.0)]  # 8m x 4m footprint
    ply_path = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(ply_path, positions, seed=1, opacity_logit=HIGH_OPACITY_LOGIT)

    out_path = tmp_path / "floorplan.png"
    bounds = render_floorplan(ply_path, needs_flip=False, output_path=out_path)

    image = Image.open(out_path)
    image.load()  # forces a full decode, not just header parsing
    assert image.mode == "RGB"

    [min_x, min_z], [max_x, max_z] = bounds
    world_aspect = (max_z - min_z) / (max_x - min_x)
    image_aspect = image.height / image.width
    assert abs(world_aspect - image_aspect) < 0.01


def test_render_floorplan_bounds_match_point_extent_plus_padding(tmp_path: Path):
    positions = [(-4.0, 1.6, -2.0), (4.0, 1.6, 2.0)]
    ply_path = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(ply_path, positions, seed=2, opacity_logit=HIGH_OPACITY_LOGIT)

    bounds = render_floorplan(ply_path, needs_flip=False, output_path=tmp_path / "floorplan.png")

    assert bounds == [
        [-4.0 - BOUNDS_PAD_METERS, -2.0 - BOUNDS_PAD_METERS],
        [4.0 + BOUNDS_PAD_METERS, 2.0 + BOUNDS_PAD_METERS],
    ]


def test_render_floorplan_needs_flip_negates_y_and_z_before_projecting(tmp_path: Path):
    # Point at (x=1, y=5, z=9). needs_flip negates y and z (compress.py's
    # 180-about-X correction) *before* the top-down XZ projection, so with
    # the flip the projected z comes from -9, without it from +9 -- the
    # resulting bounds on the z-axis pin down which one actually happened.
    positions = [(1.0, 5.0, 9.0)]
    ply_path = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(ply_path, positions, seed=3, opacity_logit=HIGH_OPACITY_LOGIT)

    bounds_unflipped = render_floorplan(ply_path, needs_flip=False, output_path=tmp_path / "a.png")
    bounds_flipped = render_floorplan(ply_path, needs_flip=True, output_path=tmp_path / "b.png")

    assert bounds_unflipped[0][1] == 9.0 - BOUNDS_PAD_METERS  # min z == max z for a single point
    assert bounds_flipped[0][1] == -9.0 - BOUNDS_PAD_METERS
    # x is untouched by the flip either way
    assert bounds_unflipped[0][0] == bounds_flipped[0][0] == 1.0 - BOUNDS_PAD_METERS


def test_render_floorplan_handles_a_single_point_without_a_zero_size_image(tmp_path: Path):
    ply_path = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(ply_path, [(0.0, 0.0, 0.0)], seed=4, opacity_logit=HIGH_OPACITY_LOGIT)

    out_path = tmp_path / "floorplan.png"
    bounds = render_floorplan(ply_path, needs_flip=False, output_path=out_path)

    image = Image.open(out_path)
    assert image.width > 0
    assert image.height > 0
    assert bounds == [[-BOUNDS_PAD_METERS, -BOUNDS_PAD_METERS], [BOUNDS_PAD_METERS, BOUNDS_PAD_METERS]]


def test_render_floorplan_excludes_low_opacity_floaters_from_bounds(tmp_path: Path):
    # MCMC's dead-gaussian relocation strands near-invisible points far from
    # the real geometry (confirmed against a real trained PLY, not
    # hypothetical — see floorplan.py's BOUNDS_OPACITY_THRESHOLD comment). A
    # single low-opacity point 1000m away must not blow out the bounds
    # computed from the real, high-opacity room geometry.
    LOW_OPACITY_LOGIT = -2.0  # sigmoid(-2) ~= 0.12, comfortably under the threshold
    positions = [(-4.0, 1.6, -2.0), (4.0, 1.6, 2.0), (1000.0, 1.6, 1000.0)]
    ply_path = tmp_path / "overview.ply"

    write_gaussian_ply_at_positions(
        ply_path,
        positions,
        opacity_logit=[HIGH_OPACITY_LOGIT, HIGH_OPACITY_LOGIT, LOW_OPACITY_LOGIT],
    )

    bounds = render_floorplan(ply_path, needs_flip=False, output_path=tmp_path / "floorplan.png")

    assert bounds == [
        [-4.0 - BOUNDS_PAD_METERS, -2.0 - BOUNDS_PAD_METERS],
        [4.0 + BOUNDS_PAD_METERS, 2.0 + BOUNDS_PAD_METERS],
    ]
