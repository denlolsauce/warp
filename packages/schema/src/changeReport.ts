import { z } from "zod";

import { Vec3Schema } from "./vectors";

/**
 * The contract between the pipeline's `monitor` stage
 * (pipeline/src/splat_pipeline/geo/survey.py's SurveyResult.as_report) and
 * everything that displays a survey: the web app's report view and the
 * viewer's change overlay.
 *
 * Every measurement in here carries its own uncertainty, and that is
 * structural rather than decorative. A change distance without its level of
 * detection is not a result — a UI that renders one without the other
 * invites reading alignment noise as movement, which is the specific
 * failure this whole subsystem exists to prevent. So the schema makes the
 * error term non-optional everywhere the measurement is present.
 */

export const VolumeEstimateSchema = z.object({
  netM3: z.number(),
  // Reported separately from netM3, never derived from it: material off a
  // crest and the same volume at the toe nets to zero, and that is a
  // developing failure, not an absence of change.
  gainM3: z.number().nonnegative(),
  lossM3: z.number().nonnegative(),
  uncertaintyM3: z.number().nonnegative(),
  surfaceAreaM2: z.number().nonnegative(),
  cellSizeM: z.number().nonnegative(),
  cellCount: z.number().int().nonnegative(),
  // Surface too close to perpendicular to the projection plane to
  // integrate. Non-zero means the quoted volume excludes real area, so a
  // UI has to be able to say so rather than presenting a complete total.
  excludedSteepAreaM2: z.number().nonnegative(),
});
export type VolumeEstimate = z.infer<typeof VolumeEstimateSchema>;

export const ChangeFindingSchema = z.object({
  /** Queue position: 0 is the largest measured movement on site. */
  clusterId: z.number().int().nonnegative(),
  direction: z.enum(["loss", "gain"]),
  pointCount: z.number().int().positive(),
  centroid: Vec3Schema,
  bbox: z.tuple([Vec3Schema, Vec3Schema]),
  /** Signed along the local surface normal; sign matches `direction`. */
  peakDistanceM: z.number(),
  meanDistanceM: z.number(),
  peakLevelOfDetectionM: z.number().nonnegative(),
  /**
   * |peak| / its own level of detection. 1.0 sits exactly at the limit of
   * what this survey can resolve, so a UI should visibly distinguish a
   * finding near 1 from one at 10 — the raw millimetres alone do not.
   */
  peakConfidenceRatio: z.number().nonnegative(),
  volume: VolumeEstimateSchema,
});
export type ChangeFinding = z.infer<typeof ChangeFindingSchema>;

export const SurveyMethodSchema = z.object({
  changeDetection: z.string(),
  georeferencing: z.string(),
  fineAlignment: z.string(),
  pointSpacingM: z.number().positive(),
  normalRadiusM: z.number().positive(),
  cylinderRadiusM: z.number().positive(),
  cylinderHalfLengthM: z.number().positive(),
  upAxis: Vec3Schema,
});

/**
 * Whether the findings can be trusted at all — deliberately a peer of
 * `findings` rather than nested inside it, so a consumer cannot render a
 * report without having had the chance to read its precision first.
 */
export const SurveyPrecisionSchema = z.object({
  baselineControlRmseM: z.number().nonnegative(),
  repeatControlRmseM: z.number().nonnegative(),
  registrationRmseM: z.number().nonnegative(),
  registrationConverged: z.boolean(),
  registrationInlierCount: z.number().int().nonnegative(),
  scaleMPerUnit: z.object({
    baseline: z.number().positive(),
    repeat: z.number().positive(),
  }),
});

export const ChangeSummarySchema = z.object({
  corePoints: z.number().int().nonnegative(),
  /**
   * Fraction of core points with a usable counterpart in both captures.
   * Distinct from significantFraction: unmeasured ground is a reason to
   * re-fly, whereas insignificant change is a positive finding of
   * stability. A low value invalidates the whole survey.
   */
  measuredFraction: z.number().min(0).max(1),
  significantFraction: z.number().min(0).max(1),
  medianLevelOfDetectionM: z.number().nonnegative().nullable(),
  maxLossM: z.number().nonnegative().nullable(),
  maxGainM: z.number().nonnegative().nullable(),
  registrationErrorM: z.number().nonnegative(),
  confidenceLevel: z.number().min(0).max(1),
});

export const ChangeReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  /** Capture labels (dates), for the "since 14 March" the report leads with. */
  baseline: z.string(),
  repeat: z.string(),
  method: SurveyMethodSchema,
  precision: SurveyPrecisionSchema,
  change: ChangeSummarySchema,
  siteVolume: VolumeEstimateSchema,
  /** Ranked largest-movement-first: the inspection queue. */
  findings: z.array(ChangeFindingSchema),
});
export type ChangeReport = z.infer<typeof ChangeReportSchema>;
