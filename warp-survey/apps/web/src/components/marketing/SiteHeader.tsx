import Link from "next/link";

const nav = [
  { label: "Workflow", href: "/#how-it-works" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "Methodology", href: "/#methodology" },
  { label: "Pricing", href: "/#pricing" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-survey-line bg-survey-card">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-lg font-medium tracking-tight text-survey-heading">
          warp<span className="text-survey-mineral">/survey</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm text-survey-muted hover:text-survey-heading">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/signin" className="text-sm text-survey-muted hover:text-survey-heading">
            Sign in
          </Link>
          <Link
            href="/pilot"
            className="rounded border border-survey-slate bg-survey-slate px-4 py-2 text-sm font-medium text-white hover:bg-survey-slate-deep"
          >
            Book a pilot
          </Link>
        </div>
      </div>
    </header>
  );
}
