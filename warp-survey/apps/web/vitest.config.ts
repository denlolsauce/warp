import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the `@/*` path alias from tsconfig.json so route handlers can be
// imported under test exactly as Next.js resolves them.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(dirname(fileURLToPath(import.meta.url)), "src") },
  },
});
