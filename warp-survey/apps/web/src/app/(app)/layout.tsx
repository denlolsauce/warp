import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app/AppShell";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const memberships = await prisma.membership.findMany({ where: { userId: session.user.id }, include: { org: true } });
  return <AppShell user={session.user} organizations={memberships.map(({ org }) => ({ id: org.id, name: org.name }))}>{children}</AppShell>;
}
