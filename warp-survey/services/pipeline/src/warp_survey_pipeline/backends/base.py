"""Abstract interface for photogrammetry backends."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ReconstructionRequest:
    """Input to a photogrammetry backend.

    Attributes:
        image_paths: List of input image file paths.
        gcp_file: Optional path to GCP (ground control point) CSV.
        camera_positions: Dict of {image_name: (lat, lon, alt, std_lat, std_lon, std_alt)}.
        crs: Horizontal coordinate reference system (e.g., "EPSG:32633").
        vertical_datum: Vertical reference (e.g., "EGM96").
        units: Output units (e.g., "meters").
        output_dir: Where to write results.
    """

    image_paths: list[Path]
    gcp_file: Path | None
    camera_positions: dict[str, tuple[float, float, float, float, float, float]]
    crs: str
    vertical_datum: str
    units: str
    output_dir: Path


@dataclass(frozen=True)
class CameraRecord:
    """Reconstructed camera pose and calibration."""

    image_name: str
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    position_xyz: tuple[float, float, float]
    rotation_matrix_3x3: list[list[float]]


@dataclass(frozen=True)
class ReconstructionResult:
    """Output from a photogrammetry backend.

    Attributes:
        cameras: List of reconstructed camera poses.
        dense_cloud_path: Path to LAZ point cloud.
        dsm_path: Path to digital surface model (Cloud Optimized GeoTIFF).
        dtm_path: Path to digital terrain model, or None if not computed.
        orthomosaic_path: Path to orthomosaic.
        quality_metrics: Dict of backend-specific metrics (e.g., mean_reprojection_error).
        provenance: Dict with container_digest, package_versions.
    """

    cameras: list[CameraRecord]
    dense_cloud_path: Path
    dsm_path: Path
    dtm_path: Path | None
    orthomosaic_path: Path
    quality_metrics: dict[str, float]
    provenance: dict[str, str]


class PhotogrammetryBackend(ABC):
    """Abstract interface for reconstruction backends.

    Implementations must be idempotent: running the same request twice
    with the same output_dir should produce identical results.

    Checkpoints (independent validation points) are intentionally NOT passed
    to the backend — they are held out and used only for post-reconstruction QA.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Backend name (e.g., 'odm', 'metashape')."""
        pass

    @abstractmethod
    def version(self) -> str:
        """Backend version, including container digest or package version."""
        pass

    @abstractmethod
    def reconstruct(self, request: ReconstructionRequest) -> ReconstructionResult:
        """Run reconstruction.

        Args:
            request: Reconstruction parameters.

        Returns:
            Reconstruction result with cameras, point cloud, DSM/DTM, orthomosaic.

        Raises:
            PipelineError: On data-quality or infrastructure failures.
        """
        pass
