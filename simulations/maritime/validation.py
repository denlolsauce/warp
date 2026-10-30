"""Independent physical replay, geometric coverage, and sampled timelines."""
from __future__ import annotations

from math import atan2, degrees, hypot, isfinite, pi, sqrt
from typing import Sequence

from shapely.geometry import LineString, box
from shapely.ops import unary_union

from model import Config, Route, events_for

_GEOMETRY_QUAD_SEGS = 32
_POSITION_TOLERANCE_M = 1e-6
_METRIC_ABS_TOLERANCE = 1e-6
_METRIC_REL_TOLERANCE = 1e-6
_ZERO_LEG_M = 1e-9


def _finite_point(point: object) -> bool:
    try:
        return len(point) == 2 and all(isfinite(value) for value in point)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False


def _close_metric(stored: object, computed: float) -> bool:
    try:
        value = float(stored)
    except (TypeError, ValueError):
        return False
    return isfinite(value) and abs(value - computed) <= max(
        _METRIC_ABS_TOLERANCE,
        _METRIC_REL_TOLERANCE * max(abs(value), abs(computed)),
    )


def _replay(route: Route, cfg: Config, violations: list[str]):
    time_s = energy_wh = distance_m = 0.0
    previous_heading = None
    survey_lines = []
    legs = route.legs
    if not legs:
        violations.append(f"drone {route.drone}: route has no legs")

    for index, leg in enumerate(legs):
        if not _finite_point(leg.start) or not _finite_point(leg.end):
            violations.append(f"drone {route.drone}: leg {index} has non-finite or invalid coordinates")
            continue
        for label, point in (("start", leg.start), ("end", leg.end)):
            if not (0 <= point[0] <= cfg.width_m and 0 <= point[1] <= cfg.height_m):
                violations.append(
                    f"drone {route.drone}: leg {index} {label} endpoint lies outside operational area"
                )
        if index and _finite_point(legs[index - 1].end):
            gap = hypot(leg.start[0] - legs[index - 1].end[0], leg.start[1] - legs[index - 1].end[1])
            if gap > _POSITION_TOLERANCE_M:
                violations.append(f"drone {route.drone}: path discontinuity before leg {index} ({gap:.6g} m)")

        dx, dy = leg.end[0] - leg.start[0], leg.end[1] - leg.start[1]
        distance = hypot(dx, dy)
        distance_m += distance
        if distance <= _ZERO_LEG_M:
            continue

        if leg.survey:
            survey_lines.append(LineString((leg.start, leg.end)).buffer(
                cfg.swath_m / 2, quad_segs=_GEOMETRY_QUAD_SEGS, cap_style="round"
            ))

        heading = atan2(dy, dx)
        if previous_heading is not None:
            angle = abs((heading - previous_heading + pi) % (2 * pi) - pi)
            if angle > 1e-9:
                dwell_s = degrees(angle) / cfg.yaw_rate_deg_s + cfg.turn_settle_s
                time_s += dwell_s
                energy_wh += dwell_s * cfg.hover_power_w / 3600

        length = distance
        ux, uy = dx / length, dy / length
        wind_x, wind_y = cfg.wind_mps
        parallel = wind_x * ux + wind_y * uy
        cross = wind_x * uy - wind_y * ux
        radicand = cfg.airspeed_mps ** 2 - cross ** 2
        if radicand < 0:
            violations.append(f"drone {route.drone}: wind exceeds cross-track airspeed on leg {index}")
            previous_heading = heading
            continue
        speed = parallel + sqrt(radicand)
        if not isfinite(speed) or speed <= 0:
            violations.append(f"drone {route.drone}: non-positive ground speed on leg {index}")
            previous_heading = heading
            continue
        leg_time = distance / speed
        time_s += leg_time
        energy_wh += leg_time * cfg.cruise_power_w / 3600
        previous_heading = heading

    if legs:
        if _finite_point(legs[0].start):
            start_error = hypot(legs[0].start[0] - cfg.base[0], legs[0].start[1] - cfg.base[1])
            if start_error > _POSITION_TOLERANCE_M:
                violations.append(f"drone {route.drone}: route does not start at base ({start_error:.6g} m away)")
        if _finite_point(legs[-1].end):
            end_error = hypot(legs[-1].end[0] - cfg.base[0], legs[-1].end[1] - cfg.base[1])
            if end_error > _POSITION_TOLERANCE_M:
                violations.append(f"drone {route.drone}: route does not end at base ({end_error:.6g} m away)")

    for name, stored, actual in (
        ("time_s", route.time_s, time_s),
        ("energy_wh", route.energy_wh, energy_wh),
        ("distance_m", route.distance_m, distance_m),
    ):
        if not _close_metric(stored, actual):
            violations.append(f"drone {route.drone}: stored {name}={stored!r} disagrees with replay {actual:.9g}")

    if energy_wh > cfg.usable_wh + _METRIC_ABS_TOLERANCE:
        violations.append(
            f"drone {route.drone}: energy {energy_wh:.6g} Wh exceeds usable battery {cfg.usable_wh:.6g} Wh"
        )
    return time_s, energy_wh, distance_m, survey_lines


def validate(routes: Sequence[Route], cfg: Config) -> dict:
    """Replay routes and return JSON-compatible physical and coverage metrics."""
    violations: list[str] = []
    valid_routes = []
    seen_drones = set()
    all_survey_lines = []
    replayed = []

    for route in routes:
        if not isinstance(route, Route):
            violations.append(f"invalid route value: expected Route, got {type(route).__name__}")
            continue
        if route.drone in seen_drones:
            violations.append(f"drone {route.drone}: duplicate route")
        seen_drones.add(route.drone)
        if not isinstance(route.drone, int) or isinstance(route.drone, bool) or not 1 <= route.drone <= cfg.drones:
            violations.append(f"drone {route.drone}: id must be in [1, {cfg.drones}]")

        valid_routes.append(route)
        time_s, energy_wh, distance_m, survey_lines = _replay(route, cfg, violations)
        replayed.append((time_s, energy_wh, distance_m))
        all_survey_lines.extend(survey_lines)

    if len(valid_routes) != cfg.drones:
        violations.append(f"expected exactly {cfg.drones} routes, got {len(valid_routes)}")

    operational_area = box(0, 0, cfg.width_m, cfg.height_m)
    covered = unary_union(all_survey_lines).intersection(operational_area) if all_survey_lines else box(0, 0, 0, 0)
    area_m2 = cfg.width_m * cfg.height_m
    coverage_m2 = min(area_m2, max(0.0, covered.area))
    uncovered_m2 = max(0.0, area_m2 - coverage_m2)
    if uncovered_m2 > 1.0:
        violations.append(f"coverage gap {uncovered_m2:.6g} m2 exceeds 1 m2 tolerance")

    makespan_s = max((item[0] for item in replayed), default=0.0)
    total_energy_wh = sum(item[1] for item in replayed)
    return {
        "coverage_km2": coverage_m2 / 1_000_000,
        "uncovered_m2": uncovered_m2,
        "coverage_fraction": coverage_m2 / area_m2,
        "makespan_s": makespan_s,
        "total_energy_wh": total_energy_wh,
        "feasible": not violations,
        "violations": violations,
    }


def timeline(routes: Sequence[Route], cfg: Config) -> list[dict]:
    """Sample event-based routes every configured interval, retaining exact ends."""
    rows = []
    dt = cfg.sample_dt_s

    for route in routes:
        events = events_for(tuple(route.legs), cfg)
        duration_s = sum(event.duration_s for event in events)
        sample_count = int(duration_s // dt)
        times = {0.0, duration_s}
        times.update(index * dt for index in range(1, sample_count + 1) if index * dt < duration_s - 1e-12)
        event_ends = []
        elapsed = 0.0
        for event in events:
            elapsed += event.duration_s
            event_ends.append(elapsed)

        for sample_time in sorted(times):
            completed_energy = 0.0
            event_start_time = 0.0
            state = None
            for event, event_end in zip(events, event_ends):
                if sample_time < event_end - 1e-12:
                    in_event_s = max(0.0, sample_time - event_start_time)
                    fraction = in_event_s / event.duration_s if event.duration_s else 0.0
                    x = event.start[0] + fraction * (event.end[0] - event.start[0])
                    y = event.start[1] + fraction * (event.end[1] - event.start[1])
                    energy_used = completed_energy + in_event_s * event.power_w / 3600
                    state = (x, y, energy_used, event.kind)
                    break
                completed_energy += event.duration_s * event.power_w / 3600
                event_start_time = event_end

            if state is None:
                if events:
                    last = events[-1]
                    state = (last.end[0], last.end[1], completed_energy, last.kind)
                else:
                    point = route.legs[0].start if route.legs else cfg.base
                    state = (point[0], point[1], 0.0, "idle")

            x, y, energy_used, kind = state
            rows.append({
                "time_s": sample_time,
                "drone": route.drone,
                "x_m": x,
                "y_m": y,
                "energy_used_wh": energy_used,
                "battery_remaining_wh": cfg.battery_wh - energy_used,
                "kind": kind,
            })

    return sorted(rows, key=lambda row: (row["time_s"], row["drone"]))
