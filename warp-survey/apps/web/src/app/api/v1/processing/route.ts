import { submitProcessingRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { submitProcessingRun } from "@/lib/runs";

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return Response.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }
    const parsed = submitProcessingRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { surveyId, kinds } = parsed.data;
    const ctx = await requireSurveyAccess(surveyId, "ENGINEER");

    const uploaded = await prisma.captureFile.count({ where: { surveyId, status: "UPLOADED" } });
    if (uploaded === 0) {
      return Response.json(
        { error: "No completed uploads for this survey. Upload imagery before submitting processing." },
        { status: 409 },
      );
    }

    const runs = [];
    for (const kind of kinds) {
      const result = await submitProcessingRun({
        kind,
        surveyId,
        comparisonId: null,
        organizationId: ctx.orgId,
        idempotencyKey: `${idempotencyKey}:${kind}`,
      });
      runs.push({ kind, runId: result.runId, created: result.created });
      if (result.created) {
        await recordAudit({
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          action: "processing.submit",
          targetType: "ProcessingRun",
          targetId: result.runId,
          context: { surveyId, kind },
        });
      }
    }
    await prisma.survey.update({ where: { id: surveyId }, data: { status: "PROCESSING" } });

    return Response.json(
      {
        runs: runs.map((r) => ({
          ...r,
          status: "QUEUED",
          statusUrl: `/api/v1/processing/${r.runId}`,
        })),
      },
      { status: 202 },
    );
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
