import { NextResponse } from "next/server";
import { enqueuePipelineJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { jobsUsedThisPeriod, PLAN_JOB_LIMITS, requireApiOrg } from "@/lib/studioApi";

// Called after the direct-to-R2 multipart upload completes: creates the
// Product + ProductVideo rows around the already-uploaded key, opens the
// first Job, and enqueues it for the Python worker.
export async function POST(request: Request) {
  const access = await requireApiOrg();
  if ("error" in access) return access.error;
  const { org } = access;

  const { name, videoKey, durationSec } = (await request.json()) as {
    name?: string;
    videoKey?: string;
    durationSec?: number;
  };
  if (!name?.trim() || !videoKey) {
    return NextResponse.json({ error: "name and videoKey are required" }, { status: 400 });
  }

  const used = await jobsUsedThisPeriod(org.id);
  const limit = PLAN_JOB_LIMITS[org.plan];
  if (used >= limit) {
    return NextResponse.json(
      { error: `Plan limit reached — ${used} of ${limit} captures used this month.` },
      { status: 403 },
    );
  }

  const product = await prisma.product.create({
    data: {
      orgId: org.id,
      name: name.trim(),
      status: "PROCESSING",
      video: { create: { storageKey: videoKey, durationSec: durationSec ?? null } },
      jobs: { create: { status: "QUEUED" } },
    },
    include: { jobs: true },
  });

  await enqueuePipelineJob({ jobId: product.jobs[0].id, productId: product.id });

  return NextResponse.json({ productId: product.id, jobId: product.jobs[0].id });
}
