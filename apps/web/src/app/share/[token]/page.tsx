import type { Metadata } from "next";
import { PublicViewer } from "@/components/workspace/PublicViewer";
export const metadata: Metadata = { title: "Shared 3D view — WARP", robots: { index: false, follow: false } };
export default function Page({ params }: { params: { token: string } }) { return <PublicViewer token={params.token}/>; }
