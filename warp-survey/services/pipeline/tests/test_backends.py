"""Tests for photogrammetry backends."""

import json
import tempfile
from pathlib import Path

import pytest

from warp_survey_pipeline.backends import OpenDroneMapBackend, ReconstructionRequest
from warp_survey_pipeline.errors import PipelineError


class TestOpenDroneMapBackend:
    @pytest.fixture
    def backend(self):
        return OpenDroneMapBackend()

    @pytest.fixture
    def temp_workdir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    def test_backend_name(self, backend):
        """Test backend name property."""
        assert backend.name == "odm"

    def test_backend_version(self, backend):
        """Test backend version includes container digest."""
        version = backend.version()
        assert version.startswith("odm-")
        assert "4.5.0" in version

    def test_build_odm_config(self, backend, temp_workdir):
        """Test building ODM config dict."""
        request = ReconstructionRequest(
            image_paths=[Path("img1.jpg"), Path("img2.jpg")],
            gcp_file=None,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir,
        )

        config = backend._build_odm_config(request)
        assert config["dsm"] is True
        assert config["dtm"] is False
        assert config["orthophoto"] is True
        assert config["crs"] == "EPSG:32633"

    def test_build_odm_config_with_gcp(self, backend, temp_workdir):
        """Test ODM config with GCP file."""
        gcp_file = temp_workdir / "gcp.csv"
        gcp_file.write_text("test,gcp")

        request = ReconstructionRequest(
            image_paths=[Path("img1.jpg")],
            gcp_file=gcp_file,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir,
        )

        config = backend._build_odm_config(request)
        assert "gcp" in config

    def test_build_cli_args(self, backend, temp_workdir):
        """Test building CLI arguments."""
        request = ReconstructionRequest(
            image_paths=[Path("img1.jpg")],
            gcp_file=None,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir,
        )

        config = backend._build_odm_config(request)
        args = backend._build_odm_cli_args(request, config)

        assert "process" in args
        assert "--options" in args
        assert any("EPSG:32633" in arg for arg in args)

    def test_map_odm_outputs_missing(self, backend, temp_workdir):
        """Test output mapping when directories don't exist."""
        artifacts = backend._map_odm_outputs(temp_workdir)

        # All should be None if directories don't exist
        assert artifacts["dense_cloud"] is None
        assert artifacts["dsm"] is None
        assert artifacts["dtm"] is None
        assert artifacts["orthomosaic"] is None

    def test_map_odm_outputs_exist(self, backend, temp_workdir):
        """Test output mapping when files exist."""
        # Create fake output directories
        (temp_workdir / "odm_georeferencing").mkdir()
        (temp_workdir / "odm_georeferencing" / "odm_georeferenced_model.laz").touch()
        (temp_workdir / "odm_dem").mkdir()
        (temp_workdir / "odm_dem" / "dsm.tif").touch()
        (temp_workdir / "odm_orthophoto").mkdir()
        (temp_workdir / "odm_orthophoto" / "odm_orthophoto.tif").touch()

        artifacts = backend._map_odm_outputs(temp_workdir)

        assert artifacts["dense_cloud"] is not None
        assert artifacts["dsm"] is not None
        assert artifacts["orthomosaic"] is not None

    def test_reconstruct_no_images(self, backend, temp_workdir):
        """Test reconstruction fails with no images."""
        request = ReconstructionRequest(
            image_paths=[],
            gcp_file=None,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir,
        )

        with pytest.raises(PipelineError, match="No input images"):
            backend.reconstruct(request)

    def test_reconstruct_missing_images(self, backend, temp_workdir):
        """Test reconstruction fails if images don't exist."""
        request = ReconstructionRequest(
            image_paths=[Path("/nonexistent/img.jpg")],
            gcp_file=None,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir,
        )

        with pytest.raises(PipelineError, match="not found"):
            backend.reconstruct(request)

    def test_reconstruct_not_implemented(self, backend, temp_workdir):
        """Test reconstruction stubs NotImplementedError during technical-validation."""
        # Create valid input
        img = temp_workdir / "img.jpg"
        img.write_text("fake image")

        request = ReconstructionRequest(
            image_paths=[img],
            gcp_file=None,
            camera_positions={},
            crs="EPSG:32633",
            vertical_datum="EGM96",
            units="meters",
            output_dir=temp_workdir / "output",
        )

        with pytest.raises(NotImplementedError, match="technical-validation"):
            backend.reconstruct(request)
