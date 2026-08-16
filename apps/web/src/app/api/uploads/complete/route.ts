import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { completeMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { key, uploadId, parts } = (await request.json()) as {
    key?: string;
    uploadId?: string;
    parts?: { partNumber: number; etag: string }[];
  };
  if (!key || !uploadId || !parts?.length) {
    return NextResponse.json({ error: "key, uploadId, and parts are required" }, { status: 400 });
  }

  await completeMultipartUpload(key, uploadId, parts);
  return NextResponse.json({ ok: true });
}
