import Link from "next/link";

import { adminAllowlistIsEmpty, currentAdminEmail } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Never cache: this reads personal data and gates on the caller's session, so
// a shared or statically-rendered copy would be both stale and a leak.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Waitlist — WARP admin",
  robots: { index: false, follow: false },
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-5 py-16 sm:px-7">{children}</main>
  );
}

export default async function AdminWaitlistPage() {
  const session = await auth();
  const admin = await currentAdminEmail();

  if (!admin) {
    // Same page for "signed out" and "signed in but not an admin" beyond the
    // one line of guidance — a distinct error would confirm to a signed-in
    // stranger that this route exists and is worth attacking.
    return (
      <Shell>
        <h1 className="text-[32px] font-bold tracking-[-0.02em] text-warp-heading">Not available</h1>
        <p className="mt-4 max-w-[52ch] text-[16px] text-warp-muted">
          {session?.user?.id
            ? "This account does not have admin access."
            : "You need to be signed in with an admin account to view this page."}
        </p>
        {adminAllowlistIsEmpty() && (
          <p className="mt-4 max-w-[62ch] rounded-[10px] border border-warp-line-2 bg-warp-panel px-4 py-3 text-[14px] text-warp-meta">
            No admins are configured. Set <code className="text-warp-accent">ADMIN_EMAILS</code> to a
            comma-separated list of addresses and restart the server.
          </p>
        )}
        <div className="mt-8 flex gap-4 text-[15px]">
          {!session?.user?.id && (
            <Link href="/signin" className="text-warp-accent hover:text-warp-accent-hi">
              Sign in
            </Link>
          )}
          <Link href="/" className="text-warp-muted hover:text-warp-body">
            Back to site
          </Link>
        </div>
      </Shell>
    );
  }

  const [signups, total] = await Promise.all([
    prisma.waitlistSignup.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.waitlistSignup.count(),
  ]);

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-accent">
            Admin
          </div>
          <h1 className="mt-3 text-[40px] font-bold leading-none tracking-[-0.02em] text-warp-heading">
            Waitlist
          </h1>
        </div>
        <div className="text-[15px] text-warp-muted">
          {total} {total === 1 ? "signup" : "signups"}
          <span className="text-warp-faint"> · signed in as {admin}</span>
        </div>
      </div>

      {signups.length === 0 ? (
        <p className="mt-10 rounded-[13px] border border-warp-line-2 bg-warp-panel px-5 py-8 text-center text-[15px] text-warp-muted">
          Nobody has signed up yet.
        </p>
      ) : (
        <>
          {/* Wide table scrolls inside its own box rather than the page. */}
          <div className="mt-10 overflow-x-auto rounded-[13px] border border-warp-line-2">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="bg-warp-panel text-[11.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Volume</th>
                  <th className="px-4 py-3 font-semibold">What they sell</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((signup) => (
                  <tr key={signup.id} className="border-t border-warp-line align-top">
                    <td className="px-4 py-3 text-[14.5px] text-warp-title">
                      <a
                        href={`mailto:${signup.email}`}
                        className="text-warp-accent hover:text-warp-accent-hi"
                      >
                        {signup.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-[14.5px] text-warp-body">
                      {signup.company ?? <span className="text-warp-faint">&mdash;</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[14.5px] text-warp-body">
                      {signup.volume ?? <span className="text-warp-faint">&mdash;</span>}
                    </td>
                    <td className="max-w-[380px] px-4 py-3 text-[14.5px] text-warp-muted">
                      {signup.notes ?? <span className="text-warp-faint">&mdash;</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[13.5px] text-warp-meta">
                      {formatDate(signup.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > signups.length && (
            <p className="mt-4 text-[13.5px] text-warp-meta">
              Showing the {signups.length} most recent of {total}.
            </p>
          )}
        </>
      )}

      <div className="mt-10 text-[15px]">
        <Link href="/" className="text-warp-muted hover:text-warp-body">
          Back to site
        </Link>
      </div>
    </Shell>
  );
}
