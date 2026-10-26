import { NextResponse } from "next/server";
import { createLocalWorkspaceSession } from "@/lib/workspace-session";

export async function GET() {
  if (process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_DEMO === "true") {
    return NextResponse.json({ available: true });
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_LOCAL_DEMO !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    return await createLocalWorkspaceSession();
  } catch (error) {
    console.error("failed to create local workspace session", error);
    return NextResponse.json({ error: "could not create local session" }, { status: 500 });
  }
}
