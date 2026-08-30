// Shared between client-side validation (upload flow) and server-side
// ingest validation (pipeline Stage 1) so the numbers only live in one
// place. CLAUDE.md's Ingest stage is explicit about the two hard rejects:
// under MIN_DURATION_SEC, or above MAX_RESOLUTION_HEIGHT_PX @ MAX_FPS.
export const MIN_DURATION_SEC = 60;
export const TARGET_MAX_DURATION_SEC = 4 * 60; // "2-4 minute video" — soft guidance, not a hard reject
export const MAX_RESOLUTION_HEIGHT_PX = 2160; // 4K
export const MAX_FPS = 60;
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB, above R2/S3's 5 MB part minimum

export const CAPTURE_CHECKLIST = [
  "Single product, on a plain background, filling most of the frame",
  "Exposure and focus LOCKED before you start recording",
  "3-4 orbits around the product at different heights (low, chest, high)",
  "Finish with one top-down pass",
  "Move slowly and steadily — motion blur is the single biggest quality killer",
  "Keep the product still and the lighting constant for the whole video",
] as const;
