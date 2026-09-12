import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Warp — Measure site change from repeat drone surveys",
    template: "%s — Warp",
  },
  description:
    "Turn repeat drone surveys into validated measurement outputs, documented change comparisons, and a shareable 3D site view.",
  openGraph: {
    title: "Warp — Measure site change from repeat drone surveys",
    description:
      "Validated point clouds and elevation models for engineers. A photorealistic 3D site view for everyone else. From the same drone flight.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
