from dataclasses import replace
from math import sqrt

import pytest

from model import Config, Leg, make_route
from optimizer import optimize
from validation import timeline, validate


def cfg(**changes):
    values = dict(
        width_m=10,
        height_m=10,
        drones=1,
        base=(5, 5),
        airspeed_mps=10,
        swath_m=2,
        overlap=0,
        wind_mps=(0, 0),
        cruise_power_w=360,
        hover_power_w=720,
        battery_wh=100,
        reserve_fraction=0.2,
        yaw_rate_deg_s=90,
        turn_settle_s=2,
        sample_dt_s=0.5,
    )
    values.update(changes)
    return Config(**values)


def shuttle(config, end, survey=False):
    legs = (Leg(config.base, end, survey), Leg(end, config.base, False))
    return make_route(0, legs, config)


def test_replay_uses_analytic_head_tail_and_crosswind_ground_speeds():
    config = cfg(drones=4, base=(10, 10), width_m=20, height_m=20,
                 airspeed_mps=10, wind_mps=(3, 4), yaw_rate_deg_s=90, turn_settle_s=0)
    endpoints = ((20, 10), (0, 10), (10, 20), (10, 0))
    routes = [replace(shuttle(config, endpoint), drone=index,
                      time_s=0, energy_wh=0, distance_m=0)
              for index, endpoint in enumerate(endpoints)]

    result = validate(routes, config)
    speeds = (3 + sqrt(84), -3 + sqrt(84), 4 + sqrt(91), -4 + sqrt(91))
    expected_times = (10 / speeds[0] + 10 / speeds[1] + 2,
                      10 / speeds[1] + 10 / speeds[0] + 2,
                      10 / speeds[2] + 10 / speeds[3] + 2,
                      10 / speeds[3] + 10 / speeds[2] + 2)

    assert result["makespan_s"] == pytest.approx(max(expected_times))
    assert any("stored time_s" in issue for issue in result["violations"])


def test_replay_counts_yaw_dwell_and_energy_analytically():
    config = cfg(base=(0, 0), width_m=20, height_m=20, wind_mps=(0, 0),
                 airspeed_mps=10, cruise_power_w=360, hover_power_w=720,
                 yaw_rate_deg_s=90, turn_settle_s=2)
    route = shuttle(config, (10, 0))

    result = validate((route,), config)
    expected_time = 2 + 180 / 90 + 2
    expected_energy = 2 * 360 / 3600 + 4 * 720 / 3600
    assert result["makespan_s"] == pytest.approx(expected_time)
    assert result["total_energy_wh"] == pytest.approx(expected_energy)
    assert result["feasible"] is False  # Survey coverage is intentionally absent.
    assert not any("stored time_s" in issue or "stored energy_wh" in issue for issue in result["violations"])


def test_single_strip_reports_half_coverage_not_full_coverage():
    config = cfg(base=(2.5, 0), swath_m=5)
    route = make_route(0, (
        Leg(config.base, (2.5, 10), True),
        Leg((2.5, 10), config.base, False),
    ), config)

    result = validate((route,), config)
    assert result["coverage_fraction"] == pytest.approx(0.5, abs=0.002)
    assert result["uncovered_m2"] == pytest.approx(50, abs=0.02)
    assert result["feasible"] is False


def test_aligned_survey_lanes_cover_rectangle_including_edges():
    config = cfg(base=(0, 0), swath_m=2)
    legs = []
    for y in range(0, 11, 2):
        start, end = ((0, y), (10, y)) if y % 4 == 0 else ((10, y), (0, y))
        if legs and legs[-1].end != start:
            legs.append(Leg(legs[-1].end, start, False))
        legs.append(Leg(start, end, True))
    if legs[-1].end != config.base:
        legs.append(Leg(legs[-1].end, config.base, False))
    route = make_route(0, tuple(legs), config)

    result = validate((route,), config)
    assert result["uncovered_m2"] <= 1
    assert result["coverage_fraction"] == pytest.approx(1)
    assert result["feasible"]


def test_discontinuous_path_is_rejected():
    config = cfg()
    route = make_route(0, (
        Leg(config.base, (8, 5), False),
        Leg((7, 5), config.base, False),
    ), config)

    result = validate((route,), config)
    assert not result["feasible"]
    assert any("path discontinuity" in issue for issue in result["violations"])


def test_route_must_start_and_return_to_base():
    config = cfg()
    route = make_route(0, (Leg((4, 5), (6, 5), False), Leg((6, 5), (4, 5), False)), config)

    result = validate((route,), config)
    assert any("does not start at base" in issue for issue in result["violations"])
    assert any("does not end at base" in issue for issue in result["violations"])


def test_energy_above_reserve_is_infeasible():
    config = cfg(base=(0, 0), width_m=20, height_m=20, battery_wh=1, reserve_fraction=0.2)
    route = shuttle(config, (10, 0))

    result = validate((route,), config)
    assert not result["feasible"]
    assert any("exceeds usable battery" in issue for issue in result["violations"])


def test_timeline_samples_events_and_ends_home_with_exact_battery_state():
    config = cfg(base=(0, 0), width_m=20, height_m=20)
    route = shuttle(config, (10, 0))
    rows = timeline((route,), config)
    last = rows[-1]
    result = validate((route,), config)

    assert all((right["time_s"] - left["time_s"]) == pytest.approx(config.sample_dt_s)
               for left, right in zip(rows[:-2], rows[1:-1]))
    assert last["time_s"] == pytest.approx(result["makespan_s"])
    assert (last["x_m"], last["y_m"]) == config.base
    assert last["energy_used_wh"] == pytest.approx(result["total_energy_wh"])
    assert last["battery_remaining_wh"] == pytest.approx(config.battery_wh - result["total_energy_wh"])
    assert any(row["kind"] == "turn" for row in rows)


def test_optimizer_solution_passes_independent_geometry_and_physics_validation():
    config = Config(width_m=500, height_m=400, base=(250, 400), drones=5,
                    swath_m=120, wind_mps=(2, 1), battery_wh=100_000)
    solution, _metadata = optimize(config)

    result = validate(solution.routes, config)
    assert result["uncovered_m2"] <= 1
    assert result["feasible"]
    assert not any("stored " in issue and "disagrees with replay" in issue
                   for issue in result["violations"])
