import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPartUploadUrl, isStorageConfigured, STORAGE_CONFIGURATION_MESSAGE } from "@/lib/r2";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: STORAGE_CONFIGURATION_MESSAGE }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const values = body && typeof body === "object" && !Array.isArray(body)
    ? body as { key?: unknown; uploadId?: unknown; partNumber?: unknown }
    : null;
  const { key, uploadId, partNumber } = values ?? {};
  if (
    typeof key !== "string" || !key || typeof uploadId !== "string" || !uploadId ||
    !Number.isInteger(partNumber) || (partNumber as number) < 1 || (partNumber as number) > 10_000
  ) {
    return NextResponse.json({ error: "key, uploadId, and partNumber are required" }, { status: 400 });
  }

  const upload = await prisma.uploadSession.findFirst({
    where: { userId: session.user.id, storageKey: key, uploadId },
  });
  if (!upload) return NextResponse.json({ error: "upload session not found" }, { status: 404 });
  if (upload.status !== "ACTIVE" || upload.expiresAt <= new Date()) {
    return NextResponse.json({ error: "upload session is no longer active" }, { status: 409 });
  }
  try {
    const url = await getPartUploadUrl(upload.storageKey, upload.uploadId, partNumber as number);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("failed to sign multipart part url", error);
    return NextResponse.json({ error: "could not create upload URL" }, { status: 503 });
  }
}
