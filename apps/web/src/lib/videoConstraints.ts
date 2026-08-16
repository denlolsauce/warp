// Shared between client-side validation (/new) and server-side credit
// accounting (/api/tours) so the numbers only live in one place.
export const MIN_DURATION_SEC = 30;
export const MAX_DURATION_SEC = 6 * 60;
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB, above R2/S3's 5 MB part minimum

export const TOUR_CREDIT_COST = 20;
export const ADDITIONAL_AREA_CREDIT_COST = 10;

export const CAPTURE_CHECKLIST = [
  "Ultrawide lens (0.5x iPhone / 0.6x Android)",
  "Exposure and focus LOCKED",
  "Phone vertical, chest height",
  "Walk ~1 step per second; stop, turn slowly, then continue",
  "Two perimeter loops in opposite directions, then a diagonal cross, then close-ups at 30-60 cm",
  "Lights on, blinds open, TVs off, nothing moved",
] as const;

// Sequencing/continuity rules across the whole multi-video capture, distinct
// from CAPTURE_CHECKLIST's per-video filming technique above.
export const MULTI_ROOM_GUIDANCE = [
  "Record the overview first: whole property, natural walking flow, ~8-10s per room, finish where you started.",
  "Each area video must START UNDER THE DOOR FRAME, looking into the room. This is what lets the pipeline stitch the area to the overview — it is the single most important rule in multi-room capture.",
  "Long corridors are their own area, traversed in both directions.",
  "Do not move anything between videos.",
] as const;
