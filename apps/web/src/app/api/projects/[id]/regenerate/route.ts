import { NextResponse } from "next/server";
import { ProjectApiError, regenerateWorkspaceProject } from "@/lib/projects";
import { getWorkspaceContext } from "@/lib/workspace-session";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const project = await regenerateWorkspaceProject(context.org.id, params.id);
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof ProjectApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("failed to regenerate project", error);
    return NextResponse.json({ error: "could not queue project" }, { status: 503 });
  }
}
