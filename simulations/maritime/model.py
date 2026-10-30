"""SI-unit model for constant-altitude, stop-and-yaw multirotor surveys."""
from dataclasses import asdict, dataclass
from math import atan2, hypot, isfinite, pi, sqrt

Point = tuple[float, float]


@dataclass(frozen=True)
class Config:
    width_m: float = 10_000
    height_m: float = 10_000
    drones: int = 5
    base: Point = (5_000, 10_000)
    airspeed_mps: float = 18
    swath_m: float = 500
    overlap: float = 0.1
    wind_mps: Point = (4, 0)
    cruise_power_w: float = 650
    hover_power_w: float = 700
    battery_wh: float = 1_200
    reserve_fraction: float = 0.2
    yaw_rate_deg_s: float = 45
    turn_settle_s: float = 2
    sample_dt_s: float = 10

    def __post_init__(self):
        positive = (self.width_m, self.height_m, self.airspeed_mps, self.swath_m,
                    self.cruise_power_w, self.hover_power_w, self.battery_wh,
                    self.yaw_rate_deg_s, self.sample_dt_s)
        if any(not isfinite(v) or v <= 0 for v in positive):
            raise ValueError("Dimensions, airspeed, swath, power, battery, yaw rate and sample interval must be positive finite numbers")
        if not isinstance(self.drones, int) or isinstance(self.drones, bool) or self.drones < 1:
            raise ValueError("drones must be a positive integer")
        if not 0 <= self.overlap < 1 or not 0 <= self.reserve_fraction < 1:
            raise ValueError("Overlap and reserve must be fractions in [0, 1)")
        if not isfinite(self.turn_settle_s) or self.turn_settle_s < 0:
            raise ValueError("turn_settle_s must be finite and nonnegative")
        if len(self.base) != 2 or len(self.wind_mps) != 2 or not all(isfinite(v) for v in (*self.base, *self.wind_mps)):
            raise ValueError("Base and wind must contain two finite components")
        if not (0 <= self.base[0] <= self.width_m and 0 <= self.base[1] <= self.height_m):
            raise ValueError("Base must be within the rectangular operational area")
        if hypot(*self.wind_mps) >= self.airspeed_mps:
            raise ValueError("Wind magnitude must be below airspeed for all-direction flight and station-keeping")

    @property
    def usable_wh(self):
        return self.battery_wh * (1 - self.reserve_fraction)

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class Leg:
    start: Point
    end: Point
    survey: bool


@dataclass(frozen=True)
class Event:
    start: Point
    end: Point
    duration_s: float
    power_w: float
    survey: bool
    kind: str


@dataclass(frozen=True)
class Route:
    drone: int
    legs: tuple[Leg, ...]
    time_s: float
    energy_wh: float
    distance_m: float


def ground_speed(start: Point, end: Point, cfg: Config) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = hypot(dx, dy)
    if length == 0:
        return cfg.airspeed_mps
    ux, uy = dx / length, dy / length
    parallel = cfg.wind_mps[0] * ux + cfg.wind_mps[1] * uy
    cross = cfg.wind_mps[0] * uy - cfg.wind_mps[1] * ux
    return parallel + sqrt(cfg.airspeed_mps ** 2 - cross ** 2)


def events_for(legs: tuple[Leg, ...], cfg: Config) -> tuple[Event, ...]:
    events = []
    heading = None
    for leg in legs:
        dx, dy = leg.end[0] - leg.start[0], leg.end[1] - leg.start[1]
        distance = hypot(dx, dy)
        if distance <= 1e-9:
            continue
        new_heading = atan2(dy, dx)
        if heading is not None:
            angle = abs((new_heading - heading + pi) % (2 * pi) - pi)
            if angle > 1e-9:
                duration = angle * 180 / pi / cfg.yaw_rate_deg_s + cfg.turn_settle_s
                events.append(Event(leg.start, leg.start, duration, cfg.hover_power_w, False, "turn"))
        events.append(Event(leg.start, leg.end, distance / ground_speed(leg.start, leg.end, cfg), cfg.cruise_power_w, leg.survey, "survey" if leg.survey else "transit"))
        heading = new_heading
    return tuple(events)


def make_route(drone: int, legs: tuple[Leg, ...], cfg: Config) -> Route:
    events = events_for(legs, cfg)
    return Route(drone, legs, sum(e.duration_s for e in events),
                 sum(e.duration_s * e.power_w / 3600 for e in events),
                 sum(hypot(l.end[0] - l.start[0], l.end[1] - l.start[1]) for l in legs))
