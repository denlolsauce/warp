import type { SceneManifest } from "@portal/schema";

export interface Point2 {
  x: number;
  z: number;
}

export interface NavGraph {
  positions: Point2[];
  adjacency: number[][];
  edges: [number, number][];
}

// The tube is defined purely in the horizontal (X, Z) plane. Eye height is a
// separately enforced invariant (locked to floorY + eye height, independent
// of the path), so Y never enters the constraint or pathfinding math here.
export function buildNavGraph(nav: SceneManifest["nav"]): NavGraph {
  const positions: Point2[] = nav.nodes.map(([x, , z]) => ({ x, z }));
  const adjacency: number[][] = positions.map(() => []);
  const edges: [number, number][] = nav.edges.map(([a, b]) => [a, b]);
  for (const [a, b] of edges) {
    adjacency[a]?.push(b);
    adjacency[b]?.push(a);
  }
  return { positions, adjacency, edges };
}

function distanceSq(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export interface EdgeProjection {
  point: Point2;
  edge: [number, number];
}

// Closest point across every edge in the graph. O(E) — fine at the
// few-hundred-edge scale a single-property nav graph produces, and a global
// scan sidesteps "which local edges to check" bugs a spatial-partition
// shortcut would risk right at branch points.
export function projectOntoNearestEdge(graph: NavGraph, point: Point2): EdgeProjection {
  let best: EdgeProjection | null = null;
  let bestDistSq = Infinity;

  for (const edge of graph.edges) {
    const [a, b] = edge;
    const pa = graph.positions[a];
    const pb = graph.positions[b];
    const abx = pb.x - pa.x;
    const abz = pb.z - pa.z;
    const lenSq = abx * abx + abz * abz;
    const t =
      lenSq > 1e-9
        ? Math.max(0, Math.min(1, ((point.x - pa.x) * abx + (point.z - pa.z) * abz) / lenSq))
        : 0;
    const candidate: Point2 = { x: pa.x + abx * t, z: pa.z + abz * t };
    const dSq = distanceSq(point, candidate);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = { point: candidate, edge };
    }
  }

  if (!best) throw new Error("nav graph has no edges to project onto");
  return best;
}

// Hard lateral clamp: the user must never leave the tube, since splat
// quality collapses away from the recorded camera trajectory (CLAUDE.md).
export function clampToTube(desired: Point2, edgePoint: Point2, maxDeviation: number): Point2 {
  const dx = desired.x - edgePoint.x;
  const dz = desired.z - edgePoint.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDeviation || dist === 0) return desired;
  const scale = maxDeviation / dist;
  return { x: edgePoint.x + dx * scale, z: edgePoint.z + dz * scale };
}

export function nearestNode(graph: NavGraph, point: Point2): number {
  let best = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < graph.positions.length; i++) {
    const dSq = distanceSq(point, graph.positions[i]);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = i;
    }
  }
  return best;
}

// A* with a Euclidean heuristic — admissible since straight-line distance
// never overestimates true path length along graph edges. Graphs here run
// to a few hundred nodes at most, so a plain O(n) frontier scan beats the
// bookkeeping of a binary heap.
export function findPath(graph: NavGraph, startNode: number, goalNode: number): number[] {
  if (startNode === goalNode) return [startNode];

  const dist = (a: number, b: number): number =>
    Math.hypot(graph.positions[a].x - graph.positions[b].x, graph.positions[a].z - graph.positions[b].z);

  const open = new Set<number>([startNode]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startNode, 0]]);
  const fScore = new Map<number, number>([[startNode, dist(startNode, goalNode)]]);

  while (open.size > 0) {
    let current = -1;
    let currentF = Infinity;
    for (const node of open) {
      const f = fScore.get(node) ?? Infinity;
      if (f < currentF) {
        currentF = f;
        current = node;
      }
    }

    if (current === goalNode) {
      const path = [current];
      let node = current;
      while (cameFrom.has(node)) {
        node = cameFrom.get(node) as number;
        path.unshift(node);
      }
      return path;
    }

    open.delete(current);
    for (const neighbor of graph.adjacency[current] ?? []) {
      const tentativeG = (gScore.get(current) ?? Infinity) + dist(current, neighbor);
      if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + dist(neighbor, goalNode));
        open.add(neighbor);
      }
    }
  }

  return [startNode]; // goal unreachable (disconnected graph) — stay put rather than teleport
}

function catmullRom(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

// Arc-length-parameterized Catmull-Rom through a route's waypoints, so a
// click-to-walk ease glides through doorway-crossing kinks instead of
// visiting them as sharp corners.
export class RouteSpline {
  private readonly points: Point2[];
  private readonly cumulativeLength: number[];
  readonly totalLength: number;

  constructor(points: Point2[]) {
    this.points = points;
    this.cumulativeLength = [0];
    for (let i = 1; i < points.length; i++) {
      const step = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      this.cumulativeLength.push(this.cumulativeLength[i - 1] + step);
    }
    this.totalLength = this.cumulativeLength[this.cumulativeLength.length - 1] ?? 0;
  }

  sampleAtFraction(fraction: number): Point2 {
    if (this.points.length === 1) return this.points[0];
    const targetDist = Math.max(0, Math.min(this.totalLength, fraction * this.totalLength));

    let segment = 0;
    while (segment < this.cumulativeLength.length - 2 && this.cumulativeLength[segment + 1] < targetDist) {
      segment++;
    }

    const segStart = this.cumulativeLength[segment];
    const segEnd = this.cumulativeLength[segment + 1] ?? segStart;
    const segLen = Math.max(segEnd - segStart, 1e-6);
    const t = (targetDist - segStart) / segLen;

    const p0 = this.points[Math.max(0, segment - 1)];
    const p1 = this.points[segment];
    const p2 = this.points[Math.min(this.points.length - 1, segment + 1)];
    const p3 = this.points[Math.min(this.points.length - 1, segment + 2)];
    return catmullRom(p0, p1, p2, p3, t);
  }
}
