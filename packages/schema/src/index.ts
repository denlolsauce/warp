import { z } from "zod";

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

// [x, z] — the floor plane, dropping the up axis. Used for the floorplan
// image's world-space bounds.
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

export const ThresholdSchema = z.object({
  pos: Vec3Schema,
  radius: z.number(),
  connects: z.string(),
});
export type Threshold = z.infer<typeof ThresholdSchema>;

export const AreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  floor: z.string(),
  splatUrl: z.string(),
  bbox: z.tuple([Vec3Schema, Vec3Schema]),
  spawn: z.object({
    pos: Vec3Schema,
    yaw: z.number(),
  }),
  thresholds: z.array(ThresholdSchema),
});
export type Area = z.infer<typeof AreaSchema>;

export const OverviewSchema = z.object({
  common: z.string(),
  chunks: z.record(z.string(), z.string()),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const NavSchema = z.object({
  nodes: z.array(Vec3Schema),
  edges: z.array(z.tuple([z.number(), z.number()])),
});
export type Nav = z.infer<typeof NavSchema>;

export const SceneManifestSchema = z.object({
  tourId: z.string(),
  version: z.literal(1),
  upAxis: Vec3Schema,
  floorY: z.number(),
  overview: OverviewSchema.nullable(),
  // Top-down render of the overview splat + the world-space [[minX,minZ],
  // [maxX,maxZ]] it covers, for the viewer's minimap. Null under the same
  // condition overview is null (nothing to render without one); optional
  // (not just nullable) so manifests written before this field existed
  // still validate — the viewer just skips the minimap without it.
  floorplanUrl: z.string().nullish(),
  floorplanBounds: z.tuple([Vec2Schema, Vec2Schema]).nullish(),
  areas: z.array(AreaSchema),
  nav: NavSchema,
});
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
