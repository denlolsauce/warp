import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal",
  description: "Photorealistic, explorable 3D property tours",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
