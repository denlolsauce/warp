import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnedProduct } from "@/lib/studioApi";

// Polled by the studio job list for per-stage progress.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireOwnedProduct(params.id);
  if ("error" in access) return access.error;

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: access.product.id },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { stages: { orderBy: [{ stage: "asc" }, { attempt: "desc" }] } },
      },
    },
  });
  const job = product.jobs[0] ?? null;

  return NextResponse.json({
    id: product.id,
    name: product.name,
    status: product.status,
    job: job && {
      id: job.id,
      status: job.status,
      currentStage: job.currentStage,
      errorMessage: job.errorMessage,
      stages: job.stages.map((s) => ({
        stage: s.stage,
        attempt: s.attempt,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireOwnedProduct(params.id);
  if ("error" in access) return access.error;

  // Relation rows first — the schema has no cascade on these foreign keys.
  await prisma.$transaction([
    prisma.jobStageRun.deleteMany({ where: { job: { productId: params.id } } }),
    prisma.job.deleteMany({ where: { productId: params.id } }),
    prisma.asset.deleteMany({ where: { productId: params.id } }),
    prisma.productVideo.deleteMany({ where: { productId: params.id } }),
    prisma.product.delete({ where: { id: params.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
