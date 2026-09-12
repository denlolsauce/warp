import { z } from "zod";
import { spatialReference, vector3 } from "./coordinates";
import { measurementQuality, visualizationQuality } from "./quality";

export const artifactKind = z.enum([
  // Measurement branch
  "DENSE_POINT_CLOUD_LAZ",
  "DSM_COG",
  "DTM_COG",
  "ORTHOMOSAIC_COG",
  "COVERAGE_MASK",
  "EXCLUSION_MASK",
  "QUALITY_RECORD",
  // Visualization branch
  "SPLAT_SOG",
  "SPLAT_PREVIEW_SOG",
  "POSTER_IMAGE",
  // Comparison outputs
  "CHANGE_RASTER_COG",
  "M3C2_CLOUD_LAZ",
  "COMPARISON_RECORD",
  // Reports
  "REPORT_PDF",
  "EXPORT_CSV",
]);

export const artifactRef = z.object({
  artifactId: z.string().min(1),
  kind: artifactKind,
  storageKey: z.string().min(1),
  /** SHA-256 of the stored bytes; verified before a stage records success. */
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

export const boundingBox = z.object({
  /** Engineering-frame min/max corners, double precision. */
  min: vector3,
  max: vector3,
});

export const provenance = z.object({
  pipelineVersion: z.string().min(1),
  backendName: z.string().min(1),
  backendVersion: z.string().min(1),
  containerDigest: z.string().nullable(),
  /** Hash of the full stage configuration used for this run. */
  configHash: z.string().min(1),
  packageVersions: z.record(z.string(), z.string()),
});

export const namedViewpoint = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** LOCAL_VIEWER frame. */
  position: vector3,
  target: vector3,
});

export const splatChunk = z.object({
  id: z.string().min(1),
  storageKey: z.string().min(1),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  /** LOCAL_VIEWER frame bounds for chunk-aware loading. */
  bounds: boundingBox,
  gaussianCount: z.number().int().nonnegative(),
});

/**
 * The versioned manifest for one processed survey revision. This is the
 * single contract between pipeline outputs, the workspace, and the viewer.
 */
export const surveyManifest = z.object({
  manifestVersion: z.literal(1),
  surveyId: z.string().min(1),
  /** Immutable revision of processed outputs; a reprocess creates a new revision. */
  revisionId: z.string().min(1),
  siteId: z.string().min(1),
  capturedAt: z.string().datetime(),
  spatial: spatialReference,
  /** Engineering-frame bounds of valid data. */
  bounds: boundingBox,
  artifacts: z.array(artifactRef),
  measurementQuality,
  visualizationQuality,
  provenance,
  viewer: z
    .object({
      posterArtifactId: z.string().nullable(),
      previewArtifactId: z.string().nullable(),
      chunks: z.array(splatChunk),
      defaultCamera: z.object({ position: vector3, target: vector3 }),
      viewpoints: z.array(namedViewpoint),
    })
    .nullable(),
});

export type ArtifactKind = z.infer<typeof artifactKind>;
export type ArtifactRef = z.infer<typeof artifactRef>;
export type BoundingBox = z.infer<typeof boundingBox>;
export type Provenance = z.infer<typeof provenance>;
export type SplatChunk = z.infer<typeof splatChunk>;
export type SurveyManifest = z.infer<typeof surveyManifest>;
