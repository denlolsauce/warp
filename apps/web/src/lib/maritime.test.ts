import assert from "node:assert/strict";
import test from "node:test";
import { coverageAt, createPlan, positionAt } from "./maritime";

const options = {
  speed: 8,
  swath: 160,
  overlap: 20,
  strategy: "optimized" as const,
};

test("creates five bounded routes and covers the full square at completion", () => {
  const plan = createPlan(options);
  assert.equal(plan.routes.length, 5);
  assert.ok(plan.routes.every((route) => route.id >= 1 && route.id <= 5));
  assert.ok(plan.routes.every((route) => route.points.every(({ x, y }) => x >= 0 && x <= 10 && y >= 0 && y <= 10)));
  assert.ok(plan.routes.every((route) => route.distance > 0));
  assert.ok(plan.duration > 0);
  assert.ok(plan.totalDistance > 0);
  assert.ok(plan.laneSpacing <= (options.swath / 1000) * (1 - options.overlap / 100));
  assert.equal(coverageAt(plan, plan.duration, options.speed, options.swath), 100);
});

test("baseline is five vertical coverage strips", () => {
  const plan = createPlan({ ...options, strategy: "baseline" });
  assert.equal(plan.routes.length, 5);
  assert.equal(plan.duration, plan.baselineDuration);
  assert.equal(plan.improvement, 0);
  assert.equal(coverageAt(plan, plan.duration, options.speed, options.swath), 100);
  assert.ok(plan.routes.every((route) => route.points.some((point) => point.y === 0)));
});

test("speed changes duration and swath changes route spacing and distance", () => {
  const faster = createPlan({ ...options, speed: 16 });
  const wider = createPlan({ ...options, swath: 320 });
  const original = createPlan(options);
  assert.equal(faster.duration, original.duration / 2);
  assert.ok(wider.laneSpacing > original.laneSpacing);
  assert.ok(wider.totalDistance < original.totalDistance);
});

test("positionAt interpolates segments and clamps at path ends", () => {
  const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
  assert.deepEqual(positionAt(points, -1), points[0]);
  assert.deepEqual(positionAt(points, 1.5), { x: 1.5, y: 0 });
  assert.deepEqual(positionAt(points, 5), { x: 3, y: 2 });
  assert.deepEqual(positionAt(points, 20), points[2]);
  assert.deepEqual(positionAt([], 1), { x: 0, y: 0 });
});

test("coverage is based on traveled swaths, not elapsed-time percentage", () => {
  const plan = createPlan(options);
  const halfwayTime = plan.duration / 2;
  const partial = coverageAt(plan, halfwayTime, options.speed, options.swath);
  const full = coverageAt(plan, plan.duration, options.speed, options.swath);
  assert.ok(partial > 0 && partial < 100);
  assert.equal(full, 100);
  assert.equal(coverageAt(plan, 0, options.speed, options.swath), 0);
});
