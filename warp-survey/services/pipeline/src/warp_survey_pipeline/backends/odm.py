"""OpenDroneMap backend stub.

Implements the interface and pure functions (request → CLI args, output mapping),
but raises NotImplementedError at execution point. Container execution lands
in the technical-validation phase.
"""

import json
import logging
from pathlib import Path

from warp_survey_pipeline.errors import PipelineError

from .base import (
    CameraRecord,
    PhotogrammetryBackend,
    ReconstructionRequest,
    ReconstructionResult,
)

logger = logging.getLogger(__name__)

# Pinned ODM container digest (to be populated during technical validation)
ODM_CONTAINER_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
ODM_VERSION = "4.5.0"  # Placeholder; actual version from container metadata


class OpenDroneMapBackend(PhotogrammetryBackend):
    """OpenDroneMap reconstruction backend."""

    @property
    def name(self) -> str:
        return "odm"

    def version(self) -> str:
        return f"odm-{ODM_VERSION}+{ODM_CONTAINER_DIGEST[:12]}"

    def _build_odm_config(self, request: ReconstructionRequest) -> dict:
        """Build ODM config dict for a reconstruction request.

        Returns:
            Dict suitable for ODM's options.json or --options JSON.
        """
        config = {
            "dsm": True,
            "dtm": False,  # Only if ground classification coverage justifies it
            "orthophoto": True,
            "pc-quality": "high",
            "use-3dmesh": False,
            "crs": request.crs,
        }

        if request.gcp_file:
            config["gcp"] = str(request.gcp_file)

        return config

    def _build_odm_cli_args(self, request: ReconstructionRequest, config: dict) -> list[str]:
        """Build ODM CLI invocation arguments.

        Args:
            request: Reconstruction request.
            config: ODM config dict.

        Returns:
            Command-line arguments for `odm` CLI (not including `odm` itself).
        """
        args = [
            "process",
            str(request.output_dir / "odm_input"),
            "--project-path", str(request.output_dir),
            "--options", json.dumps(config),
        ]
        return args

    def _map_odm_outputs(self, output_dir: Path) -> dict[str, Path | None]:
        """Map ODM output directory layout to canonical artifact paths.

        Args:
            output_dir: ODM project output directory.

        Returns:
            Dict mapping artifact names to paths (None if not produced).
        """
        georef_dir = output_dir / "odm_georeferencing"
        dem_dir = output_dir / "odm_dem"
        ortho_dir = output_dir / "odm_orthophoto"

        return {
            "dense_cloud": georef_dir / "odm_georeferenced_model.laz" if georef_dir.exists() else None,
            "dsm": dem_dir / "dsm.tif" if dem_dir.exists() else None,
            "dtm": dem_dir / "dtm.tif" if dem_dir.exists() else None,
            "orthomosaic": ortho_dir / "odm_orthophoto.tif" if ortho_dir.exists() else None,
        }

    def _parse_cameras_from_odm(self, output_dir: Path) -> list[CameraRecord]:
        """Parse camera records from ODM's reconstruction.

        Stub: returns empty list. Real implementation reads from ODM's
        cameras.json or GeoTIFF metadata.
        """
        cameras_json = output_dir / "odm_georeferencing" / "cameras.json"
        if not cameras_json.exists():
            logger.warning("cameras.json not found, returning empty camera list")
            return []

        # Stub: would parse JSON and construct CameraRecord list
        return []

    def reconstruct(self, request: ReconstructionRequest) -> ReconstructionResult:
        """Run reconstruction via OpenDroneMap.

        Note: Container execution lands in technical-validation phase.
        Currently raises NotImplementedError.

        Args:
            request: Reconstruction parameters.

        Returns:
            Reconstruction result.

        Raises:
            NotImplementedError: During technical-validation phase.
            PipelineError: On validation or data-quality failures.
        """
        # Validate inputs
        if not request.image_paths:
            raise PipelineError(
                "No input images provided",
                transient=False,
            )

        if not all(p.exists() for p in request.image_paths):
            missing = [p for p in request.image_paths if not p.exists()]
            raise PipelineError(
                f"Input images not found: {missing}",
                transient=False,
            )

        request.output_dir.mkdir(parents=True, exist_ok=True)

        # Build configuration and CLI args (pure functions, no execution)
        config = self._build_odm_config(request)
        cli_args = self._build_odm_cli_args(request, config)

        logger.info(
            "would invoke ODM: odm %s",
            " ".join(cli_args),
        )
        logger.info("ODM config: %s", json.dumps(config, indent=2))

        # Container execution stubs here until technical-validation phase
        raise NotImplementedError(
            "ODM container execution lands in the technical-validation phase. "
            "This stub validates request and builds CLI args; actual container "
            "invocation happens after measurement workflow design is approved."
        )

        # Unreachable in current phase, but structure for future:
        # artifacts = self._map_odm_outputs(request.output_dir)
        # cameras = self._parse_cameras_from_odm(request.output_dir)
        # return ReconstructionResult(
        #     cameras=cameras,
        #     dense_cloud_path=artifacts["dense_cloud"],
        #     dsm_path=artifacts["dsm"],
        #     dtm_path=artifacts["dtm"],
        #     orthomosaic_path=artifacts["orthomosaic"],
        #     quality_metrics={"mean_reprojection_error": 0.0},
        #     provenance={"odm_version": self.version()},
        # )
