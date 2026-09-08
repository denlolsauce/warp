import { createSurveyRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSiteAccess } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const parsed = createSurveyRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const ctx = await requireSiteAccess(parsed.data.siteId, "ENGINEER");

    const survey = await prisma.survey.create({
      data: {
        siteId: parsed.data.siteId,
        capturedAt: new Date(parsed.data.capturedAt),
        notes: parsed.data.notes,
      },
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "survey.create",
      targetType: "Survey",
      targetId: survey.id,
    });
    return Response.json({ surveyId: survey.id }, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
