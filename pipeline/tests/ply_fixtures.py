import random
import struct
from pathlib import Path

PLY_PROPERTIES = [
    "x", "y", "z", "nx", "ny", "nz",
    "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
]


def write_synthetic_gaussian_ply(path: Path, n: int = 200, seed: int = 0) -> None:
    rng = random.Random(seed)
    positions = [tuple(rng.uniform(-1, 1) for _ in range(3)) for _ in range(n)]
    write_gaussian_ply_at_positions(path, positions, seed=seed)


def write_gaussian_ply_at_positions(
    path: Path,
    positions: list[tuple[float, float, float]],
    seed: int = 0,
    opacity_logit: float | list[float] | None = None,
) -> None:
    """Like write_synthetic_gaussian_ply but at caller-chosen positions, for
    tests that need to control exactly which points land where (e.g.
    relative to a specific bbox).

    opacity_logit pins pre-sigmoid opacity instead of the default per-point
    random one (uniform over [-2, 2], i.e. sigmoid opacity roughly
    [0.12, 0.88] — straddling floorplan.py's BOUNDS_OPACITY_THRESHOLD, so
    two-plus-point geometry tests using the random default can flip which
    points count toward bounds from one seed to the next). Pass a single
    float to pin every point the same way, or a list (one value per
    position) for per-point control. Tests asserting exact bounds/geometry
    should pin this high so they're testing geometry, not incidentally
    testing opacity filtering.
    """
    rng = random.Random(seed)
    n = len(positions)
    if isinstance(opacity_logit, list):
        assert len(opacity_logit) == n, "opacity_logit list must have one entry per position"
        opacity_logits = opacity_logit
    else:
        opacity_logits = [opacity_logit] * n

    header_lines = ["ply", "format binary_little_endian 1.0", f"element vertex {n}"]
    header_lines += [f"property float {p}" for p in PLY_PROPERTIES]
    header_lines += ["end_header"]
    header = ("\n".join(header_lines) + "\n").encode("ascii")

    rows = []
    for position, point_opacity_logit in zip(positions, opacity_logits):
        normal = [0.0, 0.0, 0.0]
        dc = [rng.uniform(-1, 1) for _ in range(3)]
        opacity = [point_opacity_logit if point_opacity_logit is not None else rng.uniform(-2, 2)]
        scale = [rng.uniform(-3, -1) for _ in range(3)]
        rotation = [1.0, 0.0, 0.0, 0.0]
        vals = list(position) + normal + dc + opacity + scale + rotation
        rows.append(struct.pack("<17f", *vals))

    path.write_bytes(header + b"".join(rows))
