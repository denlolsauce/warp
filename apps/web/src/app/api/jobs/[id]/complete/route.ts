import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendProductReadyEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { parseWorkerCompletionInput } from "@/lib/project-types";

function validWorkerSecret(value: string | null): boolean {
  const expected = process.env.WORKER_CALLBACK_SECRET;
  if (!expected || !value) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(value);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function matchesAssetKey(key: string, productId: string, extension: "sog" | "ply", contentHash: string): boolean {
  return key === `products/${productId}/${contentHash}.${extension}` && /^[a-f0-9]{64}$/i.test(contentHash);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!validWorkerSecret(request.headers.get("x-worker-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const completion = parseWorkerCompletionInput(body);
  if (!completion) {
    return NextResponse.json({ error: "invalid completion payload" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: { product: { include: { org: { include: { memberships: { include: { user: true } } } } } } },
  });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true, alreadyTerminal: true, status: job.status });
  }

  if (completion.status === "success") {
    if (
      !matchesAssetKey(completion.assets.sog.key, job.productId, "sog", completion.assets.sog.contentHash) ||
      !matchesAssetKey(completion.assets.ply.key, job.productId, "ply", completion.assets.ply.contentHash)
    ) {
      return NextResponse.json({ error: "asset keys do not match the job product" }, { status: 400 });
    }
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const changed = await tx.job.updateMany({
      where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: completion.status === "success" ? "SUCCEEDED" : "FAILED",
        finishedAt: new Date(),
        errorMessage: completion.status === "failure" ? completion.errorMessage : null,
      },
    });
    if (changed.count !== 1) return { accepted: false };

    if (completion.status === "success") {
      await tx.asset.createMany({
        data: [
          {
            productId: job.productId,
            kind: "SOG",
            storageKey: completion.assets.sog.key,
            sizeBytes: completion.assets.sog.sizeBytes,
            contentHash: completion.assets.sog.contentHash,
          },
          {
            productId: job.productId,
            kind: "PLY",
            storageKey: completion.assets.ply.key,
            sizeBytes: completion.assets.ply.sizeBytes,
            contentHash: completion.assets.ply.contentHash,
          },
        ],
      });
      await tx.product.update({ where: { id: job.productId }, data: { status: "READY" } });
    } else {
      await tx.product.update({ where: { id: job.productId }, data: { status: "FAILED" } });
    }
    return { accepted: true };
  });

  if (!outcome.accepted) {
    const current = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
    return NextResponse.json({ ok: true, alreadyTerminal: true, status: current?.status ?? null });
  }

  if (completion.status === "success") {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const projectUrl = `${appUrl}/projects/${job.productId}`;
    for (const membership of job.product.org.memberships) {
      try {
        await sendProductReadyEmail(membership.user.email, job.product.name, projectUrl);
      } catch (error) {
        console.error("failed to send product-ready email", error);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
