import { z } from "zod";

/**
 * Quality gates are tri-state. Reviewer approval can never convert FAIL into
 * PASS; revised inputs or a documented revised acceptance profile require a
 * new evaluation. Measurement and visualization statuses are independent —
 * a convincing splat cannot make an invalid survey engineering-ready.
 */
export const qualityState = z.enum(["UNVERIFIED", "PASS", "FAIL"]);

export const checkpointResiduals = z.object({
  count: z.number().int().nonnegative(),
  horizontalRmseM: z.number().nonnegative().nullable(),
  verticalRmseM: z.number().nonnegative().nullable(),
  horizontalBiasM: z.number().nullable(),
  verticalBiasM: z.number().nullable(),
  maxHorizontalResidualM: z.number().nonnegative().nullable(),
  maxVerticalResidualM: z.number().nonnegative().nullable(),
  /** Human summary of spatial distribution adequacy, set by the QA stage. */
  distributionNote: z.string().nullable(),
});

export const measurementQuality = z.object({
  state: qualityState,
  /**
   * Independent checkpoints only — these observations were withheld from
   * reconstruction optimization. Null when no checkpoints were supplied,
   * which keeps the survey UNVERIFIED.
   */
  checkpoints: checkpointResiduals.nullable(),
  groundSamplingDistanceM: z.number().positive().nullable(),
  registeredImages: z.number().int().nonnegative(),
  totalImages: z.number().int().nonnegative(),
  /** Identifier + version of the acceptance profile this was evaluated against. */
  acceptanceProfileId: z.string().nullable(),
  acceptanceProfileVersion: z.number().int().positive().nullable(),
  /** Specific human-readable reasons for FAIL / remaining limitations for PASS. */
  findings: z.array(z.string()),
});

export const visualizationQuality = z.object({
  state: qualityState,
  gaussianCount: z.number().int().nonnegative().nullable(),
  findings: z.array(z.string()),
});

export type QualityState = z.infer<typeof qualityState>;
export type CheckpointResiduals = z.infer<typeof checkpointResiduals>;
export type MeasurementQuality = z.infer<typeof measurementQuality>;
export type VisualizationQuality = z.infer<typeof visualizationQuality>;
