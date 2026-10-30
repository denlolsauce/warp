export interface Point {
  x: number;
  y: number;
}

export interface PlanOptions {
  speed: number;
  swath: number;
  overlap: number;
  strategy: "optimized" | "baseline";
}

export interface DroneRoute {
  id: number;
  points: Point[];
  distance: number;
}

export interface CoveragePlan {
  routes: DroneRoute[];
  duration: number;
  totalDistance: number;
  baselineDuration: number;
  improvement: number;
  laneSpacing: number;
}

const SIDE_KM = 10;
const DRONE_COUNT = 5;
const BASE: Point = { x: 5, y: 10 };

type LaneAxis = "x" | "y";

// The footprint is a flat 10 km square; each equal-width strip is swept
// edge-to-edge, with spacing limited by swath and requested overlap.
function validateOptions(options: PlanOptions): void {
  if (!Number.isFinite(options.speed) || options.speed <= 0) {
    throw new RangeError("speed must be a positive finite number");
  }
  if (!Number.isFinite(options.swath) || options.swath <= 0) {
    throw new RangeError("swath must be a positive finite number");
  }
  if (!Number.isFinite(options.overlap) || options.overlap < 0 || options.overlap >= 100) {
    throw new RangeError("overlap must be at least 0 and less than 100 percent");
  }
  if (options.strategy !== "optimized" && options.strategy !== "baseline") {
    throw new RangeError("strategy must be optimized or baseline");
  }
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathDistance(points: Point[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += distanceBetween(points[index - 1], points[index]);
  }
  return distance;
}

function lanesForBand(bandIndex: number, maxSpacing: number): number[] {
  const bandWidth = SIDE_KM / DRONE_COUNT;
  const start = bandIndex * bandWidth;
  const intervals = Math.max(1, Math.ceil(bandWidth / maxSpacing));
  return Array.from(
    { length: intervals + 1 },
    (_, index) => start + (bandWidth * index) / intervals,
  );
}

function makeRoute(
  id: number,
  axis: LaneAxis,
  maxSpacing: number,
  laneOrder: 1 | -1,
  firstSide: 1 | -1,
): DroneRoute {
  const bandWidth = SIDE_KM / DRONE_COUNT;
  const lanes = lanesForBand(id, maxSpacing);
  if (laneOrder === -1) lanes.reverse();

  const pointAt = (lane: number, along: number): Point =>
    axis === "x" ? { x: along, y: lane } : { x: lane, y: along };
  const points: Point[] = [{ ...BASE }];
  lanes.forEach((lane, index) => {
    const side = (index % 2 === 0 ? firstSide : -firstSide) as 1 | -1;
    const from = side === 1 ? 0 : SIDE_KM;
    const to = SIDE_KM - from;
    points.push(pointAt(lane, from), pointAt(lane, to));
  });
  points.push({ ...BASE });

  return { id: id + 1, points, distance: pathDistance(points) };
}

function routesFor(
  axis: LaneAxis,
  maxSpacing: number,
  laneOrder: 1 | -1,
  firstSide: 1 | -1,
): DroneRoute[] {
  return Array.from({ length: DRONE_COUNT }, (_, id) =>
    makeRoute(id, axis, maxSpacing, laneOrder, firstSide),
  );
}

function planMetrics(routes: DroneRoute[], speed: number) {
  const longestDistance = Math.max(...routes.map((route) => route.distance));
  return {
    duration: (longestDistance * 1000) / speed,
    totalDistance: routes.reduce((sum, route) => sum + route.distance, 0),
  };
}

export function createPlan(options: PlanOptions): CoveragePlan {
  validateOptions(options);
  const maxSpacing = (options.swath / 1000) * (1 - options.overlap / 100);
  const laneSpacing = SIDE_KM / DRONE_COUNT / Math.ceil((SIDE_KM / DRONE_COUNT) / maxSpacing);
  const baselineRoutes = routesFor("y", maxSpacing, 1, -1);
  const baselineDuration = planMetrics(baselineRoutes, options.speed).duration;

  let selectedRoutes = baselineRoutes;
  if (options.strategy === "optimized") {
    let bestMakespan = Infinity;
    for (const axis of ["x", "y"] as const) {
      for (const laneOrder of [1, -1] as const) {
        for (const firstSide of [1, -1] as const) {
          const candidate = routesFor(axis, maxSpacing, laneOrder, firstSide);
          const makespan = Math.max(...candidate.map((route) => route.distance));
          if (makespan < bestMakespan) {
            bestMakespan = makespan;
            selectedRoutes = candidate;
          }
        }
      }
    }
  }

  const metrics = planMetrics(selectedRoutes, options.speed);
  return {
    routes: selectedRoutes,
    ...metrics,
    baselineDuration,
    improvement: ((baselineDuration - metrics.duration) / baselineDuration) * 100,
    laneSpacing,
  };
}

export function positionAt(points: Point[], distance: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (!Number.isFinite(distance) || distance <= 0) return { ...points[0] };

  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distanceBetween(start, end);
    if (segmentLength === 0) continue;
    if (remaining <= segmentLength) {
      const fraction = remaining / segmentLength;
      return {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      };
    }
    remaining -= segmentLength;
  }
  return { ...points[points.length - 1] };
}

const GRID_SIZE = 50;
const CELL_SIZE = SIDE_KM / GRID_SIZE;

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetween(point, start);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function markSweptCells(covered: boolean[], start: Point, end: Point, radius: number): void {
  const minX = Math.max(0, Math.floor((Math.min(start.x, end.x) - radius) / CELL_SIZE));
  const maxX = Math.min(GRID_SIZE - 1, Math.floor((Math.max(start.x, end.x) + radius) / CELL_SIZE));
  const minY = Math.max(0, Math.floor((Math.min(start.y, end.y) - radius) / CELL_SIZE));
  const maxY = Math.min(GRID_SIZE - 1, Math.floor((Math.max(start.y, end.y) + radius) / CELL_SIZE));

  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      const index = row * GRID_SIZE + column;
      if (covered[index]) continue;
      const center = { x: (column + 0.5) * CELL_SIZE, y: (row + 0.5) * CELL_SIZE };
      if (distanceToSegment(center, start, end) <= radius) covered[index] = true;
    }
  }
}

function markRouteProgress(covered: boolean[], route: DroneRoute, distance: number, radius: number): void {
  let remaining = Math.min(distance, route.distance);
  for (let index = 1; index < route.points.length && remaining > 0; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const segmentLength = distanceBetween(start, end);
    if (segmentLength === 0) continue;
    const fraction = Math.min(1, remaining / segmentLength);
    const traveledEnd = {
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
    };
    markSweptCells(covered, start, traveledEnd, radius);
    remaining -= Math.min(remaining, segmentLength);
  }
}

export function coverageAt(
  plan: CoveragePlan,
  elapsed: number,
  speed: number,
  swath: number,
): number {
  if (!Number.isFinite(elapsed)) throw new RangeError("elapsed must be finite");
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be positive and finite");
  if (!Number.isFinite(swath) || swath <= 0) throw new RangeError("swath must be positive and finite");

  const covered = new Array<boolean>(GRID_SIZE * GRID_SIZE).fill(false);
  const distancePerDrone = (Math.max(0, elapsed) * speed) / 1000;
  for (const route of plan.routes) {
    markRouteProgress(covered, route, distancePerDrone, swath / 2000);
  }
  return (covered.filter(Boolean).length / covered.length) * 100;
}
