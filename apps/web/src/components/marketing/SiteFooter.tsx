import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-warp-line">
      <div className="mx-auto flex max-w-[1220px] flex-wrap items-center gap-[26px] px-5 py-[34px] sm:px-7">
        <span className="text-[15px] font-extrabold tracking-[0.04em] text-warp-strong">WARP</span>

        <span className="flex-1" />

        <div className="flex gap-6 text-sm text-warp-dim">
          <Link href="/" className="text-warp-dim hover:text-warp-body">
            Pipeline
          </Link>
          <Link href="/gallery" className="text-warp-dim hover:text-warp-body">
            Gallery
          </Link>
          <Link href="/waitlist" className="text-warp-dim hover:text-warp-body">
            Waitlist
          </Link>
          {/* No privacy page exists yet, so this stays inert rather than 404ing. */}
          <span className="text-warp-dim">Privacy</span>
        </div>

        <span className="text-sm text-warp-faint">&copy; 2026 WARP</span>
      </div>
    </footer>
  );
}
