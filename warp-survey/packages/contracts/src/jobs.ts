import { z } from "zod";

/**
 * Queue wire format. Redis carries plain, language-neutral JSON — the
 * consumer is a Python worker. These schemas are exported to JSON Schema
 * (schema/*.json) and the Python side validates every message against them.
 */

export const runKind = z.enum(["MEASUREMENT", "VISUALIZATION", "COMPARISON"]);

/** Stage identifiers per run kind. Order is fixed within a kind. */
export const MEASUREMENT_STAGES = [
  "INPUT_VALIDATION",
  "RECONSTRUCTION",
  "DENSE_PRODUCTS",
  "CHECKPOINT_QA",
  "PUBLISH_MEASUREMENT",
] as const;

export const VISUALIZATION_STAGES = [
  "CAMERA_ADAPTATION",
  "SPLAT_TRAINING",
  "TERRAIN_SAFE_CLEANUP",
  "SOG_COMPRESSION",
  "PUBLISH_VISUALIZATION",
] as const;

export const COMPARISON_STAGES = [
  "COMPATIBILITY_CHECKS",
  "REGISTRATION",
  "CHANGE_COMPUTATION",
  "PUBLISH_COMPARISON",
] as const;

export const stageId = z.enum([
  ...MEASUREMENT_STAGES,
  ...VISUALIZATION_STAGES,
  ...COMPARISON_STAGES,
]);

export const processingJobMessage = z.object({
  messageVersion: z.literal(1),
  /** ProcessingRun id — the durable Postgres record is the source of truth. */
  runId: z.string().min(1),
  kind: runKind,
  surveyId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Set for COMPARISON runs. */
  comparisonId: z.string().nullable(),
  /** Client-supplied idempotency key recorded at submission. */
  idempotencyKey: z.string().min(1),
  enqueuedAt: z.string().datetime(),
});

/** Worker → web status callbacks (also plain JSON, validated both sides). */
export const stageStatusUpdate = z.object({
  messageVersion: z.literal(1),
  runId: z.string().min(1),
  stage: stageId,
  attempt: z.number().int().positive(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]),
  /** Fencing token — the web app rejects updates carrying a stale token. */
  fencingToken: z.number().int().positive(),
  /** Specific, human-readable reason; required when status is FAILED. */
  errorMessage: z.string().nullable(),
  /** True for transient infrastructure failures eligible for bounded retry. */
  transient: z.boolean().nullable(),
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  artifactKeys: z.array(z.string()),
  timingSeconds: z.number().nonnegative().nullable(),
});

export type RunKind = z.infer<typeof runKind>;
export type StageId = z.infer<typeof stageId>;
export type ProcessingJobMessage = z.infer<typeof processingJobMessage>;
export type StageStatusUpdate = z.infer<typeof stageStatusUpdate>;

export function stagesForKind(kind: RunKind): readonly StageId[] {
  switch (kind) {
    case "MEASUREMENT":
      return MEASUREMENT_STAGES;
    case "VISUALIZATION":
      return VISUALIZATION_STAGES;
    case "COMPARISON":
      return COMPARISON_STAGES;
  }
}
