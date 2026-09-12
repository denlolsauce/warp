import { signPartRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";
import { getPartUploadUrl } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const parsed = signPartRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const file = await prisma.captureFile.findUnique({ where: { id: parsed.data.captureFileId } });
    if (!file || file.status !== "UPLOADING") {
      return Response.json({ error: "Unknown or completed upload" }, { status: 404 });
    }
    await requireSurveyAccess(file.surveyId, "ENGINEER");

    const url = await getPartUploadUrl(file.storageKey, parsed.data.uploadId, parsed.data.partNumber);
    return Response.json({ url });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
