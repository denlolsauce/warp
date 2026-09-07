import { NextResponse } from "next/server";
import { requireApiOrg } from "@/lib/studioApi";
import { abortMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const access = await requireApiOrg();
  if ("error" in access) return access.error;

  const { key, uploadId } = (await request.json()) as { key?: string; uploadId?: string };
  if (!key || !uploadId) {
    return NextResponse.json({ error: "key and uploadId are required" }, { status: 400 });
  }

  await abortMultipartUpload(key, uploadId);
  return NextResponse.json({ ok: true });
}
