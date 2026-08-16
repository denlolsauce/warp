import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .errors import PipelineError

CAPTURE_MANIFEST_FILENAME = "capture_manifest.json"


@dataclass
class CaptureEntry:
    role: str
    area_name: str


def write_capture_manifest(frames_dir: Path, entries: dict[str, CaptureEntry]) -> None:
    payload = {name: asdict(entry) for name, entry in entries.items()}
    (frames_dir / CAPTURE_MANIFEST_FILENAME).write_text(json.dumps(payload, indent=2))


def read_capture_manifest(frames_dir: Path) -> dict[str, CaptureEntry]:
    path = frames_dir / CAPTURE_MANIFEST_FILENAME
    if not path.is_file():
        raise PipelineError(
            "capture_manifest", f"missing {path} — run `portal-pipeline extract` first"
        )
    raw = json.loads(path.read_text())
    return {name: CaptureEntry(**fields) for name, fields in raw.items()}
