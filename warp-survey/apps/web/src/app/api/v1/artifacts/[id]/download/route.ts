import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireOrgMember, AuthorizationError } from "@/lib/authz";
import { getDownloadUrl } from "@/lib/storage";
import { resolveShareToken } from "@/lib/shareLinks";

/**
 * Every artifact download re-authorizes: either an org member of the owning
 * tenant, or a valid (unexpired, unrevoked) share token whose scope includes
 * this artifact's revision. The response is a short-lived signed URL — files
 * are never exposed through permanent public URLs.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const artifact = await prisma.artifact.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        storageKey: true,
        revisionId: true,
        revision: { select: { survey: { select: { site: { select: { orgId: true } } } } } },
      },
    });
    if (!artifact) throw new AuthorizationError("Not found", 404);

    const shareToken = new URL(request.url).searchParams.get("share");
    if (shareToken) {
      const access = await resolveShareToken(shareToken);
      if (!access || !access.revisionIds.includes(artifact.revisionId)) {
        throw new AuthorizationError("Not found", 404);
      }
    } else {
      await requireOrgMember(artifact.revision.survey.site.orgId, "VIEWER");
    }

    const url = await getDownloadUrl(artifact.storageKey);
    return Response.json({ url, expiresInSeconds: 600 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
