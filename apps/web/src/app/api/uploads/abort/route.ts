import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { abortMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { key, uploadId } = (await request.json()) as { key?: string; uploadId?: string };
  if (!key || !uploadId) {
    return NextResponse.json({ error: "key and uploadId are required" }, { status: 400 });
  }

  await abortMultipartUpload(key, uploadId);
  return NextResponse.json({ ok: true });
}
