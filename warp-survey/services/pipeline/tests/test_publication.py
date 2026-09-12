"""Publication of durable outputs and registration application.

These cover the handoff the workspace actually reads: a finished branch must
hand the web app its artifacts, quality verdict, and (for comparisons) the
computed result under the run's fencing token.
"""

import tempfile
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import Affine

from warp_survey_pipeline.callbacks import CollectingStatusSink
from warp_survey_pipeline.errors import PipelineError
from warp_survey_pipeline.geo import Grid, read_grid, write_cog
from warp_survey_pipeline.handlers import (
    handle_change_computation,
    handle_publish_comparison,
    handle_publish_measurement,
    handle_publish_visualization,
)
from warp_survey_pipeline.stages.comparison import (
    apply_transform_to_grid,
    apply_transform_to_points,
)
from warp_survey_pipeline.storage import InMemoryObjectStore
from warp_survey_pipeline.worker import QueueMessage, RunKind, StageContext


@pytest.fixture
def workdir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def make_context(workdir, kind, payload, prior_outputs, sink=None):
    return StageContext(
        message=QueueMessage("run-1", kind, "survey-1", payload),
        store=InMemoryObjectStore(),
        workdir=str(workdir),
        prior_outputs=prior_outputs,
        status_sink=sink,
        fencing_token=7,
    )


def stored(key, size=100):
    return {"key": key, "sha256": "a" * 64, "size": size}


MEASUREMENT_OUTPUTS = {
    "RECONSTRUCTION": {
        "artifacts": {"dense_cloud": stored("runs/run-1/cloud.laz")},
        "provenance": {"backend": "odm", "container_digest": "sha256:abc"},
        "metrics": {"registered_images": 410.0, "total_images": 420.0},
    },
    "DENSE_PRODUCTS": {
        "artifacts": {"dsm": stored("runs/run-1/dsm.tif"), "coverage_mask": stored("runs/run-1/mask.tif")},
        "bounds": [100.0, 200.0, 300.0, 400.0],
        "resolutionM": 0.05,
    },
    "CHECKPOINT_QA": {
        "quality": {
            "state": "PASS",
            "checkpoints": {"count": 6, "verticalRmseM": 0.03},
            "findings": ["distribution: checkpoints cover the assessed extent"],
            "acceptanceProfileId": "prof_1",
            "acceptanceProfileVersion": 2,
        },
    },
}


class TestMeasurementPublication:
    def test_publishes_artifacts_and_quality(self, workdir):
        sink = CollectingStatusSink()
        context = make_context(
            workdir, RunKind.MEASUREMENT, {"crs": "EPSG:25832"}, dict(MEASUREMENT_OUTPUTS), sink
        )
        metrics, keys, outputs = handle_publish_measurement(context)

        assert len(sink.publications) == 1
        published = sink.publications[0]
        assert published["branch"] == "MEASUREMENT"
        assert published["runId"] == "run-1"
        # The lease fence travels with the publication so a superseded worker
        # cannot overwrite a newer attempt's results.
        assert published["fencingToken"] == 7

        kinds = {a["kind"] for a in published["artifacts"]}
        assert {"DENSE_POINT_CLOUD_LAZ", "DSM_COG", "COVERAGE_MASK", "QUALITY_RECORD"} <= kinds

        quality = published["measurementQuality"]
        assert quality["state"] == "PASS"
        assert quality["registeredImages"] == 410
        assert quality["totalImages"] == 420
        assert quality["acceptanceProfileId"] == "prof_1"
        assert metrics["published"] is True
        assert outputs["summaryKey"] in keys

    def test_artifact_checksums_and_sizes_travel(self, workdir):
        sink = CollectingStatusSink()
        context = make_context(workdir, RunKind.MEASUREMENT, {}, dict(MEASUREMENT_OUTPUTS), sink)
        handle_publish_measurement(context)
        for artifact in sink.publications[0]["artifacts"]:
            assert len(artifact["checksumSha256"]) == 64
            assert artifact["sizeBytes"] > 0

    def test_incomplete_branch_is_transient(self, workdir):
        context = make_context(workdir, RunKind.MEASUREMENT, {}, {}, CollectingStatusSink())
        with pytest.raises(PipelineError, match="incomplete") as exc:
            handle_publish_measurement(context)
        assert exc.value.transient is True


class TestVisualizationPublication:
    def test_publishes_splat_as_unverified(self, workdir):
        sink = CollectingStatusSink()
        prior = {
            "SPLAT_TRAINING": {"provenance": {"backend": "gsplat"}},
            "SOG_COMPRESSION": {
                "artifacts": {"sog": stored("runs/run-1/splat.sog"), "preview_sog": stored("runs/run-1/preview.sog")},
                "gaussianCount": 2_400_000,
            },
        }
        context = make_context(workdir, RunKind.VISUALIZATION, {}, prior, sink)
        handle_publish_visualization(context)

        published = sink.publications[0]
        assert published["branch"] == "VISUALIZATION"
        # A splat never carries a measurement verdict, and is never itself PASS
        # without human visual review.
        assert published["measurementQuality"] is None
        assert published["visualizationQuality"]["state"] == "UNVERIFIED"
        assert published["visualizationQuality"]["gaussianCount"] == 2_400_000
        assert {a["kind"] for a in published["artifacts"]} == {"SPLAT_SOG", "SPLAT_PREVIEW_SOG"}


class TestComparisonPublication:
    def _prior(self, registration=None):
        prior = {
            "CHANGE_COMPUTATION": {
                "method": "ELEVATION_DIFFERENCING",
                "result": {"method": "ELEVATION_DIFFERENCING", "netVolumeM3": -1200.0},
                "exploratory": False,
                "findings": ["a finding"],
                "artifacts": {"change_raster": stored("runs/run-1/change.tif")},
            }
        }
        if registration is not None:
            prior["REGISTRATION"] = registration
        return prior

    def test_publishes_result_with_sign_convention(self, workdir):
        sink = CollectingStatusSink()
        payload = {
            "comparisonId": "cmp-1",
            "baseline": {"revisionId": "rev-1"},
            "candidate": {"revisionId": "rev-2"},
        }
        context = make_context(workdir, RunKind.COMPARISON, payload, self._prior(), sink)
        handle_publish_comparison(context)

        published = sink.publications[0]
        assert published["branch"] == "COMPARISON"
        comparison = published["comparison"]
        assert comparison["comparisonId"] == "cmp-1"
        assert comparison["exploratory"] is False
        assert comparison["registrationCorrection"] is None
        assert "later minus earlier" in comparison["signConvention"]
        assert {a["kind"] for a in published["artifacts"]} == {"CHANGE_RASTER_COG", "COMPARISON_RECORD"}

    def test_applied_registration_is_reported(self, workdir):
        sink = CollectingStatusSink()
        registration = {
            "applied": True,
            "matrix": list(np.eye(4).flatten()),
            "residualRmseM": 0.012,
            "stableAreaDescription": "bedrock outcrop north of the pit",
        }
        payload = {
            "comparisonId": "cmp-1",
            "baseline": {"revisionId": "rev-1"},
            "candidate": {"revisionId": "rev-2"},
        }
        context = make_context(workdir, RunKind.COMPARISON, payload, self._prior(registration), sink)
        handle_publish_comparison(context)

        correction = sink.publications[0]["comparison"]["registrationCorrection"]
        assert correction["residualRmseM"] == 0.012
        assert correction["stableAreaDescription"] == "bedrock outcrop north of the pit"


class TestRegistrationApplication:
    def test_translation_shifts_points(self):
        matrix = np.eye(4)
        matrix[:3, 3] = [1.0, -2.0, 0.5]
        points = np.array([[0.0, 0.0, 0.0], [10.0, 10.0, 10.0]])
        moved = apply_transform_to_points(points, matrix)
        assert np.allclose(moved, [[1.0, -2.0, 0.5], [11.0, 8.0, 10.5]])

    def test_rotation_rotates_points(self):
        matrix = np.eye(4)
        # 90° about Z.
        matrix[:3, :3] = [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
        moved = apply_transform_to_points(np.array([[1.0, 0.0, 5.0]]), matrix)
        assert np.allclose(moved, [[0.0, 1.0, 5.0]])

    def test_grid_shift_moves_elevation_and_origin(self):
        grid = Grid(
            data=np.full((4, 4), 100.0),
            transform=Affine(1.0, 0.0, 500.0, 0.0, -1.0, 700.0),
            crs="EPSG:25832",
        )
        matrix = np.eye(4)
        matrix[:3, 3] = [2.0, -3.0, 0.25]
        shifted, findings = apply_transform_to_grid(grid, matrix)

        assert np.allclose(shifted.data, 100.25)
        assert shifted.transform.c == 502.0
        assert shifted.transform.f == 697.0
        assert "+0.250 m vertical" in findings[0]

    def test_rotated_correction_refuses_raster_application(self):
        grid = Grid(
            data=np.zeros((4, 4)),
            transform=Affine(1.0, 0.0, 0.0, 0.0, -1.0, 0.0),
            crs="EPSG:25832",
        )
        matrix = np.eye(4)
        matrix[:3, :3] = [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
        # Silently dropping the rotation would report a change that the
        # registration says is a reference-frame difference.
        with pytest.raises(PipelineError, match="rotation") as exc:
            apply_transform_to_grid(grid, matrix)
        assert exc.value.transient is False

    def test_shifted_grid_round_trips_through_cog(self, workdir):
        grid = Grid(
            data=np.full((8, 8), 42.0),
            transform=Affine(0.5, 0.0, 1000.0, 0.0, -0.5, 2000.0),
            crs="EPSG:25832",
        )
        matrix = np.eye(4)
        matrix[:3, 3] = [0.0, 0.0, 1.5]
        shifted, _ = apply_transform_to_grid(grid, matrix)

        path = workdir / "shifted.tif"
        write_cog(shifted, path)
        reloaded = read_grid(path)
        assert np.allclose(reloaded.data, 43.5)
        with rasterio.open(path) as src:
            assert src.crs.to_epsg() == 25832


class TestRegistrationReachesChangeComputation:
    """The estimated correction must change the reported numbers, not just
    appear in the manifest."""

    def _run(self, workdir, registration):
        store = InMemoryObjectStore()

        earlier = Grid(
            data=np.full((16, 16), 100.0),
            transform=Affine(1.0, 0.0, 0.0, 0.0, -1.0, 16.0),
            crs="EPSG:25832",
        )
        # The candidate sits a uniform 0.40 m higher. A stable-area
        # registration of -0.40 m says that offset is a datum/registration
        # difference, so the corrected comparison must report no real change.
        later = Grid(data=np.full((16, 16), 100.40), transform=earlier.transform, crs="EPSG:25832")

        for name, grid in (("earlier.tif", earlier), ("later.tif", later)):
            path = workdir / name
            write_cog(grid, path)
            store.upload_file(path, f"epochs/{name}", "image/tiff")

        payload = {
            "method": "ELEVATION_DIFFERENCING",
            "baseline": {"revisionId": "rev-1", "dsmKey": "epochs/earlier.tif", "verticalRmseM": 0.02, "crs": "EPSG:25832"},
            "candidate": {"revisionId": "rev-2", "dsmKey": "epochs/later.tif", "verticalRmseM": 0.02},
        }
        prior = {"COMPATIBILITY_CHECKS": {"exploratory": False, "notes": []}}
        if registration is not None:
            prior["REGISTRATION"] = registration

        context = StageContext(
            message=QueueMessage("run-1", RunKind.COMPARISON, "", payload),
            store=store,
            workdir=str(workdir / "stage"),
            prior_outputs=prior,
            fencing_token=1,
        )
        return handle_change_computation(context)

    def test_uncorrected_offset_is_reported_as_fill(self, workdir):
        _, _, outputs = self._run(workdir, registration=None)
        assert outputs["result"]["fillVolumeM3"] > 0
        assert outputs["result"]["netVolumeM3"] > 0

    def test_registration_removes_the_offset(self, workdir):
        matrix = np.eye(4)
        matrix[:3, 3] = [0.0, 0.0, -0.40]
        registration = {
            "applied": True,
            "matrix": list(matrix.flatten()),
            "residualRmseM": 0.005,
            "stableAreaDescription": "bedrock outcrop",
        }
        _, _, outputs = self._run(workdir, registration)

        result = outputs["result"]
        assert result["netVolumeM3"] == pytest.approx(0.0, abs=1e-6)
        assert result["affectedAreaM2"] == pytest.approx(0.0, abs=1e-6)
        assert any("registration applied" in f for f in outputs["findings"])
