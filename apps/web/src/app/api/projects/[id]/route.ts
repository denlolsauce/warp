import { NextResponse } from "next/server";
import {
  deleteWorkspaceProject,
  getWorkspaceProject,
  ProjectApiError,
  updateWorkspaceProject,
} from "@/lib/projects";
import { parseUpdateProjectInput } from "@/lib/project-types";
import { getWorkspaceContext } from "@/lib/workspace-session";

type RouteContext = { params: { id: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const project = await getWorkspaceProject(context.org.id, params.id);
    return project
      ? NextResponse.json({ project })
      : NextResponse.json({ error: "project not found" }, { status: 404 });
  } catch (error) {
    console.error("failed to load workspace project", error);
    return NextResponse.json({ error: "could not load project" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const input = parseUpdateProjectInput(body);
  if (!input) return NextResponse.json({ error: "invalid project fields" }, { status: 400 });
  try {
    const project = await updateWorkspaceProject(context.org.id, params.id, input);
    return project
      ? NextResponse.json({ project })
      : NextResponse.json({ error: "project not found" }, { status: 404 });
  } catch (error) {
    console.error("failed to update workspace project", error);
    return NextResponse.json({ error: "could not update project" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const context = await getWorkspaceContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const deleted = await deleteWorkspaceProject(context.org.id, params.id);
    return deleted
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "project not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof ProjectApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("failed to delete workspace project", error);
    return NextResponse.json({ error: "could not delete project" }, { status: 500 });
  }
}
