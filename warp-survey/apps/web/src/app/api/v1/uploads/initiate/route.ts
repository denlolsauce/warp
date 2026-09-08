import { initiateUploadRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";
import { captureFileStorageKey, createMultipartUpload } from "@/lib/storage";

// Direct-to-storage multipart upload (vendored pattern, see VENDORED.md).
// Imagery never proxies through the app server.
const PART_SIZE_BYTES = 64 * 1024 * 1024;
const MAX_SIZE_BYTES = 200 * 1024 * 1024 * 1024; // explicit upload budget

export async function POST(request: Request) {
  try {
    const parsed = initiateUploadRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { surveyId, kind, filename, contentType, sizeBytes } = parsed.data;
    const ctx = await requireSurveyAccess(surveyId, "ENGINEER");

    if (ctx.survey.status !== "DRAFT" && ctx.survey.status !== "UPLOADING") {
      return Response.json(
        { error: "Survey inputs are immutable once processing starts. Create a new survey for a new capture." },
        { status: 409 },
      );
    }
    if (sizeBytes > MAX_SIZE_BYTES) {
      return Response.json(
        { error: `Upload exceeds the ${MAX_SIZE_BYTES / 1024 ** 3} GiB per-file budget. Split the capture or contact support.` },
        { status: 413 },
      );
    }

    const captureFile = await prisma.captureFile.create({
      data: {
        surveyId,
        kind,
        filename,
        contentType,
        sizeBytes: BigInt(sizeBytes),
        storageKey: "pending",
      },
    });
    const storageKey = captureFileStorageKey(surveyId, captureFile.id, filename);
    const uploadId = await createMultipartUpload(storageKey, contentType);
    await prisma.$transaction([
      prisma.captureFile.update({ where: { id: captureFile.id }, data: { storageKey } }),
      prisma.survey.update({ where: { id: surveyId }, data: { status: "UPLOADING" } }),
    ]);

    return Response.json({
      captureFileId: captureFile.id,
      uploadId,
      storageKey,
      partSizeBytes: PART_SIZE_BYTES,
    });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
