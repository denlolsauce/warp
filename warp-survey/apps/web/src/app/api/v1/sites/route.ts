import { createSiteRequest } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireOrgMember } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    const parsed = createSiteRequest.safeParse(body);
    if (!orgId || !parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.success ? [] : parsed.error.issues }, { status: 400 });
    }
    const ctx = await requireOrgMember(orgId, "ADMIN");

    const site = await prisma.site.create({
      data: {
        orgId: ctx.orgId,
        name: parsed.data.name,
        horizontalCrs: parsed.data.horizontalCrs,
        verticalDatum: parsed.data.verticalDatumId,
        boundary: (parsed.data.boundary ?? undefined) as object | undefined,
      },
    });
    await recordAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "site.create",
      targetType: "Site",
      targetId: site.id,
    });
    return Response.json({ siteId: site.id }, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
    const ctx = await requireOrgMember(orgId, "VIEWER");
    const sites = await prisma.site.findMany({
      where: { orgId: ctx.orgId },
      include: {
        surveys: { orderBy: { capturedAt: "desc" }, take: 1, select: { id: true, capturedAt: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        horizontalCrs: s.horizontalCrs,
        verticalDatum: s.verticalDatum,
        latestSurvey: s.surveys[0] ?? null,
      })),
    });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
