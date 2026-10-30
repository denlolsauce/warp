import type { Metadata } from "next";
import { MaritimeDashboard } from "@/components/maritime/MaritimeDashboard";

export const metadata: Metadata = {
  title: "PELAGIC — Maritime swarm simulation",
  description:
    "Plan and simulate coordinated five-drone coverage of a 100 km² maritime area.",
};

export default function HomePage() {
  return <MaritimeDashboard />;
}
