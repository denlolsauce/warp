"""Exact min-max partitioning within an explicitly restricted sweep-route family."""
from dataclasses import dataclass, replace
from math import ceil, inf

from model import Config, Leg, Point, Route, ground_speed, make_route


@dataclass(frozen=True)
class Solution:
    routes: tuple[Route, ...]
    orientation: str
    lanes: tuple[tuple[Point, Point], ...]
    cuts: tuple[int, ...]
    lower_bound_s: float

    @property
    def makespan_s(self):
        return max(r.time_s for r in self.routes)


class InfeasibleMission(ValueError):
    pass


def sweep_lanes(cfg: Config, orientation: str) -> tuple[tuple[Point, Point], ...]:
    cross_extent = cfg.width_m if orientation == "north_south" else cfg.height_m
    along_extent = cfg.height_m if orientation == "north_south" else cfg.width_m
    spacing_limit = cfg.swath_m * (1 - cfg.overlap)
    count = max(cfg.drones, ceil(cross_extent / spacing_limit))
    spacing = cross_extent / count
    if count > 300:
        raise ValueError("More than 300 lanes: increase swath or explicitly extend the solver's computational budget")
    result = []
    for i in range(count):
        cross = (i + 0.5) * spacing
        result.append(((cross, 0.0), (cross, along_extent)) if orientation == "north_south"
                      else ((0.0, cross), (along_extent, cross)))
    return tuple(result)


def route_for_block(lanes, start: int, end: int, cfg: Config) -> Route | None:
    """Find the fastest battery-feasible traversal of a contiguous lane block."""
    best = None
    for reverse_order in (False, True):
        indices = list(range(start, end))
        if reverse_order:
            indices.reverse()
        for initial_reverse in (False, True):
            legs = []
            position = cfg.base
            for sequence, index in enumerate(indices):
                a, b = lanes[index]
                if initial_reverse != bool(sequence % 2):
                    a, b = b, a
                legs.extend((Leg(position, a, False), Leg(a, b, True)))
                position = b
            legs.append(Leg(position, cfg.base, False))
            route = make_route(0, tuple(legs), cfg)
            if route.energy_wh <= cfg.usable_wh + 1e-9 and (best is None or route.time_s < best.time_s):
                best = route
    return best


def solve_orientation(cfg: Config, orientation: str, *, equal_partition: bool = False) -> Solution:
    lanes = sweep_lanes(cfg, orientation)
    count = len(lanes)
    costs = {(a, b): route_for_block(lanes, a, b, cfg)
             for a in range(count) for b in range(a + 1, count + 1)}
    if equal_partition:
        # Balanced lane counts; optimize traversal order just as for the optimized plan.
        cuts = tuple(i * count // cfg.drones for i in range(cfg.drones + 1))
        chosen = [costs[(a, b)] for a, b in zip(cuts, cuts[1:])]
        if any(r is None for r in chosen):
            raise InfeasibleMission("Equal-partition baseline exceeds usable battery energy")
    else:
        dp = [[inf] * (count + 1) for _ in range(cfg.drones + 1)]
        parent = [[None] * (count + 1) for _ in range(cfg.drones + 1)]
        dp[0][0] = 0
        for drones in range(1, cfg.drones + 1):
            for end in range(drones, count + 1):
                for start in range(drones - 1, end):
                    route = costs[(start, end)]
                    if route is None:
                        continue
                    candidate = max(dp[drones - 1][start], route.time_s)
                    if candidate < dp[drones][end]:
                        dp[drones][end] = candidate
                        parent[drones][end] = start
        if parent[cfg.drones][count] is None:
            raise InfeasibleMission(f"No {cfg.drones}-drone battery-feasible partition for {orientation}")
        cuts_list = [count]
        end = count
        for drones in range(cfg.drones, 0, -1):
            end = parent[drones][end]
            cuts_list.append(end)
        cuts = tuple(reversed(cuts_list))
        chosen = [costs[(a, b)] for a, b in zip(cuts, cuts[1:])]
    routes = tuple(replace(route, drone=i + 1) for i, route in enumerate(chosen))
    # Every lane must be flown; omit all transit/turn costs and allow its faster direction.
    lower_bound = sum(min(
        ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 / ground_speed(a, b, cfg),
        ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 / ground_speed(b, a, cfg),
    ) for a, b in lanes) / cfg.drones
    return Solution(routes, orientation, lanes, cuts, lower_bound)


def optimize(cfg: Config) -> tuple[Solution, dict]:
    candidates, baselines, errors = [], [], []
    lower_bounds = []
    for orientation in ("north_south", "east_west"):
        try:
            solution = solve_orientation(cfg, orientation)
            candidates.append(solution)
            lower_bounds.append(solution.lower_bound_s)
        except InfeasibleMission as error:
            errors.append(str(error))
        try:
            baselines.append(solve_orientation(cfg, orientation, equal_partition=True))
        except InfeasibleMission:
            pass
    if not candidates:
        raise InfeasibleMission("; ".join(errors))
    best = min(candidates, key=lambda s: s.makespan_s)
    baseline = min(baselines, key=lambda s: s.makespan_s) if baselines else None
    lower = min(lower_bounds)
    return best, {
        "objective": "Minimize time until all drones return, subject to coverage and per-drone usable energy",
        "optimality_scope": "Exact dynamic programming over contiguous partitions of evenly spaced lanes, two axis-aligned orientations, four stop-and-yaw lawnmower traversals per block. Not a global continuous-routing optimum.",
        "restricted_family_optimal": True,
        "lane_count": len(best.lanes),
        "lane_spacing_m": (cfg.width_m if best.orientation == "north_south" else cfg.height_m) / len(best.lanes),
        "cuts": best.cuts,
        "orientation": best.orientation,
        "family_relaxation_lower_bound_s": lower,
        "gap_to_family_relaxation_pct": (best.makespan_s / lower - 1) * 100,
        "baseline_makespan_s": baseline.makespan_s if baseline else None,
        "baseline_orientation": baseline.orientation if baseline else None,
        "improvement_pct": 100 * (1 - best.makespan_s / baseline.makespan_s) if baseline else None,
        "baseline_definition": "Best of both orientations with equal lane-count partitions and the same per-block traversal search and physics",
        "infeasible_orientations": errors,
        "_baseline": baseline,
    }


def sector_lanes(cfg: Config, partition: str, start: float, end: float, sweep: str):
    x0, x1 = (start, end) if partition == "vertical" else (0.0, cfg.width_m)
    y0, y1 = (0.0, cfg.height_m) if partition == "vertical" else (start, end)
    low, high = (x0, x1) if sweep == "north_south" else (y0, y1)
    count = max(1, ceil((high - low) / (cfg.swath_m * (1 - cfg.overlap))))
    if count > 300:
        raise ValueError("More than 300 lanes in a sector exceeds the solver budget")
    return tuple((((low + (i + .5) * (high - low) / count, y0),
                   (low + (i + .5) * (high - low) / count, y1)) if sweep == "north_south" else
                  ((x0, low + (i + .5) * (high - low) / count),
                   (x1, low + (i + .5) * (high - low) / count))) for i in range(count))


def solve_sectors(cfg: Config, partition: str, cells: int = 40, *, equal_partition=False) -> Solution:
    """Optimize sector boundaries on a spatial grid, allowing short cross-sector legs."""
    if cells < cfg.drones or cells > 100:
        raise ValueError("Partition cells must be between the drone count and 100")
    extent = cfg.width_m if partition == "vertical" else cfg.height_m
    costs, lane_sets = {}, {}
    for start in range(cells):
        for end in range(start + 1, cells + 1):
            best = None
            for sweep in ("north_south", "east_west"):
                lanes = sector_lanes(cfg, partition, start * extent / cells, end * extent / cells, sweep)
                route = route_for_block(lanes, 0, len(lanes), cfg)
                if route is not None and (best is None or route.time_s < best.time_s):
                    best = route
                    lane_sets[(start, end)] = lanes
            costs[(start, end)] = best
    if equal_partition:
        if cells % cfg.drones:
            raise ValueError("Equal-sector baseline requires cells divisible by drone count")
        cuts = tuple(i * cells // cfg.drones for i in range(cfg.drones + 1))
    else:
        dp = [[inf] * (cells + 1) for _ in range(cfg.drones + 1)]
        back = {}
        dp[0][0] = 0
        for drones in range(1, cfg.drones + 1):
            for end in range(drones, cells + 1):
                for start in range(drones - 1, end):
                    route = costs[(start, end)]
                    if route is not None and max(dp[drones-1][start], route.time_s) < dp[drones][end]:
                        dp[drones][end] = max(dp[drones-1][start], route.time_s)
                        back[(drones, end)] = start
        if (cfg.drones, cells) not in back:
            raise InfeasibleMission(f"No battery-feasible {partition} sector partition")
        cuts_list, end = [cells], cells
        for drones in range(cfg.drones, 0, -1):
            end = back[(drones, end)]
            cuts_list.append(end)
        cuts = tuple(reversed(cuts_list))
    blocks = list(zip(cuts, cuts[1:]))
    if any(costs[b] is None for b in blocks):
        raise InfeasibleMission(f"Equal {partition} sectors exceed usable battery")
    routes = tuple(replace(costs[b], drone=i+1) for i, b in enumerate(blocks))
    lanes = tuple(lane for b in blocks for lane in lane_sets[b])
    # All allowed sweeps require at least area/effective-spacing survey distance.
    wind_speed = (cfg.wind_mps[0] ** 2 + cfg.wind_mps[1] ** 2) ** .5
    lower = cfg.width_m * cfg.height_m / (cfg.swath_m * (1-cfg.overlap)) / (cfg.airspeed_mps + wind_speed) / cfg.drones
    return Solution(routes, f"{partition}_sectors", lanes, cuts, lower)


_lane_optimize = optimize


def optimize(cfg: Config, partition_cells: int = 40) -> tuple[Solution, dict]:
    candidates, baselines, errors = [], [], []
    try:
        lane_solution, lane_metadata = _lane_optimize(cfg)
        candidates.append(lane_solution)
        if lane_metadata["_baseline"]:
            baselines.append(lane_metadata["_baseline"])
    except InfeasibleMission as error:
        errors.append(str(error))
    for partition in ("vertical", "horizontal"):
        try:
            candidates.append(solve_sectors(cfg, partition, partition_cells))
        except InfeasibleMission as error:
            errors.append(str(error))
        try:
            baselines.append(solve_sectors(cfg, partition, partition_cells, equal_partition=True))
        except InfeasibleMission:
            pass
    if not candidates:
        raise InfeasibleMission("; ".join(errors))
    best = min(candidates, key=lambda s: s.makespan_s)
    baseline = min(baselines, key=lambda s: s.makespan_s) if baselines else None
    wind_speed = (cfg.wind_mps[0] ** 2 + cfg.wind_mps[1] ** 2) ** .5
    lower = cfg.width_m * cfg.height_m / (cfg.swath_m * (1-cfg.overlap)) / (cfg.airspeed_mps + wind_speed) / cfg.drones
    return best, {
        "objective": "Minimize time until all drones return, subject to full coverage and individual usable battery energy",
        "optimality_scope": "Exact min-max dynamic programming within the union of contiguous full-area lane partitions and axis-aligned rectangular sectors on the specified cut grid. Each sector selects either sweep axis and four lawnmower traversal variants. No guarantee for arbitrary continuous routes, arbitrary sweep angles or noncontiguous assignments.",
        "restricted_family_optimal": True,
        "partition_cells": partition_cells,
        "sector_boundary_resolution_m": {"x": cfg.width_m / partition_cells, "y": cfg.height_m / partition_cells},
        "lane_count": len(best.lanes),
        "maximum_allowed_lane_spacing_m": cfg.swath_m * (1-cfg.overlap),
        "cuts": best.cuts,
        "orientation": best.orientation,
        "family_relaxation_lower_bound_s": lower,
        "gap_to_family_relaxation_pct": (best.makespan_s / lower - 1) * 100,
        "baseline_makespan_s": baseline.makespan_s if baseline else None,
        "baseline_orientation": baseline.orientation if baseline else None,
        "improvement_pct": 100 * (1 - best.makespan_s / baseline.makespan_s) if baseline else None,
        "baseline_definition": "Best equal lane-count or equal spatial-sector partition, searching both partition/sweep axes and all four traversal variants with identical physics and energy constraints",
        "infeasible_candidates": errors,
        "_baseline": baseline,
    }
