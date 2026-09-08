import { surveyManifest } from "@warp-survey/contracts";
import type { SurveyManifest } from "@warp-survey/contracts";

export async function fetchManifest(url: string): Promise<SurveyManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const result = surveyManifest.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new Error(`Manifest validation failed: ${errors}`);
  }

  return result.data;
}
