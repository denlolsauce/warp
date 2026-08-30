import Link from "next/link";

const navLinks = [
  { href: "/", label: "Pipeline" },
  { href: "/gallery", label: "Gallery" },
  { href: "/waitlist", label: "Waitlist" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-warp-line bg-warp-bg/[0.78] backdrop-blur-[14px]">
      <div className="mx-auto flex h-[68px] max-w-[1220px] items-center gap-6 px-5 sm:px-7 lg:gap-10">
        <Link
          href="/"
          className="flex items-center gap-[11px] text-[19px] font-extrabold tracking-[0.04em] text-warp-title hover:text-warp-title"
        >
          WARP
        </Link>

        <nav className="hidden items-center gap-[30px] text-[14.5px] text-warp-nav md:flex">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="text-warp-nav hover:text-warp-body">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-4 sm:gap-[22px]">
          <Link href="/signin" className="hidden text-[14.5px] text-warp-nav hover:text-warp-body sm:inline">
            Sign in
          </Link>
          <Link
            href="/waitlist"
            className="whitespace-nowrap rounded-lg bg-warp-accent px-[17px] py-[9px] text-[14.5px] font-medium text-warp-accent-ink hover:bg-warp-accent-hi hover:text-warp-accent-ink"
          >
            Get early access
          </Link>
        </div>
      </div>
    </header>
  );
}
