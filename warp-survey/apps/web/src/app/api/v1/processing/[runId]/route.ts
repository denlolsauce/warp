import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireOrgMember, AuthorizationError } from "@/lib/authz";

export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  try {
    const run = await prisma.processingRun.findUnique({
      where: { id: params.runId },
      include: {
        stageAttempts: { orderBy: [{ stage: "asc" }, { attempt: "asc" }] },
        survey: { select: { site: { select: { orgId: true } } } },
        comparison: { select: { site: { select: { orgId: true } } } },
      },
    });
    if (!run) throw new AuthorizationError("Not found", 404);
    const orgId = run.survey?.site.orgId ?? run.comparison?.site.orgId;
    if (!orgId) throw new AuthorizationError("Not found", 404);
    await requireOrgMember(orgId, "VIEWER");

    return Response.json({
      runId: run.id,
      kind: run.kind,
      status: run.status,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stages: run.stageAttempts.map((s) => ({
        stage: s.stage,
        attempt: s.attempt,
        status: s.status,
        errorMessage: s.errorMessage,
        transient: s.transient,
        metrics: s.metrics,
        timingSeconds: s.timingSeconds,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
    });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
