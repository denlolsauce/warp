"""Synthetic slope surfaces with known, exact ground truth.

Every geo test asserts against a movement it put there itself, so a passing
test means the measurement recovered a real number rather than merely
producing a plausible-looking one.
"""

import numpy as np


def slope_surface(
    n: int = 6000,
    extent_m: float = 20.0,
    gradient: float = 0.5,
    roughness_m: float = 0.01,
    seed: int = 0,
) -> np.ndarray:
    """A planar slope of the given gradient, with gaussian surface roughness.

    Roughness is what M3C2's level of detection is computed from, so it must
    be present and known: a perfectly smooth synthetic surface would give a
    zero LoD and let any change register as significant.
    """
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, extent_m, n)
    y = rng.uniform(0, extent_m, n)
    z = gradient * x + rng.normal(0, roughness_m, n)
    return np.column_stack([x, y, z])


def displace_disc(
    points: np.ndarray,
    centre_xy: tuple[float, float],
    radius_m: float,
    displacement_m: float,
    direction: np.ndarray | None = None,
) -> np.ndarray:
    """Move every point inside a vertical cylinder by a known amount.

    A hard-edged disc, not a smooth bump: the cluster tests need an exact
    known footprint area to check a recovered volume against.
    """
    direction = np.array([0.0, 0.0, 1.0]) if direction is None else np.asarray(direction, dtype=np.float64)
    direction = direction / np.linalg.norm(direction)

    moved = points.copy()
    inside = np.linalg.norm(points[:, :2] - np.array(centre_xy), axis=1) <= radius_m
    moved[inside] += direction * displacement_m
    return moved
