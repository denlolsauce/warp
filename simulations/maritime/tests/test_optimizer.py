from dataclasses import replace
from itertools import combinations
from math import isclose

import pytest

from model import Config
from optimizer import InfeasibleMission, optimize, route_for_block, solve_orientation, sweep_lanes


def test_dynamic_program_matches_exhaustive_partition_search():
    cfg = Config(width_m=1000, height_m=800, base=(500, 800), drones=3, swath_m=180)
    for axis in ("north_south", "east_west"):
        lanes = sweep_lanes(cfg, axis)
        optimum = float("inf")
        for interior in combinations(range(1, len(lanes)), cfg.drones - 1):
            cuts = (0, *interior, len(lanes))
            times = [route_for_block(lanes, a, b, cfg).time_s for a, b in zip(cuts, cuts[1:])]
            optimum = min(optimum, max(times))
        actual = solve_orientation(cfg, axis)
        assert isclose(actual.makespan_s, optimum, abs_tol=1e-9)


def test_five_drone_100km2_default_and_overlap():
    cfg = Config()
    solution, metrics = optimize(cfg)
    assert len(solution.routes) == 5
    assert all(r.legs[0].start == cfg.base and r.legs[-1].end == cfg.base for r in solution.routes)
    assert all(r.energy_wh <= cfg.usable_wh for r in solution.routes)
    assert metrics["lane_spacing_m"] <= cfg.swath_m * (1 - cfg.overlap)
    assert solution.makespan_s <= metrics["baseline_makespan_s"] + 1e-9
    assert metrics["family_relaxation_lower_bound_s"] <= solution.makespan_s
    surveys = [(leg.start, leg.end) for r in solution.routes for leg in r.legs if leg.survey]
    assert len(surveys) == len(solution.lanes)
    assert {tuple(sorted(s)) for s in surveys} == {tuple(sorted(s)) for s in solution.lanes}


def test_infeasible_battery_not_silently_accepted():
    with pytest.raises(InfeasibleMission, match="battery-feasible"):
        optimize(Config(width_m=1000, height_m=1000, base=(500, 1000), battery_wh=0.01))


def test_uniform_speed_scaling_without_turn_delays():
    slow = Config(width_m=1000, height_m=800, base=(500, 800), wind_mps=(0, 0), turn_settle_s=0, yaw_rate_deg_s=1e15)
    fast = replace(slow, airspeed_mps=slow.airspeed_mps * 2)
    assert isclose(optimize(slow)[0].makespan_s / 2, optimize(fast)[0].makespan_s, abs_tol=1e-8)


@pytest.mark.parametrize("kwargs", [{"airspeed_mps": 0}, {"overlap": 1}, {"reserve_fraction": -0.1}, {"wind_mps": (25, 0)}, {"sample_dt_s": float("nan")}, {"base": (20000, 0)}, {"drones": 0}])
def test_bad_inputs(kwargs):
    with pytest.raises(ValueError):
        Config(**kwargs)
