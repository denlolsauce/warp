import { NextResponse } from "next/server";
import { getSharedProject } from "@/lib/projects";

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  try {
    const project = await getSharedProject(params.token);
    return project
      ? NextResponse.json({ project })
      : NextResponse.json({ error: "shared project not found" }, { status: 404 });
  } catch (error) {
    console.error("failed to load shared project", error);
    return NextResponse.json({ error: "could not load shared project" }, { status: 500 });
  }
}
