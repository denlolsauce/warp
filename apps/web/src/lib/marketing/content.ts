/**
 * Copy and data for the marketing site (`src/app/(marketing)`), lifted from the
 * "Warp Site" design. Kept in one place so the pages stay layout-only.
 */

export const stats = [
  { value: "2 min", label: "of handheld video is the whole input" },
  { value: "< 2 hrs", label: "from upload to live embed" },
  { value: "4-20 MB", label: "delivered asset, poster included" },
  { value: "1 tag", label: "to put it on your product page" },
];

export const steps = [
  {
    num: "01",
    name: "Capture",
    body: "Two minutes on a phone: a few slow orbits at different heights, then one pass from above. A checklist walks you through it before you shoot.",
    meta: "2 min of video",
  },
  {
    num: "02",
    name: "Upload",
    body: "Drop the clip in and it goes straight to storage. It is checked for length, sharpness and motion before anything expensive starts.",
    meta: "checked on arrival",
  },
  {
    num: "03",
    name: "Process",
    body: "Frames, camera solve, training, cleanup and compression run as one job you can watch stage by stage. No opaque spinner.",
    meta: "under 2 hours",
  },
  {
    num: "04",
    name: "Edit and manage captures",
    body: "Reframe, set the default angle, adjust exposure, brush out stragglers, then publish, re-run or download any capture from one library.",
    meta: "one embed per model",
  },
];

export const embedPoints = [
  "Shadow-isolated, so your CSS and framework cannot collide with it.",
  "Poster image first, geometry second - nothing blocks first paint.",
  "Initialises only when it scrolls into view.",
  "Falls back to a rendered turntable video on old hardware.",
];

/** What the copy button on the embed panel puts on the clipboard. */
export const EMBED_SNIPPET = [
  '<script src="https://cdn.warp3d.io/v1.js"></script>',
  '<warp-viewer model="ribbed-vase"></warp-viewer>',
].join("\n");

export type GalleryItem = {
  name: string;
  category: string;
  size: string;
  clip: string;
  gaussians: string;
  build: string;
  /** Placeholder caption, shown when there is no `model` to render. */
  slot: string;
  /** Path to a .sog under /public. Cards without one keep the placeholder. */
  model?: string;
  startRadius?: number;
};

export const galleryItems: GalleryItem[] = [
  {
    name: "Vase",
    category: "Ceramics",
    size: "8.8 MB",
    clip: "2:04",
    gaussians: "600k",
    build: "1h 18m",
    slot: "vase - hero angle",
    // Straight out of training: the vase plus the room it was filmed in.
    model: "/vase2_unpruned.sog",
    startRadius: 1.6,
  },
  {
    name: "Vase Pruned",
    category: "Ceramics",
    size: "7.4 MB",
    clip: "1:58",
    gaussians: "420k",
    build: "1h 06m",
    slot: "teapot - spout side",
    // The same capture after cleanup: room gone, product isolated. Uses the
    // solidified prune, not the original tight one — pruning to the product's
    // outer shell alone strips the low-opacity interior detail with the
    // background and leaves it looking see-through.
    model: "/vase2.sog",
    startRadius: 2,
  },
];

// Derived from the items rather than listed by hand: a hardcoded list leaves a
// filter behind whenever an item is removed, and selecting it shows an empty
// grid with no way back except "All".
export const galleryCategories = [
  "All",
  ...Array.from(new Set(galleryItems.map((item) => item.category))),
];

/** `galleryColumns` in the design: an editor-tunable 2-4. */
export const GALLERY_COLUMNS = 3;

export const waitlistSteps = [
  {
    num: "01",
    title: "Tell us what you make",
    body: "Material and finish decide how hard a capture is - glossy and featureless are the tricky ones.",
  },
  {
    num: "02",
    title: "Shoot one object with us",
    body: "A short call, your phone, and a two-minute orbit. We watch the first take and correct it live.",
  },
  {
    num: "03",
    title: "Get the embed back same day",
    body: "One model, one snippet, live on a staging page before you commit to anything.",
  },
];

export const volumeOptions = ["1-10", "10-50", "50-200", "200+"];
