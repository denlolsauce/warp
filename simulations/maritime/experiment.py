"""Seeded uncertainty replay of fixed nominal routes, without re-optimizing each draw."""
from dataclasses import replace

import numpy as np

from model import Config, make_route


def uncertainty_trials(routes, baseline_routes, cfg: Config, *, trials=100, seed=42,
                       wind_sd_mps=1.5, airspeed_sd_mps=0.8, log_power_sd=0.08):
    if trials < 0 or any(not np.isfinite(v) or v < 0 for v in (wind_sd_mps, airspeed_sd_mps, log_power_sd)):
        raise ValueError("Trial count and uncertainty standard deviations must be nonnegative and finite")
    rng = np.random.default_rng(seed)
    rows = []
    for index in range(trials):
        wind = tuple(float(v) for v in rng.normal(cfg.wind_mps, wind_sd_mps))
        speed = float(rng.normal(cfg.airspeed_mps, airspeed_sd_mps))
        scale = float(rng.lognormal(-log_power_sd ** 2 / 2, log_power_sd))
        row = {"trial": index, "wind_x_mps": wind[0], "wind_y_mps": wind[1],
               "airspeed_mps": speed, "power_scale": scale}
        try:
            sampled = replace(cfg, wind_mps=wind, airspeed_mps=speed,
                              cruise_power_w=cfg.cruise_power_w * scale,
                              hover_power_w=cfg.hover_power_w * scale)
        except ValueError as error:
            row.update({"optimized_feasible": False, "baseline_feasible": False if baseline_routes else None,
                        "reason": str(error)})
            rows.append(row)
            continue
        for name, plan in (("optimized", routes), ("baseline", baseline_routes)):
            if plan is None:
                row[f"{name}_feasible"] = None
                continue
            replay = [make_route(route.drone, route.legs, sampled) for route in plan]
            row[f"{name}_makespan_s"] = max(r.time_s for r in replay)
            row[f"{name}_max_energy_wh"] = max(r.energy_wh for r in replay)
            row[f"{name}_feasible"] = all(r.energy_wh <= sampled.usable_wh + 1e-9 for r in replay)
        rows.append(row)
    summary = {"trials": trials, "seed": seed, "wind_component_sd_mps": wind_sd_mps,
               "airspeed_sd_mps": airspeed_sd_mps, "log_power_sd": log_power_sd,
               "interpretation": "Independent per-mission Gaussian wind components and airspeed, lognormal power multiplier; same draw for optimized and baseline fixed routes. Assumed distributions, not calibrated confidence intervals. No route re-optimization, within-flight gusts or sensor uncertainty."}
    for name in ("optimized", "baseline"):
        if name == "baseline" and baseline_routes is None:
            continue
        successful = [r[f"{name}_makespan_s"] for r in rows if r.get(f"{name}_feasible")]
        summary[name] = {
            "feasible_trials": len(successful),
            "infeasible_trials": trials - len(successful),
            "success_fraction": len(successful) / trials if trials else None,
            "makespan_percentiles_s_given_feasible": dict(zip(("p05", "p50", "p95"),
                (float(v) for v in np.percentile(successful, [5, 50, 95])))) if successful else None,
        }
    return summary, rows
