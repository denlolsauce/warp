import type { Config } from "tailwindcss";

// Engineering-documentation aesthetic: off-white surfaces, charcoal text,
// slate blue, restrained mineral-green accents. No neon, no gradients.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        survey: {
          // surfaces
          paper: "#f7f6f3",
          card: "#ffffff",
          well: "#efeeea",
          ink: "#26292e",
          // text
          heading: "#1f2226",
          body: "#3a3e45",
          muted: "#6b7078",
          faint: "#9a9fa8",
          // accents
          slate: "#46618c",
          "slate-deep": "#35496b",
          mineral: "#3d7a5f",
          "mineral-soft": "#e3efe8",
          amber: "#a9772f",
          danger: "#9a3b32",
          // hairlines
          line: "#e2e0da",
          "line-strong": "#cfccc4",
        },
      },
    },
  },
  plugins: [],
};

export default config;
