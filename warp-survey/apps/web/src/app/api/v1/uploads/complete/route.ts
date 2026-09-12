import { completeUploadRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";
import { completeMultipartUpload } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const parsed = completeUploadRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const file = await prisma.captureFile.findUnique({ where: { id: parsed.data.captureFileId } });
    if (!file || file.status !== "UPLOADING") {
      return Response.json({ error: "Unknown or completed upload" }, { status: 404 });
    }
    await requireSurveyAccess(file.surveyId, "ENGINEER");

    await completeMultipartUpload(file.storageKey, parsed.data.uploadId, parsed.data.parts);
    await prisma.captureFile.update({
      where: { id: file.id },
      data: { status: "UPLOADED", uploadedAt: new Date() },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
