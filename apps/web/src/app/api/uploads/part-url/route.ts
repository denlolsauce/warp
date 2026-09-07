import { NextResponse } from "next/server";
import { requireApiOrg } from "@/lib/studioApi";
import { getPartUploadUrl } from "@/lib/r2";

export async function POST(request: Request) {
  const access = await requireApiOrg();
  if ("error" in access) return access.error;

  const { key, uploadId, partNumber } = (await request.json()) as {
    key?: string;
    uploadId?: string;
    partNumber?: number;
  };
  if (!key || !uploadId || !partNumber) {
    return NextResponse.json({ error: "key, uploadId, and partNumber are required" }, { status: 400 });
  }

  const url = await getPartUploadUrl(key, uploadId, partNumber);
  return NextResponse.json({ url });
}
