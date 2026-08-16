import { SceneManifestSchema } from "../dist/index.js";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
}

let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error(`invalid JSON on stdin: ${error.message}`);
  process.exit(1);
}

const result = SceneManifestSchema.safeParse(data);
if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

console.log("SceneManifest OK");
