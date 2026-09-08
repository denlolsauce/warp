"""OpenDroneMap backend.

Runs ODM in its pinned container and adapts the documented output layout
(odm_georeferencing / odm_dem / odm_orthophoto, cameras + shots JSON) into
Warp's own contracts. Nothing outside this module knows ODM paths.
"""

import json
import logging
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

from warp_survey_pipeline.errors import PipelineError

from .base import (
    CameraRecord,
    PhotogrammetryBackend,
    ReconstructionRequest,
    ReconstructionResult,
)

logger = logging.getLogger(__name__)

# Pinned container. Update deliberately and record the digest in provenance.
ODM_IMAGE = "opendronemap/odm"
ODM_VERSION = "3.5.5"
ODM_CONTAINER_DIGEST = "sha256:7351ed8d55a1b8ce9b1394b2ae95bd5202384d636af15bb531a5ab0a147d7f76"

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _default_runner(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


class OpenDroneMapBackend(PhotogrammetryBackend):
    """OpenDroneMap reconstruction backend (pinned container)."""

    def __init__(self, runner: Runner | None = None, image: str | None = None):
        self._runner = runner or _default_runner
        self._image = image or f"{ODM_IMAGE}@{ODM_CONTAINER_DIGEST}"

    @property
    def name(self) -> str:
        return "odm"

    def version(self) -> str:
        return f"odm-{ODM_VERSION}+{ODM_CONTAINER_DIGEST[7:19]}"

    def _build_odm_config(self, request: ReconstructionRequest) -> dict:
        """ODM flag set for engineering terrain. No object-centric cleanup,
        no arbitrary normalization — outputs stay georeferenced."""
        config = {
            "dsm": True,
            # DTM is produced only when ground classification justifies it;
            # requesting it here lets the DENSE_PRODUCTS stage decide whether
            # coverage qualifies it for publication.
            "dtm": True,
            "orthophoto-resolution": 2.0,  # cm/px cap; ODM clamps to GSD
            "pc-quality": "high",
            "dem-resolution": 5.0,  # cm/px cap; clamped to GSD
            "use-3dmesh": False,
            "crop": 0,
            "auto-boundary": True,
        }
        if request.gcp_file:
            config["gcp"] = str(request.gcp_file)
        if request.camera_positions:
            # Corrected positions come in via geo.txt in the images dir;
            # force-gps trusts them over EXIF.
            config["force-gps"] = True
        return config

    def _build_odm_cli_args(self, request: ReconstructionRequest, config: dict) -> list[str]:
        """Container invocation. The project dir is mounted at /datasets/code
        with images at /datasets/code/images (ODM's expected layout)."""
        args = [
            "docker", "run", "--rm",
            "-v", f"{request.output_dir}:/datasets/code",
            self._image,
            "--project-path", "/datasets",
        ]
        for key, value in config.items():
            if value is True:
                args.append(f"--{key}")
            elif value is False or value is None:
                continue
            elif key == "gcp":
                args.extend(["--gcp", "/datasets/code/gcp_list.txt"])
            else:
                args.extend([f"--{key}", str(value)])
        return args

    def _map_odm_outputs(self, output_dir: Path) -> dict[str, Path | None]:
        """Map ODM's documented output layout to canonical artifact paths."""
        candidates = {
            "dense_cloud": output_dir / "odm_georeferencing" / "odm_georeferenced_model.laz",
            "dsm": output_dir / "odm_dem" / "dsm.tif",
            "dtm": output_dir / "odm_dem" / "dtm.tif",
            "orthomosaic": output_dir / "odm_orthophoto" / "odm_orthophoto.tif",
        }
        return {name: (path if path.exists() else None) for name, path in candidates.items()}

    def _parse_cameras_from_odm(self, output_dir: Path) -> list[CameraRecord]:
        """Parse reconstructed cameras from ODM's shots.geojson + cameras.json."""
        shots_path = output_dir / "odm_report" / "shots.geojson"
        cameras_path = output_dir / "cameras.json"
        if not shots_path.exists():
            logger.warning("shots.geojson not found; returning empty camera list")
            return []

        calibrations: dict[str, dict] = {}
        if cameras_path.exists():
            calibrations = json.loads(cameras_path.read_text())

        records: list[CameraRecord] = []
        shots = json.loads(shots_path.read_text())
        for feature in shots.get("features", []):
            props = feature.get("properties", {})
            image_name = props.get("filename")
            translation = props.get("translation")
            rotation = props.get("rotation")
            if not image_name or translation is None or rotation is None:
                continue
            calib = next(iter(calibrations.values()), {}) if calibrations else {}
            width = int(calib.get("width", props.get("width", 0)) or 0)
            height = int(calib.get("height", props.get("height", 0)) or 0)
            focal = float(calib.get("focal_x", calib.get("focal", 0.0)) or 0.0)
            # OpenSfM normalizes focal by max(width, height).
            scale = max(width, height) or 1
            records.append(
                CameraRecord(
                    image_name=image_name,
                    fx=focal * scale,
                    fy=float(calib.get("focal_y", calib.get("focal", 0.0)) or 0.0) * scale,
                    cx=width / 2.0 + float(calib.get("c_x", 0.0) or 0.0) * scale,
                    cy=height / 2.0 + float(calib.get("c_y", 0.0) or 0.0) * scale,
                    width=width,
                    height=height,
                    position_xyz=tuple(float(v) for v in translation[:3]),
                    rotation_matrix_3x3=_rodrigues(rotation),
                )
            )
        return records

    def _write_geo_file(self, request: ReconstructionRequest) -> None:
        """Write ODM geo.txt with corrected camera positions + accuracies."""
        if not request.camera_positions:
            return
        images_dir = request.output_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        lines = ["EPSG:4326"]
        for name, (lat, lon, alt, std_lat, std_lon, std_alt) in request.camera_positions.items():
            horiz = max(std_lat, std_lon)
            lines.append(f"{name} {lon} {lat} {alt} 0 0 0 {horiz} {std_alt}")
        (images_dir.parent / "geo.txt").write_text("\n".join(lines) + "\n")

    def reconstruct(self, request: ReconstructionRequest) -> ReconstructionResult:
        if not request.image_paths:
            raise PipelineError("No input images provided", transient=False)

        missing = [p for p in request.image_paths if not p.exists()]
        if missing:
            raise PipelineError(f"Input images not found: {missing}", transient=False)

        request.output_dir.mkdir(parents=True, exist_ok=True)
        images_dir = request.output_dir / "images"
        images_dir.mkdir(exist_ok=True)
        for src in request.image_paths:
            dst = images_dir / src.name
            if not dst.exists():
                try:
                    dst.hardlink_to(src)
                except OSError:
                    dst.write_bytes(src.read_bytes())

        if request.gcp_file:
            # ODM resolves --gcp inside its mounted project directory.
            shutil.copyfile(request.gcp_file, request.output_dir / "gcp_list.txt")
        self._write_geo_file(request)
        config = self._build_odm_config(request)
        cli_args = self._build_odm_cli_args(request, config)
        logger.info("invoking ODM: %s", " ".join(cli_args))

        proc = self._runner(cli_args)
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "")[-2000:]
            raise PipelineError(
                f"OpenDroneMap reconstruction failed (exit {proc.returncode}). Last output: {tail}",
                # ODM failures are usually data-quality (insufficient overlap,
                # texture) — surface them for input revision, not blind retry.
                transient=False,
            )

        artifacts = self._map_odm_outputs(request.output_dir)
        if artifacts["dense_cloud"] is None or artifacts["dsm"] is None:
            produced = [k for k, v in artifacts.items() if v is not None]
            raise PipelineError(
                f"ODM finished but required outputs are missing (got: {produced or 'none'}). "
                "The reconstruction likely failed to register enough images.",
                transient=False,
            )

        cameras = self._parse_cameras_from_odm(request.output_dir)
        registered = len(cameras)
        total = len(request.image_paths)
        return ReconstructionResult(
            cameras=cameras,
            dense_cloud_path=artifacts["dense_cloud"],
            dsm_path=artifacts["dsm"],
            dtm_path=artifacts["dtm"],
            orthomosaic_path=artifacts["orthomosaic"],
            quality_metrics={
                "registered_images": float(registered),
                "total_images": float(total),
                "registration_rate": registered / total if total else 0.0,
            },
            provenance={
                "backend": self.name,
                "odm_version": ODM_VERSION,
                "container_digest": ODM_CONTAINER_DIGEST,
                "container_image": self._image,
            },
        )


def _rodrigues(rvec: list[float]) -> list[list[float]]:
    """Axis-angle → 3x3 rotation matrix (OpenSfM stores axis-angle)."""
    import numpy as np

    r = np.asarray(rvec[:3], dtype=np.float64)
    theta = float(np.linalg.norm(r))
    if theta < 1e-12:
        return np.eye(3).tolist()
    k = r / theta
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    rot = np.eye(3) + np.sin(theta) * kx + (1 - np.cos(theta)) * (kx @ kx)
    return rot.tolist()
