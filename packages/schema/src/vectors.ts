import { z } from "zod";

// Shared by the scene manifest and the change report. In its own module
// rather than in index.ts so changeReport.ts can use it without importing
// the barrel that re-exports changeReport.ts — a cycle that would leave one
// of the two zod consts undefined at module-evaluation time depending on
// which entry point loaded first.

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

// [x, z] — the floor plane, dropping the up axis. Used for the floorplan
// image's world-space bounds.
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;
