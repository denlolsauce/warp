import Link from "next/link";
import { sampleDataDisclosure, trust } from "@/lib/marketing/content";

export function SiteFooter() {
  return (
    <footer className="border-t border-survey-line bg-survey-card">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div className="max-w-md">
            <p className="font-mono text-base font-medium text-survey-heading">
              warp<span className="text-survey-mineral">/survey</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-survey-muted">{trust.scopeStatement}</p>
          </div>
          <nav aria-label="Footer" className="flex gap-12 text-sm">
            <div className="flex flex-col gap-2">
              <span className="font-medium text-survey-heading">Product</span>
              <Link href="/#how-it-works" className="text-survey-muted hover:text-survey-heading">Workflow</Link>
              <Link href="/#use-cases" className="text-survey-muted hover:text-survey-heading">Use cases</Link>
              <Link href="/#methodology" className="text-survey-muted hover:text-survey-heading">Methodology</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-survey-heading">Company</span>
              <Link href="/pilot" className="text-survey-muted hover:text-survey-heading">Book a pilot</Link>
              <Link href="/signin" className="text-survey-muted hover:text-survey-heading">Sign in</Link>
            </div>
          </nav>
        </div>
        <p className="mt-10 border-t border-survey-line pt-6 text-xs text-survey-faint">
          {sampleDataDisclosure} © {new Date().getFullYear()} Warp.
        </p>
      </div>
    </footer>
  );
}
