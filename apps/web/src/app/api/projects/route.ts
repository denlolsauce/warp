import { NextResponse } from "next/server";
import { createWorkspaceProject, listWorkspaceProjects, ProjectApiError } from "@/lib/projects";
import { parseCreateProjectInput } from "@/lib/project-types";
import { getWorkspaceContext } from "@/lib/workspace-session";

export async function GET() {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listWorkspaceProjects(context));
  } catch (error) {
    console.error("failed to list workspace projects", error);
    return NextResponse.json({ error: "could not load projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const input = parseCreateProjectInput(body);
  if (!input) return NextResponse.json({ error: "name and a completed uploadId are required" }, { status: 400 });

  try {
    const project = await createWorkspaceProject(context, input);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("failed to create workspace project", error);
    return NextResponse.json({ error: "could not create or queue project" }, { status: 503 });
  }
}
