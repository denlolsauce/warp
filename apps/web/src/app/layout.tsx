import type { Metadata } from "next";
import { Figtree, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-figtree",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WARP — video to 3D",
  description:
    "WARP turns a two-minute phone video into a photorealistic 3D model — rotatable, zoomable, and small enough to sit on a product page.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${figtree.variable} ${plexMono.variable} ${inter.variable}`}>
      <body className="font-sans text-base leading-[1.55] antialiased">{children}</body>
    </html>
  );
}
