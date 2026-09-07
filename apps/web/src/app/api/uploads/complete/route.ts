import { NextResponse } from "next/server";
import { requireApiOrg } from "@/lib/studioApi";
import { completeMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const access = await requireApiOrg();
  if ("error" in access) return access.error;

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
