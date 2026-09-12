"""Coordinate transform helpers for local-origin engineering surveys.

Supports affine-only transforms (translation + scale + rotation) in float64.
Projected ↔ geographic transforms arrive precomputed from GDAL/PROJ containers.
"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class TransformSpec:
    """Coordinate transform specification.

    Attributes:
        source_crs: Source CRS string (e.g., "EPSG:4326").
        target_crs: Target CRS string.
        affine_4x4: 4x4 homogeneous transform matrix, or None for identity.
        translation: 3-element translation vector (alternative to affine).
        scale: Uniform or per-axis scale factor.
    """

    source_crs: str
    target_crs: str
    affine_4x4: np.ndarray | None = None
    translation: np.ndarray | None = None
    scale: float | np.ndarray = 1.0


def apply_affine(points: np.ndarray, affine: np.ndarray) -> np.ndarray:
    """Apply 4x4 affine transform to Nx3 point cloud.

    Args:
        points: (N, 3) array of (x, y, z) coordinates.
        affine: 4x4 homogeneous transform matrix.

    Returns:
        Transformed (N, 3) points.
    """
    ones = np.ones((points.shape[0], 1))
    homogeneous = np.hstack([points, ones])
    transformed = homogeneous @ affine.T
    return transformed[:, :3]


def compose_affine(*transforms: np.ndarray) -> np.ndarray:
    """Compose multiple 4x4 affine transforms left-to-right.

    Args:
        *transforms: 4x4 matrices.

    Returns:
        Product matrix.
    """
    result = np.eye(4)
    for t in transforms:
        result = result @ t
    return result


def invert_affine(affine: np.ndarray) -> np.ndarray:
    """Invert a 4x4 affine transform.

    Args:
        affine: 4x4 matrix.

    Returns:
        Inverted 4x4 matrix.

    Raises:
        np.linalg.LinAlgError: If matrix is singular.
    """
    return np.linalg.inv(affine)


def translation_matrix(tx: float, ty: float, tz: float) -> np.ndarray:
    """Build a 4x4 translation matrix."""
    mat = np.eye(4)
    mat[0, 3] = tx
    mat[1, 3] = ty
    mat[2, 3] = tz
    return mat


def scale_matrix(sx: float, sy: float = None, sz: float = None) -> np.ndarray:
    """Build a 4x4 scale matrix. Uniform if only sx provided."""
    if sy is None:
        sy = sx
    if sz is None:
        sz = sx
    mat = np.eye(4)
    mat[0, 0] = sx
    mat[1, 1] = sy
    mat[2, 2] = sz
    return mat


def apply_transform_spec(
    points: np.ndarray, spec: TransformSpec, forward: bool = True
) -> np.ndarray:
    """Apply a transform spec to point cloud.

    Args:
        points: (N, 3) point cloud.
        spec: Transform spec.
        forward: If True, apply forward transform; if False, invert and apply.

    Returns:
        Transformed points.
    """
    if spec.affine_4x4 is not None:
        affine = spec.affine_4x4
        if not forward:
            affine = invert_affine(affine)
        return apply_affine(points, affine)

    # Fallback: translation + scale
    result = points.copy()
    if spec.translation is not None:
        if forward:
            result = result + spec.translation
        else:
            result = result - spec.translation

    if spec.scale != 1.0:
        if forward:
            result = result * spec.scale
        else:
            result = result / spec.scale

    return result
