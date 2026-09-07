import Link from "next/link";

import { StatusBadge } from "@/components/studio/statusBadge";
import { JobProgress } from "@/components/studio/JobProgress";
import { serializeJob } from "@/components/studio/jobSerialization";
import { prisma } from "@/lib/prisma";
import { requireStudioContext } from "@/lib/studio";
import { assetPublicUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function StudioHomePage() {
  const { org } = await requireStudioContext();

  const products = await prisma.product.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    include: {
      assets: { where: { kind: { in: ["SOG", "POSTER"] } }, orderBy: { createdAt: "desc" } },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { stages: { orderBy: [{ stage: "asc" }, { attempt: "desc" }] } },
      },
    },
  });

  return (
    <div className="px-7 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-studio-heading">
            Splats
          </h1>
          <p className="mt-1 text-[13px] text-studio-muted">
            Every capture in this workspace — live models and jobs still in the pipeline.
          </p>
        </div>
        <Link
          href="/studio/upload"
          className="flex h-[34px] items-center gap-2 rounded-[9px] bg-studio-dark px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(28,26,23,0.25)] hover:bg-studio-dark-hi hover:text-white"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          New capture
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-xl border border-dashed border-studio-line-2 bg-studio-well px-8 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-studio-line bg-studio-card text-studio-muted shadow-[0_1px_2px_rgba(28,26,23,0.05)]">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-5 w-5">
              <path d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z" strokeLinejoin="round" />
              <path d="M2 5l6 3.5L14 5M8 8.5v6" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="mt-4 text-[15px] font-semibold text-studio-heading">No splats yet</div>
          <p className="mt-1.5 max-w-[380px] text-[13px] text-studio-muted">
            Upload a two-minute product video and it comes back as an interactive 3D model you can
            embed anywhere.
          </p>
          <Link
            href="/studio/upload"
            className="mt-5 rounded-[9px] bg-studio-dark px-4 py-2 text-[13px] font-medium text-white hover:bg-studio-dark-hi hover:text-white"
          >
            Upload your first video
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const job = product.jobs[0];
            const sog = product.assets.find((a) => a.kind === "SOG");
            const poster = product.assets.find((a) => a.kind === "POSTER");
            return (
              <Link
                key={product.id}
                href={`/studio/products/${product.id}`}
                className="group overflow-hidden rounded-xl border border-studio-line bg-studio-card shadow-[0_1px_2px_rgba(28,26,23,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(28,26,23,0.08)]"
              >
                <div className="relative flex aspect-[4/3] items-center justify-center border-b border-studio-line bg-studio-well">
                  {poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPublicUrl(poster.storageKey)}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : product.status === "PROCESSING" && job ? (
                    <div className="w-full px-6">
                      <JobProgress productId={product.id} initialJob={serializeJob(job)} compact />
                    </div>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" className="h-10 w-10 text-studio-line-3">
                      <path d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z" strokeLinejoin="round" />
                      <path d="M2 5l6 3.5L14 5M8 8.5v6" strokeLinejoin="round" />
                    </svg>
                  )}
                  <span className="absolute right-2.5 top-2.5">
                    <StatusBadge status={product.status} />
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-medium text-studio-heading">
                      {product.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-studio-muted">
                      {formatBytes(sog?.sizeBytes ?? null)}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-studio-faint">
                    {product.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
