# Five-drone maritime coverage optimization (Python, no UI)

A headless, reproducible numerical model for **one complete survey of 100 km²**, including transit from a common base and return. It minimizes the **makespan** (the last drone's return time), subject to geometric coverage and each drone's usable battery energy. It does **not** solve continuous monitoring / maximum revisit time.

The supplied scenario is synthetic. No aircraft performance, sensor detection probability, or site geometry has been calibrated against measurements. Do not treat its outputs as flight-ready waypoints or an operational safety assessment.

## Run

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```sh
cd simulations/maritime
uv sync --locked
uv run python run.py --config example.json --output results/default --trials 100 --seed 42
uv run pytest -q
```

No web server, GPU, database, pipeline dependencies, or external API is used. This project has its own dependency lockfile and environment.

Outputs:

- `report.json`: input parameters, optimization scope, nominal per-drone time/distance/energy, full route legs, independent coverage/physics validation, baseline routes, and uncertainty statistics.
- `trajectory.csv`: timestamped positions, cumulative energy and remaining battery, with exact final states in addition to regular samples.
- `trials.csv`: all uncertainty draws, replayed fixed-plan times and energy, and explicit feasibility flags. Failed trials are not discarded.

An infeasible nominal mission exits with status **2**, rather than silently violating battery limits. Existing output directories are not deleted on failure; use a new directory for each experiment.

## Executed example results

For the checked-in example, Python 3.12, 100 trials with seed 42:

| Metric | Result |
|---|---:|
| Optimized last return | 61.067 min |
| Fair equal-partition baseline | 63.410 min |
| Makespan reduction | 3.695% |
| Uncovered geometric area | 0.000000 m² |
| Maximum nominal drone energy | 662.138 Wh |
| Allowed energy per drone after reserve | 960 Wh |
| Assumed-uncertainty trials feasible | 100 / 100 |
| Feasible-trial makespan p05 / p50 / p95 | 56.503 / 61.392 / 68.496 min |

The combined search returned 61.090, 61.067 and 61.067 minutes at 20, 40 and 80 cut cells respectively; all three plans passed the geometric check. Agreement of these grids does not prove continuous-space optimality. Neither 100 successful synthetic trials nor zero geometric gaps establishes real-world reliability or sensor detection performance.

## Input model and units

`example.json` defines a 10,000 × 10,000 metre rectangle in a **local Cartesian frame**. Base is `(5000, 10000)`. Wind is a velocity **toward** `(x, y)`, not meteorological wind-from bearing. Other input names carry their SI units; `overlap` and `reserve_fraction` are fractions (0.1 = 10%). The sample battery/power values are assumptions, not specifications for a particular drone.

The model assumes identical multirotors with one sortie each. Each straight flight segment follows a track while maintaining constant airspeed. With unit track vector `u`, parallel wind `w_parallel`, and perpendicular wind magnitude `w_cross`, ground speed is

```text
v_ground = w_parallel + sqrt(v_air² - w_cross²)
```

Wind magnitude must be less than airspeed, ensuring both all-direction travel and station keeping. Time is segment length divided by ground speed. Between non-collinear travel segments, the drone stops and yaws through the wrapped track-angle change:

```text
turn_time = |angle_change| / yaw_rate + turn_settle_time
energy_Wh = sum(travel_seconds × cruise_power_W
              + turn_seconds × hover_power_W) / 3600
usable_Wh = battery_Wh × (1 - reserve_fraction)
```

Yaw is assumed aligned with ground track. Acceleration/deceleration is not explicitly integrated; the settling delay is a lumped approximation. Initial heading is free. Climb, descent, takeoff, landing, battery voltage/temperature effects, and wind-dependent power are not modeled. Cruise/turn power are constant assumed inputs.

`swath_m` is the **diameter of a circular instantaneous ground footprint**, not automatically an effective camera inspection width. Sensor footprints are accumulated only on survey legs, not turns or transit. Parallel survey spacing never exceeds `swath × (1 − overlap)`; first/last lanes sit half the actual spacing from sector boundaries. For mixed sweep axes in adjacent sectors, overlap is defined within each parallel sweep, not as a prescribed overlap shape at the sector seam. Coverage itself is checked across every seam.

## Optimization, and what “optimal” means here

The search is deterministic, not an animation or a random waypoint heuristic. It searches the union of:

1. Contiguous assignments of full-area, evenly spaced survey lanes, for both north–south and east–west sweeps.
2. Vertical or horizontal rectangular sector partitions, with boundaries restricted to a configurable spatial grid. Each sector independently chooses its sweep axis, evenly spaced lanes, lane-order direction and first-leg direction.

For each contiguous block/sector, all four alternating lawnmower traversal variants are evaluated, including base transit, connectors, yaw delays, return, and energy. Infeasible variants are excluded. The fastest feasible variant is the block cost. For `k` drones covering the first `j` lanes/cut cells:

```text
D[k,j] = min over i<j of max(D[k−1,i], cost[i,j])
```

This dynamic program is **exact for the specified discrete route family and physical cost model**. Tests compare it against exhaustive enumeration on small cases. It is not proof of the globally shortest continuous-space route. Arbitrary sweep angles, non-rectangular regions, noncontiguous assignments, adaptive tracks and multiple sorties are outside its search.

Default `--partition-cells 40` gives 250 m sector-boundary resolution over a 10 km side. Use a refinement check rather than assuming this is sufficient:

```sh
uv run python run.py --partition-cells 20 --trials 0 --output results/grid20
uv run python run.py --partition-cells 40 --trials 0 --output results/grid40
uv run python run.py --partition-cells 80 --trials 0 --output results/grid80
```

The grid must be divisible by drone count; nested grids preserve previous sector candidates. At most 100 cut cells and 300 lanes per sweep are supported as an explicit computational budget. A finer grid does not remove the route-family restriction.

The fair baseline searches the same sweep/traversal choices but fixes **equal lane-count or equal spatial-sector partitions**, whichever is faster. Optimization cannot be worse than that baseline under the same constraints. A loose family lower bound is also reported: area / effective lane spacing / maximum possible ground speed / fleet size. It omits turns, transit, direction alternation and lane-count rounding. **The gap to that relaxation is not a solver optimality gap or an accuracy estimate.**

## Independent validation and uncertainty

`validation.py` recomputes time, energy and distance separately from the optimizer's stored metrics, checks route continuity and base return, and measures the union of buffered survey segments clipped to the operational rectangle. Shapely uses an inscribed 128-sided approximation for round caps. Coverage is continuous geometry rather than a sampled-grid percentage; the allowed uncovered area is **1 m²** out of 100,000,000 m². Sampled CSV trajectories do not determine coverage or mission cost.

Seeded Monte Carlo trials replay the **fixed nominal plan** and fixed baseline under identical random draws:

- independent Gaussian wind components, default σ = 1.5 m/s;
- Gaussian airspeed, default σ = 0.8 m/s;
- a mean-one lognormal power multiplier, default log σ = 0.08.

Each draw represents a steady whole-mission condition; it is not a gust time series. Trials report battery/flight feasibility and time percentiles **conditional on feasibility**. These are assumed distributions, not calibrated confidence intervals, and the optimizer does not impose chance constraints. Use `--wind-sd-mps`, `--airspeed-sd-mps`, and `--log-power-sd` to specify justified uncertainties.

## Inputs still required for operational accuracy

Replace the example assumptions with the real operational boundary and launch sites, aircraft performance and measured power curves, endurance/reserve policy, altitude and effective sensor footprint/detection requirements, and weather data. The current solver only accepts a rectangle; do not replace a real irregular boundary with its bounding box and call that calibrated coverage.

No inter-drone separation, staggered launch scheduling, obstacles/no-fly zones, terrain, communications, sea-state visibility, infrastructure occlusion or target-specific inspection geometry is modeled. All drones start at a common base simultaneously, so these outputs are **not collision-deconflicted**. Those requirements must be incorporated before using paths with aircraft.
