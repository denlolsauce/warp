import type { Metadata } from "next";

import { StudioSidebar } from "@/components/studio/StudioSidebar";
import { jobsUsedThisPeriod, PLAN_JOB_LIMITS, requireStudioContext } from "@/lib/studio";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Studio — WARP",
};

export const dynamic = "force-dynamic";

export default async function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, org } = await requireStudioContext();

  const [recent, used] = await Promise.all([
    prisma.product.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, name: true, status: true, createdAt: true },
    }),
    jobsUsedThisPeriod(org.id),
  ]);

  return (
    <div className="studio flex min-h-screen bg-studio-bg font-studio text-[14px] text-studio-body antialiased">
      <StudioSidebar
        orgName={org.name}
        userName={user.name ?? user.email ?? "Account"}
        plan={org.plan}
        used={used}
        limit={PLAN_JOB_LIMITS[org.plan]}
        recent={recent.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        }))}
      />
      <main className="min-w-0 flex-1 p-3 pl-0">
        <div className="min-h-[calc(100vh-24px)] rounded-xl border border-studio-line bg-studio-panel shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
          {children}
        </div>
      </main>
    </div>
  );
}
