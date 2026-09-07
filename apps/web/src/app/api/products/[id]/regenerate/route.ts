import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueuePipelineJob } from "@/lib/queue";
import { jobsUsedThisPeriod, PLAN_JOB_LIMITS, requireOwnedProduct } from "@/lib/studioApi";

// A retry is a new Job, never a reopened one (job state machine).
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireOwnedProduct(params.id);
  if ("error" in access) return access.error;
  const { org, product } = access;

  const running = await prisma.job.findFirst({
    where: { productId: product.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (running) {
    return NextResponse.json({ error: "A job is already in progress for this capture." }, { status: 409 });
  }

  const used = await jobsUsedThisPeriod(org.id);
  const limit = PLAN_JOB_LIMITS[org.plan];
  if (used >= limit) {
    return NextResponse.json(
      { error: `Plan limit reached — ${used} of ${limit} captures used this month.` },
      { status: 403 },
    );
  }

  const job = await prisma.job.create({ data: { productId: product.id, status: "QUEUED" } });
  await prisma.product.update({ where: { id: product.id }, data: { status: "PROCESSING" } });
  await enqueuePipelineJob({ jobId: job.id, productId: product.id });

  return NextResponse.json({ jobId: job.id });
}
