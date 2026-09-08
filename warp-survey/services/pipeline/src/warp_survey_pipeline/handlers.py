"""Stage handlers: wire the stage implementations into the worker.

Each handler is a function of StageContext returning (metrics, artifact_keys,
outputs). Outputs land in the stage's durable completion marker; later stages
read them from context.prior_outputs, so any worker can resume any run.
"""

import json
import logging
from pathlib import Path

import numpy as np

from .backends.base import CameraRecord, ReconstructionRequest
from .backends.odm import OpenDroneMapBackend
from .backends.splat import GsplatBackend, SplatTrainingRequest
from .errors import PipelineError
from .geo import read_grid
from .pointcloud import read_laz
from .stages.checkpoint_qa import (
    Checkpoint,
    evaluate_checkpoints,
    parse_acceptance_profile,
)
from .stages.comparison import (
    SIGN_CONVENTION,
    EpochInputs,
    check_compatibility,
    comparison_is_exploratory,
    elevation_differencing,
    estimate_rigid_registration,
    m3c2,
)
from .stages.dense_products import build_dense_products
from .stages.input_validation import ControlPointInput, validate_inputs
from .stages.visualization import SogCompressor, adapt_cameras
from .storage import store_artifact
from .worker import StageContext

logger = logging.getLogger(__name__)


def _workdir(context: StageContext, stage: str) -> Path:
    p = Path(context.workdir) / stage.lower()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _download_inputs(context: StageContext, keys: list[str], dest: Path) -> list[Path]:
    paths = []
    for key in keys:
        local = dest / Path(key).name
        if not local.exists():
            context.store.download_file(key, local)
        paths.append(local)
    return paths


def _control_points(payload: dict) -> list[ControlPointInput]:
    return [
        ControlPointInput(
            label=cp["label"],
            role=cp["role"],
            easting=float(cp["easting"]),
            northing=float(cp["northing"]),
            elevation=float(cp["elevation"]),
            observations=cp.get("observations"),
        )
        for cp in payload.get("controlPoints", [])
    ]


# --- MEASUREMENT branch ---------------------------------------------------------

def handle_input_validation(context: StageContext):
    payload = context.message.payload
    workdir = _workdir(context, "INPUT_VALIDATION")
    image_keys = payload.get("imageKeys", [])
    images = _download_inputs(context, image_keys, workdir / "images")
    camera_positions = {
        name: tuple(vals) for name, vals in payload.get("cameraPositions", {}).items()
    }
    result = validate_inputs(images, camera_positions, _control_points(payload))
    metrics = {
        "imageCount": result.image_count,
        "gcpCount": result.gcp_count,
        "checkpointCount": result.checkpoint_count,
        "hasCameraPositions": result.has_camera_positions,
    }
    outputs = {"imageKeys": image_keys, "warnings": result.warnings}
    return metrics, [], outputs


def handle_reconstruction(context: StageContext):
    payload = context.message.payload
    workdir = _workdir(context, "RECONSTRUCTION")
    images = _download_inputs(context, payload.get("imageKeys", []), workdir / "images_src")

    gcps = [c for c in _control_points(payload) if c.role == "GCP"]
    gcp_file = None
    if gcps:
        # ODM gcp_list.txt: CRS header, then easting northing elevation pixel_x
        # pixel_y image name. INPUT_VALIDATION has already rejected unmarked GCPs.
        gcp_file = workdir / "gcp_list.txt"
        lines = [payload.get("crs", "EPSG:4326")]
        for g in gcps:
            for observation in g.observations or []:
                try:
                    image_name = observation["imageName"]
                    x = float(observation["x"])
                    y = float(observation["y"])
                except (KeyError, TypeError, ValueError) as e:
                    raise PipelineError(
                        f"GCP {g.label} has an invalid image observation ({e})", transient=False
                    ) from e
                lines.append(f"{g.easting} {g.northing} {g.elevation} {x} {y} {image_name} {g.label}")
        gcp_file.write_text("\n".join(lines) + "\n")

    request = ReconstructionRequest(
        image_paths=images,
        gcp_file=gcp_file,
        camera_positions={k: tuple(v) for k, v in payload.get("cameraPositions", {}).items()},
        crs=payload.get("crs", "EPSG:4326"),
        vertical_datum=payload.get("verticalDatum", "ELLIPSOIDAL"),
        units=payload.get("units", "metre"),
        output_dir=workdir / "odm",
    )
    backend = OpenDroneMapBackend()
    result = backend.reconstruct(request)

    run_id = context.message.run_id
    prefix = f"runs/{run_id}/RECONSTRUCTION"
    stored = {}
    for name, path, ctype in [
        ("dense_cloud", result.dense_cloud_path, "application/vnd.laszip"),
        ("dsm_raw", result.dsm_path, "image/tiff"),
        ("dtm_raw", result.dtm_path, "image/tiff"),
        ("orthomosaic_raw", result.orthomosaic_path, "image/tiff"),
    ]:
        if path is None:
            continue
        artifact = store_artifact(context.store, path, f"{prefix}/{path.name}", ctype)
        stored[name] = {"key": artifact.storage_key, "sha256": artifact.checksum_sha256, "size": artifact.size_bytes}

    cameras_path = workdir / "cameras_reconstructed.json"
    cameras_path.write_text(json.dumps([c.__dict__ for c in result.cameras]))
    cam_art = store_artifact(context.store, cameras_path, f"{prefix}/cameras_reconstructed.json", "application/json")
    stored["cameras"] = {"key": cam_art.storage_key, "sha256": cam_art.checksum_sha256, "size": cam_art.size_bytes}

    metrics = {k: v for k, v in result.quality_metrics.items()}
    metrics["backendVersion"] = backend.version()
    outputs = {"artifacts": stored, "provenance": result.provenance, "metrics": metrics}
    return metrics, [a["key"] for a in stored.values()], outputs


def handle_dense_products(context: StageContext):
    recon = context.prior_outputs.get("RECONSTRUCTION")
    if not recon:
        raise PipelineError("RECONSTRUCTION outputs are missing", transient=True)
    workdir = _workdir(context, "DENSE_PRODUCTS")

    arts = recon["artifacts"]
    dsm_local = workdir / "dsm_raw.tif"
    context.store.download_file(arts["dsm_raw"]["key"], dsm_local)
    dtm_local = None
    if "dtm_raw" in arts:
        dtm_local = workdir / "dtm_raw.tif"
        context.store.download_file(arts["dtm_raw"]["key"], dtm_local)
    ortho_local = None
    if "orthomosaic_raw" in arts:
        ortho_local = workdir / "ortho_raw.tif"
        context.store.download_file(arts["orthomosaic_raw"]["key"], ortho_local)

    result = build_dense_products(dsm_local, dtm_local, ortho_local, workdir / "out")

    run_id = context.message.run_id
    prefix = f"runs/{run_id}/DENSE_PRODUCTS"
    stored = {}
    for name, path, ctype in [
        ("dsm", result.dsm_cog, "image/tiff; application=geotiff; profile=cloud-optimized"),
        ("dtm", result.dtm_cog, "image/tiff; application=geotiff; profile=cloud-optimized"),
        ("orthomosaic", result.orthomosaic_cog, "image/tiff; application=geotiff; profile=cloud-optimized"),
        ("coverage_mask", result.coverage_mask_cog, "image/tiff; application=geotiff; profile=cloud-optimized"),
    ]:
        if path is None:
            continue
        artifact = store_artifact(context.store, path, f"{prefix}/{path.name}", ctype)
        stored[name] = {"key": artifact.storage_key, "sha256": artifact.checksum_sha256, "size": artifact.size_bytes}

    metrics = {
        "dsmValidFraction": round(result.dsm_valid_fraction, 4),
        "resolutionM": result.resolution_m,
        "dtmPublished": result.dtm_cog is not None,
    }
    if result.dtm_withheld_reason:
        metrics["dtmWithheldReason"] = result.dtm_withheld_reason
    outputs = {
        "artifacts": stored,
        "bounds": list(result.bounds),
        "resolutionM": result.resolution_m,
        "dtmWithheldReason": result.dtm_withheld_reason,
    }
    return metrics, [a["key"] for a in stored.values()], outputs


def handle_checkpoint_qa(context: StageContext):
    payload = context.message.payload
    dense = context.prior_outputs.get("DENSE_PRODUCTS")
    recon = context.prior_outputs.get("RECONSTRUCTION")
    if not dense:
        raise PipelineError("DENSE_PRODUCTS outputs are missing", transient=True)
    workdir = _workdir(context, "CHECKPOINT_QA")

    dsm_local = workdir / "dsm.tif"
    context.store.download_file(dense["artifacts"]["dsm"]["key"], dsm_local)
    dsm = read_grid(dsm_local)

    dense_points = None
    if recon and "dense_cloud" in recon.get("artifacts", {}):
        cloud_local = workdir / "cloud.laz"
        context.store.download_file(recon["artifacts"]["dense_cloud"]["key"], cloud_local)
        dense_points = read_laz(cloud_local)

    checkpoints = [
        Checkpoint(label=c.label, easting=c.easting, northing=c.northing, elevation=c.elevation)
        for c in _control_points(payload)
        if c.role == "CHECKPOINT"
    ]
    profile = parse_acceptance_profile(payload.get("acceptanceProfile"))
    registration_rate = (recon or {}).get("metrics", {}).get("registration_rate")

    result = evaluate_checkpoints(dsm, checkpoints, profile, registration_rate, dense_points)

    quality_record = {
        "state": result.state,
        "checkpoints": result.to_contract(),
        "findings": result.findings,
        "residuals": result.residuals,
        "acceptanceProfileId": profile.profile_id if profile else None,
        "acceptanceProfileVersion": profile.version if profile else None,
    }
    record_path = workdir / "quality_record.json"
    record_path.write_text(json.dumps(quality_record, indent=2))
    artifact = store_artifact(
        context.store, record_path,
        f"runs/{context.message.run_id}/CHECKPOINT_QA/quality_record.json",
        "application/json",
    )

    metrics = {
        "state": result.state,
        "checkpointCount": result.count,
        "verticalRmseM": result.vertical_rmse_m,
        "verticalBiasM": result.vertical_bias_m,
    }
    outputs = {"quality": quality_record, "artifactKey": artifact.storage_key}

    if result.state == "FAIL":
        raise PipelineError(
            "measurement QA failed: " + "; ".join(f for f in result.findings if "distribution" not in f),
            transient=False,
        )
    return metrics, [artifact.storage_key], outputs


def handle_publish_measurement(context: StageContext):
    """Assemble the revision summary the web app persists as a SurveyRevision."""
    dense = context.prior_outputs.get("DENSE_PRODUCTS")
    qa = context.prior_outputs.get("CHECKPOINT_QA")
    recon = context.prior_outputs.get("RECONSTRUCTION")
    if not (dense and qa and recon):
        raise PipelineError("earlier measurement stages are incomplete", transient=True)

    summary = {
        "surveyId": context.message.survey_id,
        "runId": context.message.run_id,
        "measurementQuality": qa["quality"],
        "artifacts": {**recon["artifacts"], **dense["artifacts"]},
        "bounds": dense["bounds"],
        "resolutionM": dense["resolutionM"],
        "provenance": recon["provenance"],
    }
    workdir = _workdir(context, "PUBLISH_MEASUREMENT")
    path = workdir / "revision_summary.json"
    path.write_text(json.dumps(summary, indent=2))
    artifact = store_artifact(
        context.store, path,
        f"runs/{context.message.run_id}/PUBLISH_MEASUREMENT/revision_summary.json",
        "application/json",
    )
    return {"published": True}, [artifact.storage_key], {"summaryKey": artifact.storage_key}


# --- VISUALIZATION branch --------------------------------------------------------

def handle_camera_adaptation(context: StageContext):
    payload = context.message.payload
    workdir = _workdir(context, "CAMERA_ADAPTATION")

    cameras_key = payload.get("camerasArtifactKey")
    if not cameras_key:
        raise PipelineError(
            "visualization requires the measurement run's reconstructed cameras (camerasArtifactKey)",
            transient=False,
        )
    cameras_local = workdir / "cameras_reconstructed.json"
    context.store.download_file(cameras_key, cameras_local)
    raw = json.loads(cameras_local.read_text())
    cameras = [
        CameraRecord(
            image_name=c["image_name"], fx=c["fx"], fy=c["fy"], cx=c["cx"], cy=c["cy"],
            width=c["width"], height=c["height"],
            position_xyz=tuple(c["position_xyz"]), rotation_matrix_3x3=c["rotation_matrix_3x3"],
        )
        for c in raw
    ]
    local_origin = tuple(payload.get("localOrigin", [0.0, 0.0, 0.0]))
    adapted_path = workdir / "cameras_local.json"
    info = adapt_cameras(cameras, local_origin, adapted_path)
    artifact = store_artifact(
        context.store, adapted_path,
        f"runs/{context.message.run_id}/CAMERA_ADAPTATION/cameras_local.json",
        "application/json",
    )
    outputs = {"camerasKey": artifact.storage_key, **info}
    return {"cameraCount": info["cameraCount"]}, [artifact.storage_key], outputs


def handle_splat_training(context: StageContext):
    payload = context.message.payload
    adaptation = context.prior_outputs.get("CAMERA_ADAPTATION")
    if not adaptation:
        raise PipelineError("CAMERA_ADAPTATION outputs are missing", transient=True)
    workdir = _workdir(context, "SPLAT_TRAINING")

    cameras_local = workdir / "cameras_local.json"
    context.store.download_file(adaptation["camerasKey"], cameras_local)
    images = _download_inputs(context, payload.get("imageKeys", []), workdir / "images")
    if not images:
        raise PipelineError("no training images supplied", transient=False)

    backend = GsplatBackend()
    result = backend.train(
        SplatTrainingRequest(
            cameras_json=cameras_local,
            images_dir=workdir / "images",
            output_dir=workdir / "out",
        )
    )
    artifact = store_artifact(
        context.store, result.ply_path,
        f"runs/{context.message.run_id}/SPLAT_TRAINING/splat.ply",
        "application/octet-stream",
    )
    metrics = {"gaussianCount": result.gaussian_count, "backendVersion": backend.version()}
    outputs = {"plyKey": artifact.storage_key, "gaussianCount": result.gaussian_count, "provenance": result.provenance}
    return metrics, [artifact.storage_key], outputs


def handle_terrain_safe_cleanup(context: StageContext):
    """Prune floaters from the trained PLY (removal-only, geometry untouched)."""
    from .stages.visualization import terrain_safe_cleanup
    from .splat_ply import read_gaussian_ply, write_gaussian_ply

    training = context.prior_outputs.get("SPLAT_TRAINING")
    if not training:
        raise PipelineError("SPLAT_TRAINING outputs are missing", transient=True)
    workdir = _workdir(context, "TERRAIN_SAFE_CLEANUP")

    ply_local = workdir / "splat.ply"
    context.store.download_file(training["plyKey"], ply_local)
    splat = read_gaussian_ply(ply_local)

    result = terrain_safe_cleanup(
        positions=splat.positions,
        opacities=splat.opacities,
        scales=splat.scales,
    )
    cleaned_path = workdir / "splat_clean.ply"
    write_gaussian_ply(splat.filtered(result.kept), cleaned_path)

    artifact = store_artifact(
        context.store, cleaned_path,
        f"runs/{context.message.run_id}/TERRAIN_SAFE_CLEANUP/splat_clean.ply",
        "application/octet-stream",
    )
    metrics = {
        "kept": int(result.kept.sum()),
        "removedLowOpacity": result.removed_low_opacity,
        "removedOversized": result.removed_oversized,
        "removedIsolated": result.removed_isolated,
    }
    outputs = {"plyKey": artifact.storage_key, "gaussianCount": int(result.kept.sum())}
    return metrics, [artifact.storage_key], outputs


def handle_sog_compression(context: StageContext):
    cleanup = context.prior_outputs.get("TERRAIN_SAFE_CLEANUP")
    if not cleanup:
        raise PipelineError("TERRAIN_SAFE_CLEANUP outputs are missing", transient=True)
    workdir = _workdir(context, "SOG_COMPRESSION")

    ply_local = workdir / "splat_clean.ply"
    context.store.download_file(cleanup["plyKey"], ply_local)

    compressor = SogCompressor()
    sogs = compressor.compress(ply_local, workdir / "out")

    prefix = f"runs/{context.message.run_id}/SOG_COMPRESSION"
    stored = {}
    for name, path in sogs.items():
        artifact = store_artifact(context.store, path, f"{prefix}/{path.name}", "application/octet-stream")
        stored[name] = {"key": artifact.storage_key, "sha256": artifact.checksum_sha256, "size": artifact.size_bytes}
    metrics = {"compressorVersion": compressor.version()}
    outputs = {"artifacts": stored, "gaussianCount": cleanup["gaussianCount"]}
    return metrics, [a["key"] for a in stored.values()], outputs


def handle_publish_visualization(context: StageContext):
    sog = context.prior_outputs.get("SOG_COMPRESSION")
    if not sog:
        raise PipelineError("SOG_COMPRESSION outputs are missing", transient=True)
    summary = {
        "surveyId": context.message.survey_id,
        "runId": context.message.run_id,
        "visualizationQuality": {
            "state": "UNVERIFIED",
            "gaussianCount": sog["gaussianCount"],
            "findings": ["visual QA is a human review step; the splat is never a measurement product"],
        },
        "artifacts": sog["artifacts"],
    }
    workdir = _workdir(context, "PUBLISH_VISUALIZATION")
    path = workdir / "visualization_summary.json"
    path.write_text(json.dumps(summary, indent=2))
    artifact = store_artifact(
        context.store, path,
        f"runs/{context.message.run_id}/PUBLISH_VISUALIZATION/visualization_summary.json",
        "application/json",
    )
    return {"published": True}, [artifact.storage_key], {"summaryKey": artifact.storage_key}


# --- COMPARISON branch -------------------------------------------------------------

def _epoch_inputs(raw: dict) -> EpochInputs:
    return EpochInputs(
        revision_id=raw["revisionId"],
        crs=raw["crs"],
        vertical_datum_id=raw["verticalDatumId"],
        measurement_state=raw.get("measurementState", "UNVERIFIED"),
        vertical_rmse_m=raw.get("verticalRmseM"),
    )


def handle_compatibility_checks(context: StageContext):
    payload = context.message.payload
    baseline = _epoch_inputs(payload["baseline"])
    candidate = _epoch_inputs(payload["candidate"])

    failures = check_compatibility(baseline, candidate)
    if failures:
        raise PipelineError("comparison is not computable: " + "; ".join(failures), transient=False)

    exploratory, notes = comparison_is_exploratory(baseline, candidate)
    metrics = {"exploratory": exploratory}
    outputs = {"exploratory": exploratory, "notes": notes}
    return metrics, [], outputs


def handle_registration(context: StageContext):
    """Optional rigid correction estimated on approved stable areas."""
    payload = context.message.payload
    stable_pairs = payload.get("stablePointPairs")  # [{moving: [x,y,z], fixed: [x,y,z]}]
    if not stable_pairs:
        outputs = {"applied": False, "note": "no stable-area registration requested"}
        return {"applied": False}, [], outputs

    moving = np.array([p["moving"] for p in stable_pairs], dtype=np.float64)
    fixed = np.array([p["fixed"] for p in stable_pairs], dtype=np.float64)
    matrix, rmse = estimate_rigid_registration(moving, fixed)
    outputs = {
        "applied": True,
        "matrix": matrix.flatten().tolist(),
        "residualRmseM": rmse,
        "stableAreaDescription": payload.get("stableAreaDescription", "user-selected stable points"),
    }
    return {"applied": True, "residualRmseM": rmse}, [], outputs


def handle_change_computation(context: StageContext):
    from .geo import Grid, write_cog
    from .pointcloud import write_laz

    payload = context.message.payload
    compat = context.prior_outputs.get("COMPATIBILITY_CHECKS", {})
    workdir = _workdir(context, "CHANGE_COMPUTATION")
    method = payload.get("method", "ELEVATION_DIFFERENCING")
    prefix = f"runs/{context.message.run_id}/CHANGE_COMPUTATION"

    baseline_rmse = payload["baseline"].get("verticalRmseM")
    candidate_rmse = payload["candidate"].get("verticalRmseM")

    if method == "ELEVATION_DIFFERENCING":
        earlier_local = workdir / "earlier_dsm.tif"
        later_local = workdir / "later_dsm.tif"
        context.store.download_file(payload["baseline"]["dsmKey"], earlier_local)
        context.store.download_file(payload["candidate"]["dsmKey"], later_local)
        aoi = tuple(payload["areaOfInterest"]) if payload.get("areaOfInterest") else None

        result = elevation_differencing(
            read_grid(earlier_local), read_grid(later_local),
            baseline_rmse, candidate_rmse, aoi,
        )
        change_path = workdir / "change.tif"
        write_cog(result.change, change_path)
        artifact = store_artifact(
            context.store, change_path, f"{prefix}/change.tif",
            "image/tiff; application=geotiff; profile=cloud-optimized",
        )
        contract_result = {
            "method": "ELEVATION_DIFFERENCING",
            "gridResolutionM": result.change.resolution,
            "cutVolumeM3": result.cut_volume_m3,
            "fillVolumeM3": result.fill_volume_m3,
            "netVolumeM3": result.net_volume_m3,
            "affectedAreaM2": result.affected_area_m2,
            "volumeUncertaintyM3": result.volume_uncertainty_m3,
            "detectionThresholdM": result.detection_threshold_m,
        }
        metrics = {
            "cutVolumeM3": result.cut_volume_m3,
            "fillVolumeM3": result.fill_volume_m3,
            "netVolumeM3": result.net_volume_m3,
        }
        findings = result.findings
        artifact_keys = [artifact.storage_key]
        artifacts = {"change_raster": {"key": artifact.storage_key, "sha256": artifact.checksum_sha256}}
    elif method == "M3C2":
        earlier_local = workdir / "earlier.laz"
        later_local = workdir / "later.laz"
        context.store.download_file(payload["baseline"]["cloudKey"], earlier_local)
        context.store.download_file(payload["candidate"]["cloudKey"], later_local)
        params = payload.get("m3c2Parameters", {})
        registration = context.prior_outputs.get("REGISTRATION", {})

        result = m3c2(
            read_laz(earlier_local), read_laz(later_local),
            normal_radius=float(params.get("normalRadiusM", 2.0)),
            projection_radius=float(params.get("projectionRadiusM", 1.0)),
            max_depth=float(params.get("maxDepthM", 10.0)),
            registration_error_m=float(registration.get("residualRmseM", 0.0)),
        )
        cloud_path = workdir / "m3c2.laz"
        crs = payload["baseline"].get("crs", "")
        epsg = int(crs.split(":")[1]) if crs.startswith("EPSG:") else None
        write_laz(
            result.core_points, cloud_path, crs_epsg=epsg,
            extra_dims={
                "m3c2_distance": np.nan_to_num(result.distances, nan=-9999.0),
                "m3c2_lod": np.nan_to_num(result.lod, nan=-9999.0),
                "m3c2_significant": result.significant.astype(np.float64),
            },
        )
        artifact = store_artifact(context.store, cloud_path, f"{prefix}/m3c2.laz", "application/vnd.laszip")
        contract_result = {
            "method": "M3C2",
            "parameters": result.parameters,
            "meanSignedDistanceM": result.mean_signed_distance_m,
            "significantChangeFraction": result.significant_change_fraction,
            "registrationUncertaintyM": registration.get("residualRmseM"),
        }
        metrics = {
            "meanSignedDistanceM": result.mean_signed_distance_m,
            "significantChangeFraction": result.significant_change_fraction,
        }
        findings = result.findings
        artifact_keys = [artifact.storage_key]
        artifacts = {"m3c2_cloud": {"key": artifact.storage_key, "sha256": artifact.checksum_sha256}}
    else:
        raise PipelineError(f"unknown comparison method: {method}", transient=False)

    outputs = {
        "method": method,
        "result": contract_result,
        "signConvention": SIGN_CONVENTION,
        "exploratory": compat.get("exploratory", True),
        "findings": findings + compat.get("notes", []),
        "artifacts": artifacts,
    }
    return metrics, artifact_keys, outputs


def handle_publish_comparison(context: StageContext):
    change = context.prior_outputs.get("CHANGE_COMPUTATION")
    if not change:
        raise PipelineError("CHANGE_COMPUTATION outputs are missing", transient=True)
    payload = context.message.payload

    record = {
        "comparisonId": payload.get("comparisonId"),
        "runId": context.message.run_id,
        "baselineRevisionId": payload["baseline"]["revisionId"],
        "candidateRevisionId": payload["candidate"]["revisionId"],
        **{k: change[k] for k in ("method", "result", "signConvention", "exploratory", "findings", "artifacts")},
    }
    workdir = _workdir(context, "PUBLISH_COMPARISON")
    path = workdir / "comparison_record.json"
    path.write_text(json.dumps(record, indent=2))
    artifact = store_artifact(
        context.store, path,
        f"runs/{context.message.run_id}/PUBLISH_COMPARISON/comparison_record.json",
        "application/json",
    )
    return {"published": True}, [artifact.storage_key], {"recordKey": artifact.storage_key}


DEFAULT_HANDLERS = {
    "INPUT_VALIDATION": handle_input_validation,
    "RECONSTRUCTION": handle_reconstruction,
    "DENSE_PRODUCTS": handle_dense_products,
    "CHECKPOINT_QA": handle_checkpoint_qa,
    "PUBLISH_MEASUREMENT": handle_publish_measurement,
    "CAMERA_ADAPTATION": handle_camera_adaptation,
    "SPLAT_TRAINING": handle_splat_training,
    "TERRAIN_SAFE_CLEANUP": handle_terrain_safe_cleanup,
    "SOG_COMPRESSION": handle_sog_compression,
    "PUBLISH_VISUALIZATION": handle_publish_visualization,
    "COMPATIBILITY_CHECKS": handle_compatibility_checks,
    "REGISTRATION": handle_registration,
    "CHANGE_COMPUTATION": handle_change_computation,
    "PUBLISH_COMPARISON": handle_publish_comparison,
}
