import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { filename, contentType } = (await request.json()) as {
    filename?: string;
    contentType?: string;
  };
  if (!filename || !contentType) {
    return NextResponse.json({ error: "filename and contentType are required" }, { status: 400 });
  }

  // No Tour/Video row exists yet at this point (upload happens before
  // POST /api/tours), so the key is keyed by a throwaway upload id rather
  // than a real tourId/videoId.
  const ext = filename.split(".").pop() ?? "mp4";
  const key = `videos/pending/${randomUUID()}.${ext}`;
  const uploadId = await createMultipartUpload(key, contentType);

  return NextResponse.json({ key, uploadId });
}
