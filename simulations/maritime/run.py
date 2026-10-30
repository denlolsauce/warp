"""Headless optimization, independent validation, and reproducible uncertainty experiments."""
import argparse
import csv
from dataclasses import asdict
import json
from pathlib import Path
import sys

from experiment import uncertainty_trials
from model import Config
from optimizer import InfeasibleMission, optimize
from validation import timeline, validate


def write_csv(path, rows):
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("example.json"))
    parser.add_argument("--output", type=Path, default=Path("results/default"))
    parser.add_argument("--partition-cells", type=int, default=40,
                        help="Spatial cut grid size, 1–100; must be divisible by drone count for equal-sector baseline")
    parser.add_argument("--trials", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--wind-sd-mps", type=float, default=1.5)
    parser.add_argument("--airspeed-sd-mps", type=float, default=.8)
    parser.add_argument("--log-power-sd", type=float, default=.08)
    args = parser.parse_args(argv)
    try:
        raw = json.loads(args.config.read_text())
        for key in ("base", "wind_mps"):
            if key in raw:
                raw[key] = tuple(raw[key])
        cfg = Config(**raw)
        if not cfg.drones <= args.partition_cells <= 100 or args.partition_cells % cfg.drones:
            raise ValueError("partition-cells must be >= drone count, <=100 and divisible by drone count")
        solution, optimization = optimize(cfg, args.partition_cells)
        baseline = optimization.pop("_baseline")
        verification = validate(solution.routes, cfg)
        if not verification["feasible"]:
            raise ValueError(f"Independent validation failed: {verification['violations']}")
        baseline_validation = validate(baseline.routes, cfg) if baseline else None
        if baseline_validation and not baseline_validation["feasible"]:
            raise ValueError(f"Baseline validation failed: {baseline_validation['violations']}")
        uncertainty, trials = uncertainty_trials(solution.routes, baseline.routes if baseline else None, cfg,
            trials=args.trials, seed=args.seed, wind_sd_mps=args.wind_sd_mps,
            airspeed_sd_mps=args.airspeed_sd_mps, log_power_sd=args.log_power_sd)
        report = {
            "schema_version": 1,
            "config": cfg.to_dict(),
            "optimization": optimization,
            "validation": verification,
            "baseline_validation": baseline_validation,
            "uncertainty": uncertainty,
            "routes": [asdict(route) for route in solution.routes],
            "baseline_routes": [asdict(route) for route in baseline.routes] if baseline else None,
            "assumptions": [
                "Synthetic axis-aligned rectangle in a local Cartesian frame, all distances in metres and time in seconds.",
                "Identical multirotors, one sortie each, common base, no charging or relaunch.",
                "Constant airspeed, steady uniform wind, exact straight-line crab solution; wind magnitude must be below airspeed.",
                "Stop-and-yaw corners with configured yaw rate and settling delay. No explicit acceleration, climb, descent or takeoff/landing model.",
                "Constant survey altitude and circular instantaneous ground footprint of diameter swath_m. Sensor off on transit and turns.",
                "Power values are user-supplied constants for travel and turns, not a calibrated aerodynamic or battery model.",
                "No obstacles, no-fly zones, communications limits, inter-drone separation scheduling or asset-specific inspection geometry.",
                "Coverage is one complete survey, not a guarantee of continuous monitoring or maximum revisit time.",
                "Uncertainty distributions are hypothetical; reported percentiles are not real-world accuracy guarantees.",
            ],
        }
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        write_csv(args.output / "trajectory.csv", timeline(solution.routes, cfg))
        write_csv(args.output / "trials.csv", trials)
        print(f"Area: {cfg.width_m * cfg.height_m / 1e6:.3f} km²; drones: {cfg.drones}")
        print(f"Optimized makespan: {solution.makespan_s / 60:.3f} min")
        if baseline:
            print(f"Fair baseline: {baseline.makespan_s / 60:.3f} min; improvement: {optimization['improvement_pct']:.3f}%")
        print(f"Geometric uncovered area: {verification['uncovered_m2']:.6f} m²")
        print(f"Orientation: {solution.orientation}; partition cuts: {solution.cuts}")
        print("Drone    Time/min    Distance/km    Energy/Wh    Usable/Wh")
        for route in solution.routes:
            print(f"{route.drone:5} {route.time_s/60:11.3f} {route.distance_m/1000:14.3f} {route.energy_wh:12.3f} {cfg.usable_wh:12.3f}")
        print(f"Fixed-plan uncertainty successes: {uncertainty['optimized']['feasible_trials']}/{args.trials}")
        print(f"Outputs: {args.output.resolve()}")
        print("Optimal only within the documented sweep family; example physics are not aircraft-calibrated.")
        return 0
    except (ValueError, TypeError, KeyError, OSError, InfeasibleMission) as error:
        print(f"Simulation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
