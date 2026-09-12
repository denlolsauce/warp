import { z } from "zod";
import { boundingBox, artifactRef } from "./artifacts";
import { matrix4 } from "./coordinates";

export const comparisonMethod = z.enum(["ELEVATION_DIFFERENCING", "M3C2"]);

/**
 * Sign convention (fixed, appears in maps, legends, exports, and reports):
 * elevation change = later minus earlier; positive = fill, negative = cut.
 */
export const SIGN_CONVENTION =
  "Elevation change is later minus earlier. Positive values indicate fill; negative values indicate cut." as const;

export const registrationCorrection = z.object({
  /** Rigid transform estimated on approved stable areas only. */
  matrix: matrix4,
  stableAreaDescription: z.string().min(1),
  residualRmseM: z.number().nonnegative(),
});

export const elevationDifferencingResult = z.object({
  method: z.literal("ELEVATION_DIFFERENCING"),
  gridResolutionM: z.number().positive(),
  cutVolumeM3: z.number().nonnegative(),
  fillVolumeM3: z.number().nonnegative(),
  netVolumeM3: z.number(),
  affectedAreaM2: z.number().nonnegative(),
  /**
   * Volume uncertainty must account for spatially correlated error; it is
   * never computed by assuming independent per-cell errors. Null means
   * uncertainty could not be assessed and the comparison stays exploratory.
   */
  volumeUncertaintyM3: z.number().nonnegative().nullable(),
  detectionThresholdM: z.number().positive().nullable(),
});

export const m3c2Result = z.object({
  method: z.literal("M3C2"),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Signed surface distances; NOT displacement vectors or a stability result. */
  meanSignedDistanceM: z.number(),
  significantChangeFraction: z.number().min(0).max(1),
  registrationUncertaintyM: z.number().nonnegative().nullable(),
});

export const comparisonManifest = z.object({
  manifestVersion: z.literal(1),
  comparisonId: z.string().min(1),
  siteId: z.string().min(1),
  /** Exact approved survey revisions being compared. */
  baselineRevisionId: z.string().min(1),
  candidateRevisionId: z.string().min(1),
  method: comparisonMethod,
  areaOfInterest: boundingBox.nullable(),
  registrationCorrection: registrationCorrection.nullable(),
  signConvention: z.literal(SIGN_CONVENTION),
  result: z.discriminatedUnion("method", [elevationDifferencingResult, m3c2Result]).nullable(),
  /** Exploratory comparisons are ineligible for engineering approval. */
  exploratory: z.boolean(),
  artifacts: z.array(artifactRef),
  maskArtifactIds: z.array(z.string()),
});

export type ComparisonMethod = z.infer<typeof comparisonMethod>;
export type ComparisonManifest = z.infer<typeof comparisonManifest>;
