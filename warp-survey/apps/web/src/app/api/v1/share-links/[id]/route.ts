import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireOrgMember, AuthorizationError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

/** Revoke a share link. Revocation is immediate; every asset request rechecks. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const link = await prisma.shareLink.findUnique({
      where: { id: params.id },
      include: {
        revisions: {
          take: 1,
          select: { revision: { select: { survey: { select: { site: { select: { orgId: true } } } } } } },
        },
      },
    });
    if (!link) throw new AuthorizationError("Not found", 404);
    const orgId = link.revisions[0]?.revision.survey.site.orgId;
    if (!orgId) throw new AuthorizationError("Not found", 404);
    const ctx = await requireOrgMember(orgId, "ENGINEER");

    await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: link.revokedAt ?? new Date() } });
    await recordAudit({
      orgId,
      actorUserId: ctx.userId,
      action: "shareLink.revoke",
      targetType: "ShareLink",
      targetId: link.id,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
