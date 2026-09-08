/**
 * Typed marketing content. Every quantitative or capability claim carries an
 * evidence status so unsupported claims cannot silently ship: `verified`
 * claims cite internal evidence, `target` claims must be worded as targets.
 */

export type ClaimStatus = "verified" | "target";

export interface Claim {
  text: string;
  status: ClaimStatus;
  /** Where the evidence lives (benchmark doc, validation report) once it exists. */
  evidence: string | null;
}

export const hero = {
  headline: "Measure site change. Share the full picture. From the same drone flight.",
  subheadline:
    "Turn repeat drone surveys into validated measurement outputs, documented change comparisons, and a shareable 3D site view—without moving every survey through disconnected tools.",
  primaryCta: { label: "Book a pilot", href: "/pilot" },
  secondaryCta: { label: "See the workflow", href: "#how-it-works" },
} as const;

export const problem = {
  title: "Today, every survey crosses four disconnected tools",
  flow: ["Fly", "Desktop photogrammetry", "Separate analysis", "Manual comparison", "Report assembly"],
  pains: [
    "Repeated exports between photogrammetry, GIS, and CAD tools",
    "Inconsistent revisions — nobody is sure which surface a number came from",
    "Days of preparation before findings reach the project team",
    "Findings that non-engineers can't read without a site walk",
  ],
} as const;

export const howItWorks = {
  title: "How it works",
  steps: [
    { title: "Upload imagery and survey control", body: "Original drone photos, RTK/PPK positions, ground control, and independent checkpoints — direct to secure storage." },
    { title: "Process measurement data and a linked 3D visual", body: "A georeferenced dense point cloud and elevation model, plus a photorealistic splat from the same flight and coordinate system." },
    { title: "Compare survey dates and review the report", body: "Elevation differencing or M3C2 between approved epochs, with uncertainty, sign conventions, and reviewer approval." },
    { title: "Share approved findings and the browser viewer", body: "Expiring, revocable links to exact published revisions — the report and the 3D view stay in step." },
  ],
} as const;

export const twoOutputs = {
  title: "Two linked outputs from one flight",
  engineers: {
    title: "For engineers",
    items: [
      "Georeferenced point cloud and elevation model",
      "Measurement and change analysis",
      "QA, uncertainty, and engineering exports",
    ],
  },
  stakeholders: {
    title: "For clients, regulators, and project teams",
    items: [
      "Photorealistic Gaussian Splat",
      "Visual context and communication",
      "Browser link and named viewpoints",
    ],
  },
  clarifier:
    "Both outputs refer to the same capture epoch and coordinate system. The splat is for communication — it is never the measurement source.",
} as const;

export const useCases = {
  title: "Recurring survey documentation for",
  items: [
    { title: "Slopes and visible surface change", body: "Document surface condition between site visits with a consistent, georeferenced record." },
    { title: "Open-pit benches and mine walls", body: "Compare steep faces between epochs with M3C2 surface distances and stated detection limits." },
    { title: "Excavations and earthworks", body: "Cut, fill, and net volumes over defined areas, with uncertainty reported rather than implied." },
    { title: "Embankments", body: "A repeatable elevation record that supports engineering interpretation of surface change." },
    { title: "Landslide-affected terrain", body: "Documented surface change between flights as evidence for engineering assessment." },
  ],
  disclaimer:
    "Warp documents measured surface change to support engineering interpretation. It does not predict failure.",
} as const;

export const trust = {
  title: "Methodology you can defend",
  items: [
    { title: "Independent checkpoints", body: "Accuracy is assessed against checkpoints withheld from reconstruction — never against the data that trained the model." },
    { title: "Documented coordinate references", body: "Every artifact records its CRS, vertical datum, units, and transform history." },
    { title: "Reproducible reports", body: "Every value in a report traces to an exact artifact revision, processing version, and parameter set." },
    { title: "Controlled sharing", body: "Expiring, revocable links scoped to specific published revisions. No permanent public URLs." },
  ],
  accuracyClaim: {
    text: "Targeting 2–5 cm accuracy on suitable, controlled surveys. Achieved accuracy is assessed for each dataset using independent checkpoints.",
    status: "target",
    evidence: null,
  } satisfies Claim,
  scopeStatement:
    "Warp supports periodic surveys and change documentation. It complements continuous monitoring systems such as slope radar, InSAR, and prism networks.",
} as const;

export const pricing = {
  title: "Per-site subscription for recurring surveys",
  body: "Warp is priced per site, matched to your survey frequency. Pilots start with a single site and a reviewed baseline.",
  cta: { label: "Contact us for portfolio pricing", href: "/pilot" },
} as const;

export const finalCta = {
  headline: "Pilot Warp on one site. Establish a reviewed baseline and compare your next flight.",
  body: "Pilot turnaround target: days, not weeks — stated as a target until measured results support stronger wording. A change report requires two suitable survey epochs.",
  cta: { label: "Book a pilot", href: "/pilot" },
} as const;

export const captureGuidance = {
  note:
    "The engineering branch uses original drone photos with preserved metadata. The splat can be built from those same photos — recording video is optional. Video-only uploads may produce a visualization but cannot automatically receive an engineering accuracy label: the same flight does not mean arbitrary footage guarantees survey accuracy.",
} as const;

export const sampleDataDisclosure =
  "Example imagery and report previews shown on this site are illustrative samples, not customer data." as const;
