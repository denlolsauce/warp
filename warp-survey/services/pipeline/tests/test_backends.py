"""Tests for photogrammetry and splat backends (fake container runners)."""

import json
import subprocess
import tempfile
from pathlib import Path

import pytest

from warp_survey_pipeline.backends import OpenDroneMapBackend, ReconstructionRequest
from warp_survey_pipeline.backends.splat import GsplatBackend, SplatTrainingRequest
from warp_survey_pipeline.errors import PipelineError


def completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


@pytest.fixture
def temp_workdir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def make_request(temp_workdir, images=None, gcp_file=None, camera_positions=None):
    return ReconstructionRequest(
        image_paths=images if images is not None else [],
        gcp_file=gcp_file,
        camera_positions=camera_positions or {},
        crs="EPSG:32633",
        vertical_datum="EGM96",
        units="metre",
        output_dir=temp_workdir / "project",
    )


def fake_images(temp_workdir, n=3):
    paths = []
    for i in range(n):
        p = temp_workdir / f"img{i}.jpg"
        p.write_bytes(b"fake image data")
        paths.append(p)
    return paths


def write_odm_outputs(project_dir: Path, registered=2):
    (project_dir / "odm_georeferencing").mkdir(parents=True, exist_ok=True)
    (project_dir / "odm_georeferencing" / "odm_georeferenced_model.laz").write_bytes(b"laz")
    (project_dir / "odm_dem").mkdir(exist_ok=True)
    (project_dir / "odm_dem" / "dsm.tif").write_bytes(b"tif")
    (project_dir / "odm_orthophoto").mkdir(exist_ok=True)
    (project_dir / "odm_orthophoto" / "odm_orthophoto.tif").write_bytes(b"tif")
    report = project_dir / "odm_report"
    report.mkdir(exist_ok=True)
    features = [
        {
            "properties": {
                "filename": f"img{i}.jpg",
                "translation": [100.0 + i, 200.0, 50.0],
                "rotation": [0.0, 0.0, 0.1],
                "width": 4000,
                "height": 3000,
            }
        }
        for i in range(registered)
    ]
    (report / "shots.geojson").write_text(json.dumps({"features": features}))
    (project_dir / "cameras.json").write_text(
        json.dumps({"cam1": {"focal_x": 0.85, "focal_y": 0.85, "c_x": 0.0, "c_y": 0.0, "width": 4000, "height": 3000}})
    )


class TestOpenDroneMapBackend:
    def test_backend_name_and_version(self):
        backend = OpenDroneMapBackend()
        assert backend.name == "odm"
        assert backend.version().startswith("odm-")
        assert "+" in backend.version()  # digest suffix

    def test_build_odm_config(self, temp_workdir):
        backend = OpenDroneMapBackend()
        config = backend._build_odm_config(make_request(temp_workdir, [Path("a.jpg")]))
        assert config["dsm"] is True
        assert config["dtm"] is True  # requested; DENSE_PRODUCTS decides publication
        assert "gcp" not in config

    def test_build_odm_config_with_gcp(self, temp_workdir):
        gcp = temp_workdir / "gcp_list.txt"
        gcp.write_text("EPSG:32633\n")
        backend = OpenDroneMapBackend()
        config = backend._build_odm_config(make_request(temp_workdir, [Path("a.jpg")], gcp_file=gcp))
        assert "gcp" in config

    def test_cli_args_pin_container_digest(self, temp_workdir):
        backend = OpenDroneMapBackend()
        request = make_request(temp_workdir, [Path("a.jpg")])
        args = backend._build_odm_cli_args(request, backend._build_odm_config(request))
        assert args[:3] == ["docker", "run", "--rm"]
        image = next(a for a in args if a.startswith("opendronemap/odm@sha256:"))
        assert image  # pinned by digest, never a floating tag

    def test_map_odm_outputs_missing(self, temp_workdir):
        artifacts = OpenDroneMapBackend()._map_odm_outputs(temp_workdir)
        assert all(v is None for v in artifacts.values())

    def test_map_odm_outputs_exist(self, temp_workdir):
        write_odm_outputs(temp_workdir)
        artifacts = OpenDroneMapBackend()._map_odm_outputs(temp_workdir)
        assert artifacts["dense_cloud"] is not None
        assert artifacts["dsm"] is not None
        assert artifacts["orthomosaic"] is not None
        assert artifacts["dtm"] is None  # not produced in this fixture

    def test_reconstruct_no_images(self, temp_workdir):
        with pytest.raises(PipelineError, match="No input images"):
            OpenDroneMapBackend().reconstruct(make_request(temp_workdir))

    def test_reconstruct_missing_images(self, temp_workdir):
        request = make_request(temp_workdir, [Path("/nonexistent/img.jpg")])
        with pytest.raises(PipelineError, match="not found"):
            OpenDroneMapBackend().reconstruct(request)

    def test_reconstruct_success_parses_outputs(self, temp_workdir):
        images = fake_images(temp_workdir, 3)
        request = make_request(temp_workdir, images)

        def runner(cmd):
            write_odm_outputs(request.output_dir, registered=3)
            return completed(0)

        backend = OpenDroneMapBackend(runner=runner)
        result = backend.reconstruct(request)

        assert result.dense_cloud_path.exists()
        assert result.dsm_path.exists()
        assert result.quality_metrics["registration_rate"] == 1.0
        assert len(result.cameras) == 3
        cam = result.cameras[0]
        assert cam.width == 4000
        assert cam.fx == pytest.approx(0.85 * 4000)
        assert result.provenance["container_digest"].startswith("sha256:")

    def test_reconstruct_failure_surfaces_output_tail(self, temp_workdir):
        images = fake_images(temp_workdir, 2)
        request = make_request(temp_workdir, images)
        backend = OpenDroneMapBackend(runner=lambda cmd: completed(1, stderr="not enough overlap"))
        with pytest.raises(PipelineError, match="not enough overlap") as exc:
            backend.reconstruct(request)
        assert exc.value.transient is False

    def test_reconstruct_missing_required_outputs_fails(self, temp_workdir):
        images = fake_images(temp_workdir, 2)
        request = make_request(temp_workdir, images)
        backend = OpenDroneMapBackend(runner=lambda cmd: completed(0))
        with pytest.raises(PipelineError, match="required outputs are missing"):
            backend.reconstruct(request)

    def test_geo_file_written_for_camera_positions(self, temp_workdir):
        images = fake_images(temp_workdir, 2)
        positions = {images[0].name: (47.0, 8.0, 500.0, 0.02, 0.02, 0.04)}
        request = make_request(temp_workdir, images, camera_positions=positions)

        def runner(cmd):
            write_odm_outputs(request.output_dir)
            return completed(0)

        OpenDroneMapBackend(runner=runner).reconstruct(request)
        geo = (request.output_dir / "geo.txt").read_text().splitlines()
        assert geo[0] == "EPSG:4326"
        assert geo[1].startswith("img0.jpg 8.0 47.0 500.0")


class TestGsplatBackend:
    def test_train_success(self, temp_workdir):
        cameras = temp_workdir / "cameras_local.json"
        cameras.write_text("{}")
        images = temp_workdir / "images"
        images.mkdir()
        out = temp_workdir / "out"

        def runner(cmd):
            out.mkdir(exist_ok=True)
            (out / "splat.ply").write_bytes(b"ply")
            (out / "training_stats.json").write_text(json.dumps({"gaussianCount": 123456}))
            return completed(0)

        backend = GsplatBackend(runner=runner)
        result = backend.train(SplatTrainingRequest(cameras_json=cameras, images_dir=images, output_dir=out))
        assert result.gaussian_count == 123456
        assert result.provenance["container_digest"].startswith("sha256:")

    def test_train_failure_is_transient(self, temp_workdir):
        cameras = temp_workdir / "cameras_local.json"
        cameras.write_text("{}")
        images = temp_workdir / "images"
        images.mkdir()
        backend = GsplatBackend(runner=lambda cmd: completed(1, stderr="CUDA out of memory"))
        with pytest.raises(PipelineError, match="CUDA out of memory") as exc:
            backend.train(SplatTrainingRequest(cameras_json=cameras, images_dir=images, output_dir=temp_workdir / "out"))
        assert exc.value.transient is True

    def test_train_missing_cameras(self, temp_workdir):
        backend = GsplatBackend(runner=lambda cmd: completed(0))
        with pytest.raises(PipelineError, match="cameras"):
            backend.train(
                SplatTrainingRequest(
                    cameras_json=temp_workdir / "missing.json",
                    images_dir=temp_workdir,
                    output_dir=temp_workdir / "out",
                )
            )
