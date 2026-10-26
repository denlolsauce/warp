import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";

it(
  "scopes projects by organization and keeps public sharing and worker callbacks idempotent",
  { skip: !process.env.DATABASE_URL || !process.env.REDIS_URL, timeout: 20_000 },
  async () => {
    let prisma: typeof import("./prisma").prisma | undefined;
    let redis: typeof import("./queue").redis | undefined;
    let orgAId: string | undefined;
    let orgBId: string | undefined;
    let sharedProductId: string | undefined;
    let callbackProductId: string | undefined;
    let callbackJobId: string | undefined;
    const previousSecret = process.env.WORKER_CALLBACK_SECRET;

    try {
      ({ prisma } = await import("./prisma"));
      ({ redis } = await import("./queue"));
      const projects = await import("./projects");
      const completionRoute = await import("../app/api/jobs/[id]/complete/route");
      const suffix = randomUUID();
      const orgA = await prisma.organization.create({ data: { slug: `itest-a-${suffix}`, name: "Integration A" } });
      orgAId = orgA.id;
      const orgB = await prisma.organization.create({ data: { slug: `itest-b-${suffix}`, name: "Integration B" } });
      orgBId = orgB.id;

      const sharedProduct = await prisma.product.create({
        data: { orgId: orgA.id, name: "Share fixture", status: "READY", captureProfile: "drone" },
      });
      sharedProductId = sharedProduct.id;
      assert.equal(await projects.getWorkspaceProject(orgB.id, sharedProduct.id), null);

      const enabled = await projects.setProjectShared(orgA.id, sharedProduct.id, true);
      assert.equal(enabled.shared, true);
      assert.ok(enabled.shareToken);
      assert.equal((await projects.getSharedProject(enabled.shareToken!))?.id, sharedProduct.id);
      assert.equal((await projects.setProjectShared(orgA.id, sharedProduct.id, false)).shared, false);
      assert.equal(await projects.getSharedProject(enabled.shareToken!), null);

      const callbackProduct = await prisma.product.create({
        data: { orgId: orgA.id, name: "Callback fixture", status: "PROCESSING", captureProfile: "drone" },
      });
      callbackProductId = callbackProduct.id;
      const callbackJob = await prisma.job.create({ data: { productId: callbackProduct.id, status: "QUEUED" } });
      callbackJobId = callbackJob.id;

      process.env.WORKER_CALLBACK_SECRET = "integration-only-secret";
      const sendCallback = async (body: unknown) => completionRoute.POST(
        new Request(`http://localhost/api/jobs/${callbackJob.id}/complete`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": "integration-only-secret" },
          body: JSON.stringify(body),
        }),
        { params: { id: callbackJob.id } },
      );

      const missingAssets = await sendCallback({ status: "success" });
      assert.equal(missingAssets.status, 400);
      assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: callbackJob.id } })).status, "QUEUED");

      const hashSog = "a".repeat(64);
      const hashPly = "b".repeat(64);
      const assets = {
        sog: { key: `products/${callbackProduct.id}/${hashSog}.sog`, url: "https://unused.invalid/model.sog", sizeBytes: 1024, contentHash: hashSog },
        ply: { key: `products/${callbackProduct.id}/${hashPly}.ply`, url: "https://unused.invalid/model.ply", sizeBytes: 2048, contentHash: hashPly },
      };
      const first = await sendCallback({ status: "success", assets });
      assert.equal(first.status, 200);
      const duplicate = await sendCallback({ status: "failure", errorMessage: "late duplicate" });
      assert.equal(duplicate.status, 200);
      assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: callbackJob.id } })).status, "SUCCEEDED");
      assert.equal(await prisma.asset.count({ where: { productId: callbackProduct.id } }), 2);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: callbackProduct.id } })).status, "READY");
    } finally {
      if (previousSecret === undefined) delete process.env.WORKER_CALLBACK_SECRET;
      else process.env.WORKER_CALLBACK_SECRET = previousSecret;
      if (prisma) {
        if (callbackJobId) await prisma.jobStageRun.deleteMany({ where: { jobId: callbackJobId } });
        if (callbackProductId) {
          await prisma.asset.deleteMany({ where: { productId: callbackProductId } });
          await prisma.product.delete({ where: { id: callbackProductId } });
        }
        if (sharedProductId) await prisma.product.delete({ where: { id: sharedProductId } });
        for (const id of [orgAId, orgBId].filter((value): value is string => Boolean(value))) {
          await prisma.organization.delete({ where: { id } });
        }
        await prisma.$disconnect();
      }
      redis?.disconnect();
    }
  },
);
