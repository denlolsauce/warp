import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-figtree)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
        studio: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        warp: {
          // surfaces
          bg: "#080a10",
          panel: "#0b0f18",
          well: "#090c13",
          sky: "#0b1226",
          // text, brightest to faintest
          heading: "#f6f7fa",
          title: "#f2f4f8",
          body: "#e8eaef",
          strong: "#c3cad8",
          muted: "#a9b2c4",
          nav: "#9aa2b4",
          dim: "#8d95a8",
          meta: "#7f889b",
          faint: "#6b7488",
          // accents
          accent: "#79dcd6",
          "accent-hi": "#a6e9e4",
          "accent-soft": "#bff0ec",
          "accent-ink": "#071113",
          amber: "#e0b177",
          // hairlines
          line: "rgba(255,255,255,0.07)",
          "line-2": "rgba(255,255,255,0.09)",
          "line-3": "rgba(255,255,255,0.12)",
          "line-4": "rgba(255,255,255,0.16)",
        },
        // Light "studio" theme, matched to the Warp desktop app reference:
        // warm off-white surfaces, near-black ink, orange-red brand mark.
        studio: {
          bg: "#f2f0eb",
          panel: "#fbfaf8",
          card: "#ffffff",
          well: "#f6f4f0",
          ink: "#1c1a17",
          heading: "#26231f",
          body: "#3d3a34",
          muted: "#7d786f",
          faint: "#a29d93",
          line: "#e6e3dc",
          "line-2": "#dcd8d0",
          "line-3": "#cfcabf",
          brand: "#e2492f",
          "brand-ink": "#2b1109",
          dark: "#171310",
          "dark-hi": "#2c2622",
          amber: "#b45309",
          "amber-bg": "#f7e8cf",
          "amber-line": "#ead1a8",
          green: "#3f7d4e",
          "green-bg": "#e4efe4",
          red: "#b3402a",
          "red-bg": "#f7e3dd",
        },
      },
      backgroundColor: {
        "warp-tint": "rgba(255,255,255,0.04)",
        "warp-tint-hi": "rgba(255,255,255,0.09)",
        "warp-chip": "rgba(121,220,214,0.13)",
      },
    },
  },
  plugins: [],
};

export default config;
