import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    lib: {
      entry: "src/web-component.ts",
      name: "WarpSurveyViewer",
      formats: ["es"],
      fileName: "warp-survey-viewer",
    },
    outDir: "dist",
  },
});
