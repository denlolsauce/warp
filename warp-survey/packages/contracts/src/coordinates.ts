import { z } from "zod";

/**
 * Every artifact identifies its CRS, vertical datum, and units explicitly.
 * Engineering coordinates stay in double precision; the viewer renders
 * relative to a local origin near the site to avoid float32 jitter at
 * projected-coordinate magnitudes.
 */

/** EPSG-style CRS identifier, e.g. "EPSG:25832". Free-form WKT is not accepted on the wire. */
export const crsId = z.string().regex(/^EPSG:\d+$/, "expected an EPSG code like EPSG:25832");

export const verticalDatum = z.object({
  /** e.g. "EPSG:7837" (DHHN2016 height) or "ELLIPSOIDAL" when heights are ellipsoidal. */
  id: z.string().min(1),
  description: z.string().optional(),
});

export const linearUnit = z.enum(["metre", "us_survey_foot", "international_foot"]);

/** Column-major 4x4 homogeneous transform, 16 numbers, double precision. */
export const matrix4 = z.array(z.number()).length(16);

export const vector3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * One explicit step in the transform chain. The three canonical frames are:
 *  1. RECONSTRUCTION — the photogrammetry backend's internal frame.
 *  2. ENGINEERING — projected CRS + vertical datum (the measurement frame).
 *  3. LOCAL_VIEWER — engineering frame translated by localOrigin for rendering.
 */
export const coordinateFrame = z.enum(["RECONSTRUCTION", "ENGINEERING", "LOCAL_VIEWER"]);

export const coordinateTransform = z.object({
  from: coordinateFrame,
  to: coordinateFrame,
  /** Rigid or similarity transform as a 4x4 matrix in double precision. */
  matrix: matrix4,
  /** Bounded uncertainty of the transform in engineering units, when assessed. */
  uncertaintyMetres: z.number().nonnegative().nullable(),
  derivation: z.string().min(1),
});

export const spatialReference = z.object({
  horizontalCrs: crsId,
  verticalDatum,
  unit: linearUnit,
  /** Engineering-frame coordinates of the viewer's local origin (double precision). */
  localOrigin: vector3,
  transforms: z.array(coordinateTransform),
});

export type CrsId = z.infer<typeof crsId>;
export type VerticalDatum = z.infer<typeof verticalDatum>;
export type CoordinateFrame = z.infer<typeof coordinateFrame>;
export type CoordinateTransform = z.infer<typeof coordinateTransform>;
export type SpatialReference = z.infer<typeof spatialReference>;
