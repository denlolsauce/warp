import { notFound } from "next/navigation";
import Link from "next/link";

import { JobProgress } from "@/components/studio/JobProgress";
import { serializeJob } from "@/components/studio/jobSerialization";
import { ProductActions } from "@/components/studio/ProductActions";
import { EmbedSnippet } from "@/components/studio/EmbedSnippet";
import { StatusBadge } from "@/components/studio/statusBadge";
import { SplatViewer } from "@/components/marketing/SplatViewer";
import { assetPublicUrl } from "@/lib/assets";
import { prisma } from "@/lib/prisma";
import { requireStudioContext } from "@/lib/studio";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const { org } = await requireStudioContext();

  const product = await prisma.product.findFirst({
    where: { id: params.id, orgId: org.id },
    include: {
      assets: { orderBy: { createdAt: "desc" } },
      video: true,
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { stages: { orderBy: [{ stage: "asc" }, { attempt: "desc" }] } },
      },
    },
  });
  if (!product) notFound();

  const job = product.jobs[0] ?? null;
  const sog = product.assets.find((a) => a.kind === "SOG");
  const ply = product.assets.find((a) => a.kind === "PLY");
  const live = job && (job.status === "QUEUED" || job.status === "RUNNING");

  return (
    <div className="px-7 py-6">
      <div className="flex items-center gap-2 text-[12.5px] text-studio-faint">
        <Link href="/studio" className="hover:text-studio-body">
          Splats
        </Link>
        <span>/</span>
        <span className="text-studio-muted">{product.name}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-studio-heading">
            {product.name}
          </h1>
          <StatusBadge status={product.status} />
        </div>
        <ProductActions
          productId={product.id}
          canRegenerate={!live}
          hasPly={Boolean(ply)}
          hasSog={Boolean(sog)}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Viewer / progress */}
        <div className="overflow-hidden rounded-xl border border-studio-line bg-studio-card shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
          {product.status === "READY" && sog ? (
            <SplatViewer
              src={assetPublicUrl(sog.storageKey)}
              label={`Interactive 3D model of ${product.name}`}
              className="aspect-[16/10] w-full"
            />
          ) : (
            <div className="px-6 py-6">
              <div className="text-[13.5px] font-semibold text-studio-heading">
                {product.status === "FAILED" ? "Processing failed" : "Processing"}
              </div>
              <p className="mb-5 mt-1 text-[12.5px] text-studio-muted">
                {product.status === "FAILED"
                  ? "The stage that failed is marked below with the specific reason."
                  : "The model appears here the moment the pipeline finishes. You can close this page — we'll email you."}
              </p>
              {job ? (
                <JobProgress productId={product.id} initialJob={serializeJob(job)} />
              ) : (
                <div className="text-[13px] text-studio-faint">No processing job yet.</div>
              )}
            </div>
          )}
        </div>

        {/* Side column */}
        <div className="flex flex-col gap-4">
          <EmbedSnippet productId={product.id} />

          <div className="rounded-xl border border-studio-line bg-studio-card p-4 shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
            <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-studio-faint">
              Details
            </div>
            <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
              <dt className="text-studio-muted">Created</dt>
              <dd className="m-0 text-right text-studio-heading">
                {product.createdAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </dd>
              <dt className="text-studio-muted">Source video</dt>
              <dd className="m-0 text-right text-studio-heading">
                {product.video?.durationSec ? `${Math.round(product.video.durationSec)}s` : "—"}
              </dd>
              <dt className="text-studio-muted">Delivered size</dt>
              <dd className="m-0 text-right font-mono text-[12px] text-studio-heading">
                {formatBytes(sog?.sizeBytes ?? null)}
              </dd>
              <dt className="text-studio-muted">Raw PLY</dt>
              <dd className="m-0 text-right font-mono text-[12px] text-studio-heading">
                {formatBytes(ply?.sizeBytes ?? null)}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
