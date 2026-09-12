import { abortUploadRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";
import { abortMultipartUpload } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const parsed = abortUploadRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const file = await prisma.captureFile.findUnique({ where: { id: parsed.data.captureFileId } });
    if (!file || file.status !== "UPLOADING") {
      return Response.json({ error: "Unknown or completed upload" }, { status: 404 });
    }
    await requireSurveyAccess(file.surveyId, "ENGINEER");

    await abortMultipartUpload(file.storageKey, parsed.data.uploadId);
    await prisma.captureFile.update({ where: { id: file.id }, data: { status: "ABORTED" } });
    return Response.json({ ok: true });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
