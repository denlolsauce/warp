import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSiteAccess, AuthorizationError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

const createReportRequest = z.object({
  comparisonId: z.string().min(1),
});

/**
 * Create a draft report revision from a computed comparison. The report data
 * is a canonical record assembled from the exact comparison manifest and
 * revision identifiers — every rendered value traces back to it.
 */
export async function POST(request: Request) {
  try {
    const parsed = createReportRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const comparison = await prisma.comparison.findUnique({
      where: { id: parsed.data.comparisonId },
      include: {
        baselineRevision: { select: { id: true, surveyId: true, manifest: true } },
        candidateRevision: { select: { id: true, surveyId: true, manifest: true } },
        reportRevisions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
      },
    });
    if (!comparison) throw new AuthorizationError("Not found", 404);
    const ctx = await requireSiteAccess(comparison.siteId, "ENGINEER");

    if (!comparison.manifest) {
      return Response.json(
        { error: "The comparison has not completed. A report can only be drafted from computed results." },
        { status: 409 },
      );
    }
    if (comparison.exploratory) {
      return Response.json(
        { error: "Exploratory comparisons (uncertainty not assessed) are ineligible for engineering reports." },
        { status: 409 },
      );
    }

    const version = (comparison.reportRevisions[0]?.version ?? 0) + 1;
    const report = await prisma.reportRevision.create({
      data: {
        comparisonId: comparison.id,
        version,
        authorUserId: ctx.userId,
        reportData: {
          comparisonId: comparison.id,
          baselineRevisionId: comparison.baselineRevisionId,
          candidateRevisionId: comparison.candidateRevisionId,
          method: comparison.method,
          comparisonManifest: comparison.manifest,
        } as object,
      },
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "report.draft",
      targetType: "ReportRevision",
      targetId: report.id,
      context: { comparisonId: comparison.id, version },
    });
    return Response.json({ reportRevisionId: report.id, version, status: "DRAFT" }, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
