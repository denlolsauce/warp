import { NextResponse } from "next/server";
import type { Organization } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./prisma";

export { jobsUsedThisPeriod, PLAN_JOB_LIMITS } from "./studio";

/**
 * API-route counterpart of requireStudioContext: resolves the caller's org or
 * returns the response to send back. Deliberately does not auto-create a
 * workspace — API calls only happen from studio pages, which already did.
 */
export async function requireApiOrg(): Promise<{ org: Organization } | { error: NextResponse }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
    include: { org: true },
    orderBy: { id: "asc" },
  });
  if (!membership) {
    return { error: NextResponse.json({ error: "no workspace" }, { status: 403 }) };
  }
  return { org: membership.org };
}

/** Load a product only if it belongs to the caller's org. */
export async function requireOwnedProduct(productId: string) {
  const access = await requireApiOrg();
  if ("error" in access) return access;
  const product = await prisma.product.findFirst({
    where: { id: productId, orgId: access.org.id },
  });
  if (!product) {
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { org: access.org, product };
}
