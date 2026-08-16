import { SceneManifestSchema, type SceneManifest } from "@portal/schema";

export async function fetchManifest(url: string): Promise<SceneManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch manifest (${response.status} ${response.statusText}): ${url}`);
  }

  const json = await response.json();
  const result = SceneManifestSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`manifest failed validation: ${result.error.message}`);
  }
  return result.data;
}
