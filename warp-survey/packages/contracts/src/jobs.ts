import { z } from "zod";
import { artifactKind } from "./artifacts";
import { comparisonMethod, SIGN_CONVENTION } from "./comparisons";
import { crsId, linearUnit, spatialReference, vector3 } from "./coordinates";
import { measurementQuality, visualizationQuality } from "./quality";

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

/**
 * Control point as the worker receives it. GCPs must carry image
 * observations: the pipeline refuses to fabricate control data, and
 * checkpoints are withheld from optimization entirely.
 */
export const jobControlPoint = z.object({
  label: z.string().min(1),
  role: z.enum(["GCP", "CHECKPOINT"]),
  easting: z.number(),
  northing: z.number(),
  elevation: z.number(),
  observations: z
    .array(z.object({ imageName: z.string().min(1), x: z.number(), y: z.number() }))
    .nullable(),
});

export const jobAcceptanceProfile = z.object({
  profileId: z.string().min(1),
  version: z.number().int().positive(),
  minCheckpointCount: z.number().int().nonnegative(),
  maxHorizontalRmseM: z.number().positive().nullable(),
  maxVerticalRmseM: z.number().positive(),
  maxAbsVerticalBiasM: z.number().positive(),
  minRegistrationRate: z.number().min(0).max(1),
});

/** Inputs the measurement branch reads; storage keys, never file contents. */
export const measurementJobPayload = z.object({
  imageKeys: z.array(z.string().min(1)).min(1),
  crs: crsId,
  verticalDatum: z.string().min(1),
  units: linearUnit,
  controlPoints: z.array(jobControlPoint),
  /** Corrected camera positions by image name: [lat, lon, alt, σlat, σlon, σalt]. */
  cameraPositions: z.record(z.string(), z.array(z.number()).length(6)),
  acceptanceProfile: jobAcceptanceProfile.nullable(),
});

export const visualizationJobPayload = z.object({
  imageKeys: z.array(z.string().min(1)).min(1),
  /** Reconstructed cameras from the survey's approved measurement run. */
  camerasArtifactKey: z.string().min(1),
  /** Engineering-frame origin the viewer frame is translated by. */
  localOrigin: z.tuple([z.number(), z.number(), z.number()]),
});

/** One epoch of a comparison: identity, reference system, and its artifacts. */
export const comparisonEpochPayload = z.object({
  revisionId: z.string().min(1),
  crs: crsId,
  verticalDatumId: z.string().min(1),
  measurementState: z.enum(["UNVERIFIED", "PASS", "FAIL"]),
  /** Assessed vertical uncertainty; null keeps the comparison exploratory. */
  verticalRmseM: z.number().nonnegative().nullable(),
  dsmKey: z.string().min(1).nullable(),
  cloudKey: z.string().min(1).nullable(),
});

export const comparisonJobPayload = z.object({
  comparisonId: z.string().min(1),
  method: z.enum(["ELEVATION_DIFFERENCING", "M3C2"]),
  baseline: comparisonEpochPayload,
  candidate: comparisonEpochPayload,
  /** [minEasting, minNorthing, maxEasting, maxNorthing] in the epoch CRS. */
  areaOfInterest: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  m3c2Parameters: z
    .object({
      normalRadiusM: z.number().positive(),
      projectionRadiusM: z.number().positive(),
      maxDepthM: z.number().positive(),
    })
    .nullable(),
  /** Paired points on reviewer-approved stable ground; never the moving surface. */
  stablePointPairs: z
    .array(
      z.object({
        moving: z.tuple([z.number(), z.number(), z.number()]),
        fixed: z.tuple([z.number(), z.number(), z.number()]),
      }),
    )
    .nullable(),
  stableAreaDescription: z.string().nullable(),
});

export const processingJobMessage = z.object({
  messageVersion: z.literal(1),
  /** ProcessingRun id — the durable Postgres record is the source of truth. */
  runId: z.string().min(1),
  kind: runKind,
  /** Null for COMPARISON runs, which span two surveys. */
  surveyId: z.string().min(1).nullable(),
  organizationId: z.string().min(1),
  /** Set for COMPARISON runs. */
  comparisonId: z.string().nullable(),
  /** Client-supplied idempotency key recorded at submission. */
  idempotencyKey: z.string().min(1),
  enqueuedAt: z.string().datetime(),
  /**
   * Everything the stage handlers need to run, resolved at submission time.
   * The worker never queries the application database for inputs — the
   * message is the contract, so a replayed message reproduces the run.
   */
  payload: z.union([measurementJobPayload, visualizationJobPayload, comparisonJobPayload]),
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

/** Worker → web publication callbacks (also plain JSON, validated both sides). */
export const publishedArtifact = z.object({
  kind: artifactKind,
  storageKey: z.string().min(1),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  spatialMetadata: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * A completed branch's durable outputs. The web app materializes these as the
 * revision/comparison rows the workspace reads; the worker never writes them
 * directly, so tenancy and immutability stay enforced in one place.
 */
export const publicationUpdate = z.object({
  messageVersion: z.literal(1),
  runId: z.string().min(1),
  /** Fencing token — a stale worker can never publish over a newer attempt. */
  fencingToken: z.number().int().positive(),
  branch: z.enum(["MEASUREMENT", "VISUALIZATION", "COMPARISON"]),
  artifacts: z.array(publishedArtifact),
  /** Set for MEASUREMENT: the checkpoint-QA verdict for this revision. */
  measurementQuality: measurementQuality.nullable(),
  /** Set for VISUALIZATION: gaussian count and review findings. */
  visualizationQuality: visualizationQuality.nullable(),
  /** Engineering-frame bounds of valid data, when the branch produces them. */
  bounds: z.object({ min: vector3, max: vector3 }).nullable(),
  /**
   * Set for MEASUREMENT: the published reference system, including the local
   * origin the viewer frame is derived from. Visualization runs read it back
   * rather than inventing an origin.
   */
  spatial: spatialReference.nullable(),
  /** Set for COMPARISON: the computed result, sign convention, and findings. */
  comparison: z
    .object({
      comparisonId: z.string().min(1),
      method: comparisonMethod,
      signConvention: z.literal(SIGN_CONVENTION),
      result: z.unknown(),
      exploratory: z.boolean(),
      registrationCorrection: z.unknown().nullable(),
      findings: z.array(z.string()),
    })
    .nullable(),
  provenance: z.record(z.string(), z.unknown()),
});

export type RunKind = z.infer<typeof runKind>;
export type StageId = z.infer<typeof stageId>;
export type ProcessingJobMessage = z.infer<typeof processingJobMessage>;
export type StageStatusUpdate = z.infer<typeof stageStatusUpdate>;
export type JobControlPoint = z.infer<typeof jobControlPoint>;
export type JobAcceptanceProfile = z.infer<typeof jobAcceptanceProfile>;
export type MeasurementJobPayload = z.infer<typeof measurementJobPayload>;
export type VisualizationJobPayload = z.infer<typeof visualizationJobPayload>;
export type ComparisonEpochPayload = z.infer<typeof comparisonEpochPayload>;
export type ComparisonJobPayload = z.infer<typeof comparisonJobPayload>;
export type PublishedArtifact = z.infer<typeof publishedArtifact>;
export type PublicationUpdate = z.infer<typeof publicationUpdate>;

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
