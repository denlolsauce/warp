"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProductStatus } from "@prisma/client";

interface RecentProduct {
  id: string;
  name: string;
  status: ProductStatus;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function StatusDot({ status }: { status: ProductStatus }) {
  const color =
    status === "READY"
      ? "bg-studio-green"
      : status === "FAILED"
        ? "bg-studio-red"
        : status === "PROCESSING"
          ? "bg-studio-amber"
          : "bg-studio-faint";
  return <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${color}`} />;
}

const navItems = [
  {
    href: "/studio",
    label: "Splats",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4">
        <path d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z" strokeLinejoin="round" />
        <path d="M2 5l6 3.5L14 5M8 8.5v6" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/studio/upload",
    label: "New capture",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4">
        <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function StudioSidebar({
  orgName,
  userName,
  plan,
  used,
  limit,
  recent,
}: {
  orgName: string;
  userName: string;
  plan: string;
  used: number;
  limit: number;
  recent: RecentProduct[];
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col px-3 py-3">
      {/* Workspace header */}
      <div className="flex items-center gap-2.5 px-2 py-2">
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-studio-brand text-[15px] font-bold text-white shadow-[inset_0_-2px_4px_rgba(0,0,0,0.18)]">
          W
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-studio-heading">
            {orgName}
          </span>
          <span className="block text-[11px] text-studio-muted">Studio</span>
        </span>
      </div>

      {/* Primary action */}
      <Link
        href="/studio/upload"
        className="mt-2 flex h-[38px] items-center gap-2.5 rounded-[10px] bg-studio-dark px-3.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(28,26,23,0.25)] hover:bg-studio-dark-hi hover:text-white"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
        </svg>
        New capture
      </Link>

      {/* Nav */}
      <nav className="mt-4 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const active =
            item.href === "/studio" ? pathname === "/studio" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] ${
                active
                  ? "bg-[rgba(28,26,23,0.06)] font-medium text-studio-heading"
                  : "text-studio-body hover:bg-[rgba(28,26,23,0.04)]"
              }`}
            >
              <span className="text-studio-muted">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Recent captures */}
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-studio-faint">
          Recent
        </div>
        <div className="flex flex-col gap-0.5">
          {recent.length === 0 && (
            <div className="px-2.5 py-1.5 text-[12.5px] text-studio-faint">No captures yet</div>
          )}
          {recent.map((p) => {
            const active = pathname === `/studio/products/${p.id}`;
            return (
              <Link
                key={p.id}
                href={`/studio/products/${p.id}`}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] ${
                  active
                    ? "border border-studio-line bg-studio-card shadow-[0_1px_2px_rgba(28,26,23,0.05)]"
                    : "hover:bg-[rgba(28,26,23,0.04)]"
                }`}
              >
                <StatusDot status={p.status} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-studio-body">{p.name}</span>
                <span className="text-[11px] text-studio-faint">{relativeTime(p.createdAt)}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Usage meter */}
      <div className="mx-1 mb-2 rounded-[10px] border border-studio-amber-line bg-studio-amber-bg px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-studio-amber">
            <span className="h-[7px] w-[7px] rounded-full bg-studio-brand" />
            {plan.charAt(0) + plan.slice(1).toLowerCase()} plan
          </span>
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.05em] text-studio-amber">
            {used} / {limit} jobs
          </span>
        </div>
        <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[rgba(180,83,9,0.18)]">
          <div
            className="h-full rounded-full bg-studio-brand"
            style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }}
          />
        </div>
      </div>

      {/* Account */}
      <div className="flex items-center gap-2.5 border-t border-studio-line px-2 pt-2.5">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[rgba(28,26,23,0.08)] text-[11px] font-semibold text-studio-heading">
          {userName.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-studio-body">{userName}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5 text-studio-faint">
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </aside>
  );
}
