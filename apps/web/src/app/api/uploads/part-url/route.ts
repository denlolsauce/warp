import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPartUploadUrl } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
