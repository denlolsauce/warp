import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { processingJobMessage, publicationUpdate, stageStatusUpdate } from "../src/jobs";
import { surveyManifest } from "../src/artifacts";
import { comparisonManifest } from "../src/comparisons";

// Emits the JSON Schemas the Python worker validates queue messages and
// manifests against. Committed to schema/ so Python needs no Node at runtime.
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  "processing-job-message": processingJobMessage,
  "stage-status-update": stageStatusUpdate,
  "publication-update": publicationUpdate,
  "survey-manifest": surveyManifest,
  "comparison-manifest": comparisonManifest,
};

for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`wrote schema/${name}.json`);
}
