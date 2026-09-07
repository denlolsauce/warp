import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "test@portal.dev";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Test Merchant" },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo-goods" },
    update: {},
    create: {
      name: "Demo Goods",
      slug: "demo-goods",
      plan: "STARTER",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  // Demo captures. Storage keys point at files that exist in apps/web/public,
  // so with no NEXT_PUBLIC_ASSET_BASE_URL configured the viewer loads them
  // straight from the dev server.
  const existing = await prisma.product.count({ where: { orgId: org.id } });
  if (existing === 0) {
    const ready = [
      { name: "Ribbed vase", sog: "vase2.sog", sizeBytes: 6_400_000, duration: 128 },
      { name: "Lounge chair", sog: "chair_unpruned_upright.sog", sizeBytes: 11_200_000, duration: 176 },
    ];
    for (const item of ready) {
      const product = await prisma.product.create({
        data: {
          orgId: org.id,
          name: item.name,
          status: "READY",
          video: { create: { storageKey: `videos/demo/${item.sog}.mp4`, durationSec: item.duration } },
          assets: {
            create: [
              { kind: "SOG", storageKey: item.sog, sizeBytes: item.sizeBytes, contentHash: "demo" },
              { kind: "PLY", storageKey: `${item.sog}.ply`, sizeBytes: item.sizeBytes * 14, contentHash: "demo" },
            ],
          },
        },
      });
      const job = await prisma.job.create({
        data: {
          productId: product.id,
          status: "SUCCEEDED",
          startedAt: new Date(Date.now() - 90 * 60_000),
          finishedAt: new Date(Date.now() - 12 * 60_000),
        },
      });
      const stages = [
        "INGEST",
        "FRAME_EXTRACTION",
        "POSE_ESTIMATION",
        "TRAINING",
        "CLEANUP",
        "COMPRESSION",
        "PUBLISH",
      ] as const;
      for (const stage of stages) {
        await prisma.jobStageRun.create({
          data: { jobId: job.id, stage, status: "SUCCEEDED", startedAt: new Date(), finishedAt: new Date() },
        });
      }
    }

    // One capture mid-pipeline so the progress UI has something live to show.
    const processing = await prisma.product.create({
      data: {
        orgId: org.id,
        name: "Ceramic teapot",
        status: "PROCESSING",
        video: { create: { storageKey: "videos/demo/teapot.mp4", durationSec: 143 } },
      },
    });
    const processingJob = await prisma.job.create({
      data: {
        productId: processing.id,
        status: "RUNNING",
        currentStage: "TRAINING",
        startedAt: new Date(Date.now() - 24 * 60_000),
      },
    });
    for (const [stage, status] of [
      ["INGEST", "SUCCEEDED"],
      ["FRAME_EXTRACTION", "SUCCEEDED"],
      ["POSE_ESTIMATION", "SUCCEEDED"],
      ["TRAINING", "RUNNING"],
    ] as const) {
      await prisma.jobStageRun.create({
        data: {
          jobId: processingJob.id,
          stage,
          status,
          startedAt: new Date(),
          finishedAt: status === "SUCCEEDED" ? new Date() : null,
        },
      });
    }
  }

  console.log("Seeded:", { user: user.email, org: org.slug });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
