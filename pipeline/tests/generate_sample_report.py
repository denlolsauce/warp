"""Generate a real change report for cross-language schema validation.

`packages/schema`'s ChangeReportSchema is the contract between this Python
stage and the TypeScript that renders a survey. Nothing enforces it across
the language boundary except actually running one side's output through the
other's validator — see packages/schema/scripts/validateChangeReport.mjs.

Usage (from pipeline/, with the venv active):
    python tests/generate_sample_report.py <output-dir>
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from geo_fixtures import displace_disc, slope_surface  # noqa: E402
from ply_fixtures import write_gaussian_ply_at_positions  # noqa: E402
from splat_pipeline.geo.survey import load_control_points, run_survey  # noqa: E402

OPAQUE_LOGIT = float(np.log(0.9 / 0.1))
UNITS_PER_METRE = 0.4
CONTROL_LAYOUT = np.array([[0.0, 0.0, 0.0], [18.0, 1.0, 9.0], [1.0, 18.0, 0.5], [15.0, 16.0, 7.5]])


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    baseline = slope_surface(n=20000, extent_m=20.0, seed=200)
    # One loss and one gain, so the generated report exercises both
    # directions of finding rather than only the common one.
    repeat = displace_disc(baseline, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.40)
    repeat = displace_disc(repeat, centre_xy=(4.0, 15.0), radius_m=2.0, displacement_m=0.25)

    for name, cloud in (("baseline", baseline), ("repeat", repeat)):
        write_gaussian_ply_at_positions(
            out_dir / f"{name}.ply",
            [tuple(point * UNITS_PER_METRE) for point in cloud],
            opacity_logit=OPAQUE_LOGIT,
        )
        (out_dir / f"{name}-gcps.json").write_text(
            json.dumps(
                {
                    "points": [
                        {
                            "label": f"GCP{index + 1}",
                            "local": list(point * UNITS_PER_METRE),
                            "world": list(point),
                        }
                        for index, point in enumerate(CONTROL_LAYOUT)
                    ]
                }
            )
        )

    result = run_survey(
        out_dir / "baseline.ply",
        out_dir / "repeat.ply",
        load_control_points(out_dir / "baseline-gcps.json"),
        load_control_points(out_dir / "repeat-gcps.json"),
    )
    report = result.as_report(baseline_label="2026-03-14", repeat_label="2026-04-25")
    (out_dir / "change-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "work/sample-survey"))
