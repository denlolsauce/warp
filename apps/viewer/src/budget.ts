import * as pc from "playcanvas";

const MEASURE_DURATION_MS = 2000;

// Tier thresholds and budgets are this viewer's own defaults, not a spec from
// elsewhere: they bracket the same few-hundred-thousand-to-low-millions range
// the pipeline's own cap_max defaults use (400k overview / 600k area).
const FAST_THRESHOLD_MS = 12; // roughly 80fps+ headroom
const MEDIUM_THRESHOLD_MS = 20; // roughly 50-80fps

export const SPLAT_BUDGET_HIGH = 2_000_000;
export const SPLAT_BUDGET_MEDIUM = 800_000;
export const SPLAT_BUDGET_LOW = 300_000;

export function measureMedianFrameTimeMs(
  app: pc.AppBase,
  durationMs: number = MEASURE_DURATION_MS,
): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = [];
    const start = performance.now();

    const handler = (dt: number) => {
      samples.push(dt * 1000);
      if (performance.now() - start >= durationMs) {
        app.off("update", handler);
        samples.sort((a, b) => a - b);
        resolve(samples[Math.floor(samples.length / 2)]);
      }
    };

    app.on("update", handler);
  });
}

export function splatBudgetForFrameTime(medianMs: number): number {
  if (medianMs <= FAST_THRESHOLD_MS) return SPLAT_BUDGET_HIGH;
  if (medianMs <= MEDIUM_THRESHOLD_MS) return SPLAT_BUDGET_MEDIUM;
  return SPLAT_BUDGET_LOW;
}

export async function applyMeasuredGaussianBudget(app: pc.AppBase): Promise<number> {
  const medianMs = await measureMedianFrameTimeMs(app);
  const budget = splatBudgetForFrameTime(medianMs);
  app.scene.gsplat.splatBudget = budget;
  console.log(
    `[portal-viewer] median frame time ${medianMs.toFixed(2)}ms over first ${MEASURE_DURATION_MS}ms -> splat budget ${budget}`,
  );
  return budget;
}
