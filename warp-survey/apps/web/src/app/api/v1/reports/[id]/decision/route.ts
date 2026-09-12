import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSiteAccess, AuthorizationError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

const decisionRequest = z.object({
  outcome: z.enum(["APPROVED", "REJECTED"]),
  comments: z.string().max(4000).nullable(),
});

/**
 * Reviewer decision on a draft report. The preparer cannot approve their own
 * report, and approval never converts failed measurement QA into a pass —
 * comparison submission already required PASS revisions, and the QA state
 * lives on the revisions, not the report.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = decisionRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const report = await prisma.reportRevision.findUnique({
      where: { id: params.id },
      include: { comparison: { select: { siteId: true } } },
    });
    if (!report) throw new AuthorizationError("Not found", 404);
    const ctx = await requireSiteAccess(report.comparison.siteId, "REVIEWER");

    if (report.status !== "DRAFT") {
      return Response.json({ error: `Report is ${report.status}; only drafts can be decided.` }, { status: 409 });
    }
    if (report.authorUserId === ctx.userId) {
      return Response.json({ error: "The report preparer cannot review their own report." }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.reviewDecision.create({
        data: {
          reportRevisionId: report.id,
          reviewerUserId: ctx.userId,
          outcome: parsed.data.outcome,
          comments: parsed.data.comments,
        },
      });
      if (parsed.data.outcome === "APPROVED") {
        // Approving a new revision supersedes the previous approved one.
        await tx.reportRevision.updateMany({
          where: { comparisonId: report.comparisonId, status: "APPROVED" },
          data: { status: "SUPERSEDED", supersededById: report.id },
        });
        await tx.reportRevision.update({ where: { id: report.id }, data: { status: "APPROVED" } });
      }
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: `report.${parsed.data.outcome.toLowerCase()}`,
      targetType: "ReportRevision",
      targetId: report.id,
    });
    return Response.json({ ok: true, outcome: parsed.data.outcome });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
