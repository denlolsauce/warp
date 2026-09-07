import type { Organization, User } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./prisma";

export interface StudioContext {
  user: Pick<User, "id" | "email" | "name" | "image">;
  org: Organization;
}

// Per-month capture allowance by plan tier — usage is a count of Job rows in
// the current period (CLAUDE.md: no ledger table until a count can't answer).
export const PLAN_JOB_LIMITS: Record<Organization["plan"], number> = {
  FREE: 5,
  STARTER: 25,
  PRO: 100,
  ENTERPRISE: 1000,
};

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

const DEMO_EMAIL = "test@portal.dev";

/**
 * Sign-in is parked for now: with no session, the studio runs as the seeded
 * demo user instead of redirecting. Restore a redirect to a sign-in page here
 * when auth comes back.
 */
async function demoUser() {
  return prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Test Merchant", emailVerified: new Date() },
  });
}

/** Session user when one exists, otherwise the demo user (auth is parked). */
export async function resolveStudioUser(): Promise<StudioContext["user"]> {
  const session = await auth();
  return session?.user?.id
    ? (session.user as StudioContext["user"])
    : ((await demoUser()) as StudioContext["user"]);
}

/**
 * Resolve the current user and their organization for a studio page. A
 * first-time user gets a personal workspace created on the spot — the studio
 * is unusable without an org to own products, and forcing an onboarding form
 * before showing anything would be worse than naming one after them.
 */
export async function requireStudioContext(): Promise<StudioContext> {
  const user = await resolveStudioUser();

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { org: true },
    orderBy: { id: "asc" },
  });
  if (membership) {
    return { user, org: membership.org };
  }

  const label = user.name ?? user.email?.split("@")[0] ?? "workspace";
  const base = slugify(label);
  // Slug is unique — suffix with a random tail on collision instead of failing.
  const slug = (await prisma.organization.findUnique({ where: { slug: base } }))
    ? `${base}-${Math.random().toString(36).slice(2, 8)}`
    : base;

  const org = await prisma.organization.create({
    data: {
      name: label,
      slug,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { user, org };
}

/** Jobs started by this org since the first of the current month (UTC). */
export async function jobsUsedThisPeriod(orgId: string): Promise<number> {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.job.count({
    where: { product: { orgId }, createdAt: { gte: periodStart } },
  });
}
