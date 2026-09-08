"""Tests for coordinate transform helpers."""

import numpy as np
import pytest

from warp_survey_pipeline.coords import (
    TransformSpec,
    apply_affine,
    apply_transform_spec,
    compose_affine,
    invert_affine,
    scale_matrix,
    translation_matrix,
)


class TestAffineTransforms:
    def test_translation_matrix(self):
        """Test translation matrix construction."""
        mat = translation_matrix(1.0, 2.0, 3.0)
        assert np.allclose(mat[0, 3], 1.0)
        assert np.allclose(mat[1, 3], 2.0)
        assert np.allclose(mat[2, 3], 3.0)
        assert np.allclose(mat[3, 3], 1.0)

    def test_scale_matrix(self):
        """Test scale matrix construction."""
        mat = scale_matrix(2.0, 3.0, 4.0)
        assert np.allclose(mat[0, 0], 2.0)
        assert np.allclose(mat[1, 1], 3.0)
        assert np.allclose(mat[2, 2], 4.0)

    def test_scale_matrix_uniform(self):
        """Test uniform scale matrix."""
        mat = scale_matrix(2.0)
        assert np.allclose(mat[0, 0], 2.0)
        assert np.allclose(mat[1, 1], 2.0)
        assert np.allclose(mat[2, 2], 2.0)

    def test_apply_affine(self):
        """Test applying affine transform to points."""
        points = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float64)
        translate = translation_matrix(1.0, 2.0, 3.0)

        result = apply_affine(points, translate)

        assert np.allclose(result[0], [1, 2, 3])
        assert np.allclose(result[1], [2, 2, 3])
        assert np.allclose(result[2], [1, 3, 3])

    def test_apply_affine_scale(self):
        """Test scale transform."""
        points = np.array([[1, 1, 1], [2, 2, 2]], dtype=np.float64)
        scale = scale_matrix(2.0)

        result = apply_affine(points, scale)

        assert np.allclose(result[0], [2, 2, 2])
        assert np.allclose(result[1], [4, 4, 4])

    def test_compose_affine(self):
        """Test composing transforms."""
        translate = translation_matrix(1.0, 0, 0)
        scale = scale_matrix(2.0)

        composed = compose_affine(translate, scale)
        points = np.array([[1, 0, 0]], dtype=np.float64)
        result = apply_affine(points, composed)

        # Matrix composition: translate @ scale means scale first, then translate
        # So: (1,0,0) * 2 = (2,0,0), then + (1,0,0) = (3,0,0)
        assert np.allclose(result[0], [3, 0, 0])

    def test_invert_affine(self):
        """Test inverting a transform."""
        translate = translation_matrix(5.0, 10.0, 15.0)
        inverted = invert_affine(translate)

        points = np.array([[5, 10, 15]], dtype=np.float64)
        forward = apply_affine(points, translate)
        backward = apply_affine(forward, inverted)

        assert np.allclose(backward, points)

    def test_round_trip_transform(self):
        """Test forward and inverse transforms are consistent."""
        translate = translation_matrix(3.0, 4.0, 5.0)
        scale = scale_matrix(0.5)
        composite = compose_affine(translate, scale)

        points = np.array(
            [[0, 0, 0], [1, 2, 3], [10, 20, 30]],
            dtype=np.float64,
        )

        forward = apply_affine(points, composite)
        inverse = invert_affine(composite)
        backward = apply_affine(forward, inverse)

        assert np.allclose(backward, points, atol=1e-10)


class TestTransformSpec:
    def test_apply_with_affine(self):
        """Test applying transform spec with affine matrix."""
        points = np.array([[0, 0, 0]], dtype=np.float64)
        affine = translation_matrix(1.0, 2.0, 3.0)
        spec = TransformSpec(
            source_crs="EPSG:4326",
            target_crs="EPSG:32633",
            affine_4x4=affine,
        )

        result = apply_transform_spec(points, spec)
        assert np.allclose(result[0], [1, 2, 3])

    def test_apply_with_translation_only(self):
        """Test applying transform spec with translation vector."""
        points = np.array([[1, 2, 3]], dtype=np.float64)
        translation = np.array([10, 20, 30], dtype=np.float64)
        spec = TransformSpec(
            source_crs="EPSG:4326",
            target_crs="EPSG:32633",
            translation=translation,
        )

        result = apply_transform_spec(points, spec)
        assert np.allclose(result[0], [11, 22, 33])

    def test_apply_with_scale(self):
        """Test applying transform spec with scale."""
        points = np.array([[2, 4, 6]], dtype=np.float64)
        spec = TransformSpec(
            source_crs="EPSG:4326",
            target_crs="EPSG:32633",
            scale=2.0,
        )

        result = apply_transform_spec(points, spec)
        assert np.allclose(result[0], [4, 8, 12])

    def test_inverse_transform(self):
        """Test inverse transform."""
        points = np.array([[1, 2, 3]], dtype=np.float64)
        affine = translation_matrix(5.0, 10.0, 15.0)
        spec = TransformSpec(
            source_crs="EPSG:4326",
            target_crs="EPSG:32633",
            affine_4x4=affine,
        )

        forward = apply_transform_spec(points, spec, forward=True)
        backward = apply_transform_spec(forward, spec, forward=False)
        assert np.allclose(backward, points)
