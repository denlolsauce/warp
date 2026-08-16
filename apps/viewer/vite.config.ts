import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Bind all interfaces, not just localhost, so a phone on the same
    // Wi-Fi can reach the dev server via this machine's LAN IP.
    host: true,
  },
  build: {
    target: "es2020",
  },
});
