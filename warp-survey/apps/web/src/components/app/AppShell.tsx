import Link from "next/link";
import { signOut } from "@/lib/auth";

export function AppShell({ children, user, organizations }: { children: React.ReactNode; user: { name?: string | null; email?: string | null }; organizations: { id: string; name: string }[] }) {
  return <div className="min-h-screen bg-survey-paper">
    <header className="border-b border-survey-line bg-survey-card"><div className="mx-auto flex max-w-7xl items-center gap-5 px-5 py-4">
      <Link href="/app" className="font-mono text-lg font-medium text-survey-heading">warp<span className="text-survey-mineral">/survey</span></Link>
      {organizations.length > 1 && <select aria-label="Organization" className="hidden rounded border border-survey-line bg-white px-2 py-1 text-sm md:block">{organizations.map((org) => <option key={org.id}>{org.name}</option>)}</select>}
      <nav aria-label="Workspace" className="ml-auto flex gap-4 text-sm text-survey-muted"><Link href="/app">Sites</Link><Link href="/app/sites">Surveys</Link><Link href="/app/comparisons">Comparisons</Link><Link href="/app/reports">Reports</Link></nav>
      <details className="relative text-sm"><summary className="cursor-pointer list-none rounded border border-survey-line px-3 py-1.5 text-survey-body">{user.name ?? user.email}</summary><div className="absolute right-0 z-10 mt-2 w-44 rounded border border-survey-line bg-white p-2 shadow-sm"><form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}><button className="w-full rounded px-2 py-1.5 text-left hover:bg-survey-well">Sign out</button></form></div></details>
    </div></header><main className="mx-auto max-w-7xl px-5 py-8">{children}</main></div>;
}
