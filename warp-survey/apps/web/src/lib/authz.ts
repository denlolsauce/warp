import type { MembershipRole } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./prisma";

/**
 * Tenant authorization for every API/workspace action. Role semantics:
 *  OWNER/ADMIN — manage org, members, sites, sharing.
 *  ENGINEER    — create surveys, upload, submit processing, draft reports.
 *  REVIEWER    — approve/reject engineering releases (not their own drafts).
 *  VIEWER      — read-only workspace access.
 */
const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  REVIEWER: 1,
  ENGINEER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function roleAtLeast(role: MembershipRole, minimum: MembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 404,
  ) {
    super(message);
  }
}

export interface OrgContext {
  userId: string;
  orgId: string;
  role: MembershipRole;
}

/** Resolve the signed-in user's membership in an org, or fail. */
export async function requireOrgMember(orgId: string, minimum: MembershipRole = "VIEWER"): Promise<OrgContext> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthorizationError("Not signed in", 401);

  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId } },
  });
  // 404 (not 403) so cross-tenant probes can't confirm an org exists.
  if (!membership) throw new AuthorizationError("Not found", 404);
  if (!roleAtLeast(membership.role, minimum)) {
    throw new AuthorizationError("Insufficient role", 403);
  }
  return { userId: session.user.id, orgId, role: membership.role };
}

/** Authorize access to a site and return its org context. */
export async function requireSiteAccess(siteId: string, minimum: MembershipRole = "VIEWER"): Promise<OrgContext & { siteId: string }> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { orgId: true } });
  if (!site) throw new AuthorizationError("Not found", 404);
  const ctx = await requireOrgMember(site.orgId, minimum);
  return { ...ctx, siteId };
}

/** Authorize access to a survey through its site's org. */
export async function requireSurveyAccess(surveyId: string, minimum: MembershipRole = "VIEWER") {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: { id: true, siteId: true, status: true, site: { select: { orgId: true } } },
  });
  if (!survey) throw new AuthorizationError("Not found", 404);
  const ctx = await requireOrgMember(survey.site.orgId, minimum);
  return { ...ctx, survey };
}

export function authzErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
