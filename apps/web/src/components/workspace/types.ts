export interface WorkspaceProject {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  captureProfile: string;
  status: string;
  createdAt: string;
  shared: boolean;
  shareToken: string | null;
  sogUrl: string | null;
  plyUrl: string | null;
  sizeBytes: number | null;
  job: {
    id: string;
    status: string;
    currentStage: string | null;
    errorMessage: string | null;
    stages: { stage: string; status: string; metrics?: Record<string, unknown> | null }[];
  } | null;
}
export const STAGES = [
  ["INGEST", "Validate capture", "Check video quality, resolution and duration."],
  ["FRAME_EXTRACTION", "Select sharp frames", "Keep clear, overlapping views. Discard motion blur."],
  ["POSE_ESTIMATION", "Solve camera poses", "Reconstruct the scene with GLOMAP / COLMAP."],
  ["TRAINING", "Train Gaussians", "Bounded MCMC training with anti-aliasing."],
  ["CLEANUP", "Prune & refine", "Remove floaters while preserving site context."],
  ["COMPRESSION", "Optimize for the web", "Compress to PlayCanvas SOG; retain the source PLY."],
  ["PUBLISH", "Ready to explore", "Publish the model for viewing and sharing."],
] as const;
export const DEMO_PROJECT: WorkspaceProject = {
  id: "sample-house", name: "The courtyard house", location: "Residential · aerial capture",
  description: "A site you can step inside. Explore this example drone capture in full 3D, from the roofline to the surrounding landscape.",
  captureProfile: "drone", status: "READY", createdAt: "2026-10-26T09:00:00.000Z",
  shared: true, shareToken: "demo", sogUrl: "/demo/house.sog", plyUrl: null, sizeBytes: 6072230, job: null,
};
export function fileSize(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
