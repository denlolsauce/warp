import csv
import json
from pathlib import Path
import subprocess
import sys

import pytest

HERE = Path(__file__).resolve().parents[1]


def test_headless_cli_exports_consistent_replay_and_trials(tmp_path):
    config = {"width_m": 1000, "height_m": 1000, "base": [500, 1000], "swath_m": 120}
    source = tmp_path / "input.json"
    source.write_text(json.dumps(config))
    output = tmp_path / "output"
    result = subprocess.run([sys.executable, str(HERE / "run.py"), "--config", str(source),
        "--output", str(output), "--partition-cells", "10", "--trials", "4"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads((output / "report.json").read_text())
    assert report["validation"]["feasible"]
    assert report["baseline_validation"]["feasible"]
    assert report["validation"]["uncovered_m2"] <= 1
    assert len(report["routes"]) == 5
    assert report["uncertainty"]["trials"] == 4
    with (output / "trajectory.csv").open() as stream:
        trajectory = list(csv.DictReader(stream))
    for route in report["routes"]:
        final = [row for row in trajectory if int(row["drone"]) == route["drone"]][-1]
        assert float(final["time_s"]) == pytest.approx(route["time_s"])
        assert float(final["energy_used_wh"]) == pytest.approx(route["energy_wh"])
        assert [float(final["x_m"]), float(final["y_m"])] == config["base"]
    with (output / "trials.csv").open() as stream:
        assert len(list(csv.DictReader(stream))) == 4


def test_infeasible_cli_exits_nonzero_without_success_report(tmp_path):
    source = tmp_path / "input.json"
    source.write_text(json.dumps({"battery_wh": .001}))
    output = tmp_path / "output"
    result = subprocess.run([sys.executable, str(HERE / "run.py"), "--config", str(source),
        "--output", str(output), "--partition-cells", "10", "--trials", "0"], capture_output=True, text=True)
    assert result.returncode == 2
    assert "battery-feasible" in result.stderr
    assert not (output / "report.json").exists()
