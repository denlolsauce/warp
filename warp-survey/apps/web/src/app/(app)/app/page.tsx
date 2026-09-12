import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QualityBadge } from "@/components/app/QualityBadge";

export default async function Dashboard() {
 const session = await auth(); if (!session?.user?.id) return null;
 const sites = await prisma.site.findMany({ where:{ org:{ memberships:{ some:{ userId:session.user.id } } } }, include:{ surveys:{ orderBy:{capturedAt:"desc"}, take:1, include:{revisions:{orderBy:{publishedAt:"desc"},take:1}} }, subscriptions:true }, orderBy:{name:"asc"} });
 return <><p className="font-mono text-xs uppercase tracking-widest text-survey-muted">Site portfolio</p><div className="mt-2 flex items-baseline justify-between"><h1 className="text-3xl font-semibold text-survey-heading">Survey sites</h1><span className="text-sm text-survey-muted">{sites.length} active</span></div><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sites.map(site=>{const epoch=site.surveys[0];const rev=epoch?.revisions[0];return <Link key={site.id} href={`/app/sites/${site.id}`} className="rounded border border-survey-line bg-survey-card p-5 transition hover:border-survey-slate"><div className="flex justify-between"><h2 className="font-medium text-survey-heading">{site.name}</h2><span className="font-mono text-xs text-survey-muted">{site.subscriptions[0]?.status ?? "UNSUBSCRIBED"}</span></div><p className="mt-5 text-sm text-survey-muted">Latest epoch {epoch ? epoch.capturedAt.toLocaleDateString() : "—"}</p><div className="mt-2 flex gap-2"><QualityBadge state={rev?.measurementQualityState ?? "UNVERIFIED"}/><span className="text-xs text-survey-muted">measurement</span></div></Link>})}</div>{!sites.length && <p className="mt-8 rounded border border-survey-line bg-survey-card p-5 text-survey-muted">No sites are available in this organization.</p>}</>;
}
