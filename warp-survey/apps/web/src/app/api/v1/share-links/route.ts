import { createShareLinkRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireOrgMember, AuthorizationError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { generateShareToken } from "@/lib/shareLinks";

export async function POST(request: Request) {
  try {
    const parsed = createShareLinkRequest.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { surveyRevisionIds, expiresAt, label } = parsed.data;
    if (new Date(expiresAt).getTime() <= Date.now()) {
      return Response.json({ error: "expiresAt must be in the future" }, { status: 400 });
    }

    // All revisions must exist and belong to one org the caller can admin.
    const revisions = await prisma.surveyRevision.findMany({
      where: { id: { in: surveyRevisionIds } },
      select: { id: true, survey: { select: { site: { select: { orgId: true } } } } },
    });
    if (revisions.length !== surveyRevisionIds.length) throw new AuthorizationError("Not found", 404);
    const orgIds = new Set(revisions.map((r) => r.survey.site.orgId));
    if (orgIds.size !== 1) {
      return Response.json({ error: "All revisions must belong to one organization" }, { status: 400 });
    }
    const ctx = await requireOrgMember([...orgIds][0], "ENGINEER");

    const { token, tokenHash } = generateShareToken();
    const link = await prisma.shareLink.create({
      data: {
        createdByUserId: ctx.userId,
        tokenHash,
        label,
        expiresAt: new Date(expiresAt),
        revisions: { create: surveyRevisionIds.map((revisionId) => ({ revisionId })) },
      },
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "shareLink.create",
      targetType: "ShareLink",
      targetId: link.id,
      context: { revisionIds: surveyRevisionIds, expiresAt },
    });

    // The plaintext token is returned exactly once and never stored.
    return Response.json({ shareLinkId: link.id, token, url: `/share/${token}` }, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
