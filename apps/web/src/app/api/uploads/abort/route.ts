import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { abortMultipartUpload } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const values = body && typeof body === "object" && !Array.isArray(body)
    ? body as { key?: unknown; uploadId?: unknown }
    : null;
  const { key, uploadId } = values ?? {};
  if (typeof key !== "string" || !key || typeof uploadId !== "string" || !uploadId) {
    return NextResponse.json({ error: "key and uploadId are required" }, { status: 400 });
  }

  const upload = await prisma.uploadSession.findFirst({
    where: { userId: session.user.id, storageKey: key, uploadId },
  });
  if (!upload) return NextResponse.json({ error: "upload session not found" }, { status: 404 });
  if (upload.status === "ABORTED") return NextResponse.json({ ok: true });
  if (upload.status !== "ACTIVE") {
    return NextResponse.json({ error: "upload session is no longer active" }, { status: 409 });
  }
  const claimed = await prisma.uploadSession.updateMany({
    where: { id: upload.id, status: "ACTIVE" },
    data: { status: "ABORTED" },
  });
  if (claimed.count !== 1) return NextResponse.json({ error: "upload session is no longer active" }, { status: 409 });

  try {
    await abortMultipartUpload(upload.storageKey, upload.uploadId);
  } catch (error) {
    console.error("failed to abort multipart upload", error);
  }
  return NextResponse.json({ ok: true });
}
