import { NextResponse } from "next/server";
import { ProjectApiError, setProjectShared } from "@/lib/projects";
import { getWorkspaceContext } from "@/lib/workspace-session";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setProjectShared(context.org.id, params.id, (body as { enabled: boolean }).enabled));
  } catch (error) {
    if (error instanceof ProjectApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("failed to update project sharing", error);
    return NextResponse.json({ error: "could not update sharing" }, { status: 500 });
  }
}
