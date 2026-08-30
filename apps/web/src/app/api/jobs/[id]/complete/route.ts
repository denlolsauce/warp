import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendProductReadyEmail } from "@/lib/email";

interface AssetPayload {
  key: string;
  url: string;
  sizeBytes: number;
  contentHash: string;
}

// Called by the pipeline worker (pipeline/src/splat_pipeline/worker.py)
// when a job finishes — not the browser, so it authenticates with a shared
// secret rather than a user session. Owns every success-path side effect
// (Job/Product terminal status, Asset rows, the ready email) so there's one
// place responsible for all of them, matching db.py's own comment about why
// the worker doesn't write these directly.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const secret = request.headers.get("x-worker-secret");
  if (!secret || secret !== process.env.WORKER_CALLBACK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { status, assets, errorMessage } = (await request.json()) as {
    status?: "success" | "failure";
    assets?: Record<"sog" | "ply", AssetPayload>;
    errorMessage?: string;
  };
  if (status !== "success" && status !== "failure") {
    return NextResponse.json({ error: "status must be 'success' or 'failure'" }, { status: 400 });
  }

  const job = await prisma.job.update({
    where: { id: params.id },
    data: {
      status: status === "success" ? "SUCCEEDED" : "FAILED",
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    },
    include: { product: { include: { org: { include: { memberships: { include: { user: true } } } } } } },
  });

  if (status === "success") {
    if (!assets?.sog || !assets?.ply) {
      return NextResponse.json({ error: "assets.sog and assets.ply are required on success" }, { status: 400 });
    }

    const product = await prisma.product.update({
      where: { id: job.productId },
      data: { status: "READY" },
    });
    await prisma.asset.createMany({
      data: [
        { productId: product.id, kind: "SOG", storageKey: assets.sog.key, sizeBytes: assets.sog.sizeBytes, contentHash: assets.sog.contentHash },
        { productId: product.id, kind: "PLY", storageKey: assets.ply.key, sizeBytes: assets.ply.sizeBytes, contentHash: assets.ply.contentHash },
      ],
    });

    // The product is already ready at this point — a broken SMTP config or
    // transient send failure is a notification problem, not a reason to
    // fail this request and have the worker report (and record) the job as
    // failed when it actually succeeded.
    try {
      const productUrl = `${process.env.NEXT_PUBLIC_APP_URL}/products/${product.id}`;
      for (const membership of job.product.org.memberships) {
        await sendProductReadyEmail(membership.user.email, product.name, productUrl);
      }
    } catch (error) {
      console.error("failed to send product-ready email", error);
    }
  } else {
    await prisma.product.update({ where: { id: job.productId }, data: { status: "FAILED" } });
  }

  return NextResponse.json({ ok: true });
}
