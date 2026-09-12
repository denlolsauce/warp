import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AllComparisons() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const comparisons = await prisma.comparison.findMany({
    where: { site: { org: { memberships: { some: { userId: session.user.id } } } } },
    include: { site: true, runs: true },
    orderBy: { createdAt: "desc" },
  });
  return <><h1 className="text-3xl font-semibold">Comparisons</h1><p className="mt-2 text-survey-muted">Later − earlier. Positive is fill; negative is cut.</p><ul className="mt-6 space-y-2">{comparisons.map((comparison) => <li key={comparison.id}><Link href={`/app/sites/${comparison.siteId}/comparisons/${comparison.id}`} className="flex justify-between rounded border border-survey-line bg-survey-card p-4 hover:border-survey-slate"><span>{comparison.site.name} · {comparison.method.replaceAll("_", " ")}</span><span className="font-mono text-xs">{comparison.runs.at(-1)?.status ?? "NOT STARTED"}</span></Link></li>)}</ul>{!comparisons.length && <p className="mt-6 rounded border border-survey-line bg-survey-card p-4 text-survey-muted">No comparisons yet. Select two approved epochs on a site to begin.</p>}</>;
}
