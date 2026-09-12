"""Report generation.

`build_report_data` produces the canonical, traceable report record: every
number carries the artifact/revision it came from. `render_report_pdf` renders
that record to a deterministic, dependency-free PDF (text-only, A4). The JSON
is the source of truth; the PDF is a rendering of it.
"""

import logging
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReportInputs:
    site_name: str
    comparison_id: str
    method: str
    baseline_revision_id: str
    baseline_captured_at: str
    candidate_revision_id: str
    candidate_captured_at: str
    sign_convention: str
    result: dict  # elevationDifferencingResult | m3c2Result shape
    exploratory: bool
    baseline_quality: dict
    candidate_quality: dict
    findings: list[str]


def build_report_data(inputs: ReportInputs) -> dict:
    """Canonical report record. Immutable once a revision is approved."""
    values: list[dict] = []

    def trace(label: str, value, unit: str, source: str) -> None:
        values.append({"label": label, "value": value, "unit": unit, "sourceRevisionId": source})

    r = inputs.result
    if inputs.method == "ELEVATION_DIFFERENCING":
        src = inputs.comparison_id
        trace("Cut volume", r.get("cutVolumeM3"), "m³", src)
        trace("Fill volume", r.get("fillVolumeM3"), "m³", src)
        trace("Net volume", r.get("netVolumeM3"), "m³", src)
        trace("Affected area", r.get("affectedAreaM2"), "m²", src)
        trace("Detection threshold", r.get("detectionThresholdM"), "m", src)
        trace("Volume uncertainty", r.get("volumeUncertaintyM3"), "m³", src)
    elif inputs.method == "M3C2":
        src = inputs.comparison_id
        trace("Mean signed surface distance", r.get("meanSignedDistanceM"), "m", src)
        trace("Significant change fraction", r.get("significantChangeFraction"), "", src)
        trace("Registration uncertainty", r.get("registrationUncertaintyM"), "m", src)

    return {
        "reportDataVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "site": inputs.site_name,
        "comparisonId": inputs.comparison_id,
        "method": inputs.method,
        "signConvention": inputs.sign_convention,
        "epochs": {
            "baseline": {
                "revisionId": inputs.baseline_revision_id,
                "capturedAt": inputs.baseline_captured_at,
                "measurementQuality": inputs.baseline_quality,
            },
            "candidate": {
                "revisionId": inputs.candidate_revision_id,
                "capturedAt": inputs.candidate_captured_at,
                "measurementQuality": inputs.candidate_quality,
            },
        },
        "values": values,
        "exploratory": inputs.exploratory,
        "findings": inputs.findings,
        "interpretationNote": (
            "Values describe surface change between the two survey epochs. They are not "
            "displacement vectors and not a slope-stability assessment."
        ),
    }


# --- minimal deterministic PDF renderer ---------------------------------------

def _pdf_escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _format_value(v) -> str:
    if v is None:
        return "not assessed"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return f"{v:,.2f}"
    return str(v)


def render_report_pdf(report_data: dict) -> bytes:
    """Render the canonical record to a single-file PDF (Helvetica, A4).

    Pure-Python and deterministic apart from the timestamp already embedded
    in report_data; no external renderer, no fonts to embed.
    """
    lines: list[tuple[str, float]] = []  # (text, font size)

    def add(text: str, size: float = 10) -> None:
        lines.append((text, size))

    add(f"Change report — {report_data['site']}", 16)
    add("", 10)
    add(f"Method: {report_data['method']}", 10)
    add(f"Comparison: {report_data['comparisonId']}", 10)
    add(f"Status: {'EXPLORATORY — not for engineering approval' if report_data['exploratory'] else 'Engineering'}", 10)
    add("", 10)
    add("Survey epochs", 12)
    for name in ("baseline", "candidate"):
        epoch = report_data["epochs"][name]
        quality = epoch.get("measurementQuality") or {}
        add(
            f"  {name.capitalize()}: revision {epoch['revisionId']}  captured {epoch['capturedAt']}  "
            f"measurement QA: {quality.get('state', 'UNVERIFIED')}",
            9,
        )
    add("", 10)
    add("Results", 12)
    for value in report_data["values"]:
        unit = f" {value['unit']}" if value["unit"] else ""
        add(f"  {value['label']}: {_format_value(value['value'])}{unit}", 10)
        add(f"    source revision: {value['sourceRevisionId']}", 7)
    add("", 10)
    add("Sign convention", 12)
    add(f"  {report_data['signConvention']}", 9)
    if report_data["findings"]:
        add("", 10)
        add("Findings and limitations", 12)
        for finding in report_data["findings"]:
            add(f"  - {finding}", 9)
    add("", 10)
    add(report_data["interpretationNote"], 8)
    add(f"Generated {report_data['generatedAt']}", 7)

    # Build the content stream.
    y = 800.0
    parts = ["BT"]
    for text, size in lines:
        y -= size * 1.5
        if y < 40:
            break  # single page is enough for the numeric summary
        parts.append(f"/F1 {size} Tf 1 0 0 1 50 {y:.1f} Tm ({_pdf_escape(text)}) Tj")
    parts.append("ET")
    stream = "\n".join(parts).encode("latin-1", errors="replace")
    compressed = zlib.compress(stream)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(compressed)).encode() + b" /Filter /FlateDecode >>\nstream\n" + compressed + b"\nendstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)
