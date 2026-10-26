import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface WorkspaceContext {
  userId: string;
  org: {
    id: string;
    name: string;
    plan: string;
  };
}

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: { org: true },
    orderBy: { org: { createdAt: "asc" } },
  });
  if (!membership) return null;

  return {
    userId,
    org: {
      id: membership.org.id,
      name: membership.org.name,
      plan: membership.org.plan,
    },
  };
}

export async function createLocalWorkspaceSession(): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_LOCAL_DEMO !== "true") {
    return NextResponse.json({ error: "local demo sessions are disabled" }, { status: 404 });
  }

  const user = await prisma.user.upsert({
    where: { email: "demo@workspace.local" },
    update: { name: "Demo Engineer" },
    create: { email: "demo@workspace.local", name: "Demo Engineer" },
  });
  const org = await prisma.organization.upsert({
    where: { slug: "drone-demo" },
    update: { name: "Drone Demo Workspace" },
    create: { slug: "drone-demo", name: "Drone Demo Workspace" },
  });
  await prisma.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, orgId: org.id, role: "OWNER" },
  });

  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

  const response = NextResponse.json({
    ok: true,
    mode: "live",
    workspace: { name: org.name, plan: org.plan },
  });
  const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secure = configuredUrl?.startsWith("https://") === true;
  response.cookies.set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", sessionToken, {
    expires,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  });
  return response;
}
