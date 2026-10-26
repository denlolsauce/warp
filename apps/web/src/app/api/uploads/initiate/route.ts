import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { abortMultipartUpload, createMultipartUpload } from "@/lib/r2";
import { parseUploadInitiateInput } from "@/lib/project-types";

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
  const input = parseUploadInitiateInput(body);
  if (!input) return NextResponse.json({ error: "valid filename and supported video contentType are required" }, { status: 400 });

  const key = `videos/pending/${randomUUID()}.${input.extension}`;
  let uploadId: string | null = null;
  try {
    uploadId = await createMultipartUpload(key, input.contentType);
    const upload = await prisma.uploadSession.create({
      data: {
        userId: session.user.id,
        uploadId,
        storageKey: key,
        filename: input.filename,
        contentType: input.contentType,
        expectedSizeBytes: input.sizeBytes,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return NextResponse.json({ key: upload.storageKey, uploadId: upload.uploadId }, { status: 201 });
  } catch (error) {
    if (uploadId) await abortMultipartUpload(key, uploadId).catch(() => undefined);
    console.error("failed to initiate multipart upload", error);
    return NextResponse.json({ error: "could not initiate upload" }, { status: 503 });
  }
}
