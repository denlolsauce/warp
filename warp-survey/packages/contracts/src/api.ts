import { z } from "zod";
import { crsId } from "./coordinates";

/** Request/response bodies for /api/v1. */

export const createSiteRequest = z.object({
  name: z.string().min(1).max(200),
  horizontalCrs: crsId,
  verticalDatumId: z.string().min(1),
  /** GeoJSON polygon boundary in the site CRS; validated server-side. */
  boundary: z.unknown().nullable(),
});

export const createSurveyRequest = z.object({
  siteId: z.string().min(1),
  capturedAt: z.string().datetime(),
  notes: z.string().max(2000).nullable(),
});

export const captureFileKind = z.enum([
  "DRONE_JPEG",
  "VIDEO_MP4",
  "VIDEO_MOV",
  "RTK_POSITIONS_CSV",
  "GCP_CSV",
  "CHECKPOINT_CSV",
]);

export const initiateUploadRequest = z.object({
  surveyId: z.string().min(1),
  kind: captureFileKind,
  filename: z.string().min(1).max(500),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const initiateUploadResponse = z.object({
  captureFileId: z.string(),
  uploadId: z.string(),
  storageKey: z.string(),
  partSizeBytes: z.number().int().positive(),
});

export const signPartRequest = z.object({
  captureFileId: z.string().min(1),
  uploadId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
});

export const completeUploadRequest = z.object({
  captureFileId: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })),
});

export const abortUploadRequest = z.object({
  captureFileId: z.string().min(1),
  uploadId: z.string().min(1),
});

export const controlPointRole = z.enum(["GCP", "CHECKPOINT"]);

export const controlPointImport = z.object({
  surveyId: z.string().min(1),
  role: controlPointRole,
  points: z
    .array(
      z.object({
        label: z.string().min(1),
        easting: z.number(),
        northing: z.number(),
        elevation: z.number(),
        horizontalAccuracyM: z.number().positive().nullable(),
        verticalAccuracyM: z.number().positive().nullable(),
      }),
    )
    .min(1),
});

export const submitProcessingRequest = z.object({
  surveyId: z.string().min(1),
  kinds: z.array(z.enum(["MEASUREMENT", "VISUALIZATION"])).min(1),
});

export const submitComparisonRequest = z.object({
  siteId: z.string().min(1),
  baselineRevisionId: z.string().min(1),
  candidateRevisionId: z.string().min(1),
  method: z.enum(["ELEVATION_DIFFERENCING", "M3C2"]),
  /** Optional AOI as engineering-frame bounds. */
  areaOfInterest: z
    .object({
      minEasting: z.number(),
      minNorthing: z.number(),
      maxEasting: z.number(),
      maxNorthing: z.number(),
    })
    .nullable(),
});

/** 202 body for submissions. */
export const jobAcceptedResponse = z.object({
  runId: z.string(),
  status: z.literal("QUEUED"),
  statusUrl: z.string(),
});

export const createShareLinkRequest = z.object({
  /** Scope: exact published revisions only. */
  surveyRevisionIds: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime(),
  label: z.string().max(200).nullable(),
});

export const pilotRequestBody = z.object({
  name: z.string().min(1).max(200),
  workEmail: z.string().email().max(320),
  company: z.string().min(1).max(200),
  useCase: z.string().min(1).max(200),
  siteCount: z.string().min(1).max(50),
  surveyFrequency: z.string().min(1).max(100),
  notes: z.string().max(2000).optional(),
});

export type CreateSiteRequest = z.infer<typeof createSiteRequest>;
export type CreateSurveyRequest = z.infer<typeof createSurveyRequest>;
export type CaptureFileKind = z.infer<typeof captureFileKind>;
export type InitiateUploadRequest = z.infer<typeof initiateUploadRequest>;
export type ControlPointImport = z.infer<typeof controlPointImport>;
export type SubmitProcessingRequest = z.infer<typeof submitProcessingRequest>;
export type SubmitComparisonRequest = z.infer<typeof submitComparisonRequest>;
export type PilotRequestBody = z.infer<typeof pilotRequestBody>;
