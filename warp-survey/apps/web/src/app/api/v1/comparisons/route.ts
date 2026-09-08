import { submitComparisonRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSiteAccess } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { submitProcessingRun } from "@/lib/runs";

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return Response.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }
    const parsed = submitComparisonRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { siteId, baselineRevisionId, candidateRevisionId, method, areaOfInterest } = parsed.data;
    const ctx = await requireSiteAccess(siteId, "ENGINEER");

    if (baselineRevisionId === candidateRevisionId) {
      return Response.json(
        { error: "A comparison needs two different survey epochs. The first survey establishes a baseline only." },
        { status: 400 },
      );
    }

    // Both revisions must belong to this site and be measurement-approved.
    const revisions = await prisma.surveyRevision.findMany({
      where: { id: { in: [baselineRevisionId, candidateRevisionId] }, survey: { siteId } },
    });
    if (revisions.length !== 2) {
      return Response.json({ error: "Both revisions must belong to this site." }, { status: 404 });
    }
    const unapproved = revisions.filter((r) => r.measurementQualityState !== "PASS");
    if (unapproved.length > 0) {
      return Response.json(
        {
          error:
            "Comparisons require two approved survey revisions. " +
            `Revision(s) ${unapproved.map((r) => r.id).join(", ")} have not passed measurement QA.`,
        },
        { status: 409 },
      );
    }

    const comparison = await prisma.comparison.create({
      data: {
        siteId,
        baselineRevisionId,
        candidateRevisionId,
        method,
        areaOfInterest: (areaOfInterest ?? undefined) as object | undefined,
      },
    });
    const result = await submitProcessingRun({
      kind: "COMPARISON",
      surveyId: null,
      comparisonId: comparison.id,
      organizationId: ctx.orgId,
      idempotencyKey,
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "comparison.submit",
      targetType: "Comparison",
      targetId: comparison.id,
      context: { baselineRevisionId, candidateRevisionId, method },
    });

    return Response.json(
      { comparisonId: comparison.id, runId: result.runId, status: "QUEUED", statusUrl: `/api/v1/processing/${result.runId}` },
      { status: 202 },
    );
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
