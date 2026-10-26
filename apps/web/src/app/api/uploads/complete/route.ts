import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  completeMultipartUpload,
  deleteStorageObject,
  getObjectSize,
  isStorageConfigured,
  STORAGE_CONFIGURATION_MESSAGE,
} from "@/lib/r2";
import { parseUploadParts } from "@/lib/project-types";
import { MAX_FILE_SIZE_BYTES } from "@/lib/videoConstraints";

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
    ? body as { key?: unknown; uploadId?: unknown; parts?: unknown }
    : null;
  const key = values?.key;
  const uploadId = values?.uploadId;
  const parts = parseUploadParts(values?.parts);
  if (typeof key !== "string" || !key || typeof uploadId !== "string" || !uploadId || !parts) {
    return NextResponse.json({ error: "key, uploadId, and parts are required" }, { status: 400 });
  }

  const upload = await prisma.uploadSession.findFirst({
    where: { userId: session.user.id, storageKey: key, uploadId },
  });
  if (!upload) return NextResponse.json({ error: "upload session not found" }, { status: 404 });
  if (upload.status === "COMPLETED") {
    return NextResponse.json({ ok: true, sizeBytes: upload.completedSizeBytes });
  }
  if (upload.status !== "ACTIVE" || upload.expiresAt <= new Date()) {
    return NextResponse.json({ error: "upload session is no longer active" }, { status: 409 });
  }

  const claimed = await prisma.uploadSession.updateMany({
    where: { id: upload.id, userId: session.user.id, status: "ACTIVE" },
    data: { status: "COMPLETING" },
  });
  if (claimed.count !== 1) {
    const current = await prisma.uploadSession.findUnique({ where: { id: upload.id } });
    return current?.status === "COMPLETED"
      ? NextResponse.json({ ok: true, sizeBytes: current.completedSizeBytes })
      : NextResponse.json({ error: "upload session is already being finalized" }, { status: 409 });
  }

  try {
    let completionError: unknown;
    try {
      await completeMultipartUpload(upload.storageKey, upload.uploadId, parts);
    } catch (error) {
      completionError = error;
    }

    let sizeBytes: number | null;
    try {
      sizeBytes = await getObjectSize(upload.storageKey);
    } catch (error) {
      if (!completionError) completionError = error;
      sizeBytes = null;
    }
    if (sizeBytes === null) throw completionError ?? new Error("uploaded object is unavailable");

    if (
      sizeBytes < 1 || sizeBytes > MAX_FILE_SIZE_BYTES ||
      (upload.expectedSizeBytes !== null && sizeBytes !== upload.expectedSizeBytes)
    ) {
      await deleteStorageObject(upload.storageKey).catch(() => undefined);
      await prisma.uploadSession.updateMany({
        where: { id: upload.id, status: "COMPLETING" },
        data: { status: "ABORTED" },
      });
      return NextResponse.json({ error: "uploaded file size is invalid" }, { status: 400 });
    }

    await prisma.uploadSession.update({
      where: { id: upload.id },
      data: { status: "COMPLETED", completedAt: new Date(), completedSizeBytes: sizeBytes },
    });
    return NextResponse.json({ ok: true, sizeBytes });
  } catch (error) {
    await prisma.uploadSession.updateMany({
      where: { id: upload.id, status: "COMPLETING" },
      data: { status: "ACTIVE" },
    });
    console.error("failed to complete multipart upload", error);
    return NextResponse.json({ error: "could not complete upload; retry the request" }, { status: 503 });
  }
}
