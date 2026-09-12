/**
 * Development seed: one demo org with a synthetic two-epoch site so every
 * screen (portfolio, survey detail, comparison, report review, sharing) has
 * data. Everything here is clearly synthetic sample data — no real survey.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { comparisonManifest, surveyManifest } from "@warp-survey/contracts";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Conforms to the surveyManifest contract in @warp-survey/contracts.
// Everything is synthetic sample data for development, stated in findings.
const SYNTHETIC_PROVENANCE = {
  pipelineVersion: "0.0.0-seed",
  backendName: "seed-script",
  backendVersion: "0.0.0",
  containerDigest: null,
  configHash: "seed",
  packageVersions: {},
};

function syntheticManifest(args: {
  surveyId: string;
  revisionId: string;
  siteId: string;
  capturedAt: Date;
}) {
  return {
    manifestVersion: 1,
    surveyId: args.surveyId,
    revisionId: args.revisionId,
    siteId: args.siteId,
    capturedAt: args.capturedAt.toISOString(),
    spatial: {
      horizontalCrs: "EPSG:25832",
      verticalDatum: { id: "EPSG:7837", description: "DHHN2016 height" },
      unit: "metre",
      localOrigin: [512000, 5700000, 120],
      transforms: [],
    },
    bounds: { min: [511920, 5699940, 115], max: [512080, 5700060, 155] },
    artifacts: [],
    measurementQuality: {
      state: "PASS",
      checkpoints: {
        count: 2,
        horizontalRmseM: 0.031,
        verticalRmseM: 0.042,
        horizontalBiasM: 0.004,
        verticalBiasM: -0.011,
        maxHorizontalResidualM: 0.038,
        maxVerticalResidualM: 0.055,
        distributionNote: "Synthetic sample data — not a real checkpoint assessment.",
      },
      groundSamplingDistanceM: 0.021,
      registeredImages: 412,
      totalImages: 418,
      acceptanceProfileId: null,
      acceptanceProfileVersion: 1,
      findings: ["Synthetic sample data seeded for development. Not a real survey."],
    },
    visualizationQuality: {
      state: "UNVERIFIED",
      gaussianCount: null,
      findings: ["No visualization produced for this synthetic sample."],
    },
    provenance: SYNTHETIC_PROVENANCE,
    viewer: null,
  };
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@warp-survey.local" },
    update: {},
    create: {
      email: "demo@warp-survey.local",
      name: "Demo Engineer",
      emailVerified: new Date(),
    },
  });

  const reviewer = await prisma.user.upsert({
    where: { email: "reviewer@warp-survey.local" },
    update: {},
    create: {
      email: "reviewer@warp-survey.local",
      name: "Demo Reviewer",
      emailVerified: new Date(),
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo-geotech" },
    update: {},
    create: { name: "Demo Geotech Consultancy", slug: "demo-geotech" },
  });

  await prisma.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: { role: "ENGINEER" },
    create: { userId: user.id, orgId: org.id, role: "ENGINEER" },
  });
  await prisma.membership.upsert({
    where: { userId_orgId: { userId: reviewer.id, orgId: org.id } },
    update: { role: "REVIEWER" },
    create: { userId: reviewer.id, orgId: org.id, role: "REVIEWER" },
  });

  const existing = await prisma.site.findFirst({
    where: { orgId: org.id, name: "Sample Quarry (synthetic)" },
  });
  if (existing) {
    console.log("Seed already applied; skipping.");
    return;
  }

  const site = await prisma.site.create({
    data: {
      orgId: org.id,
      name: "Sample Quarry (synthetic)",
      horizontalCrs: "EPSG:25832",
      verticalDatum: "EPSG:7837",
    },
  });

  await prisma.siteSubscription.create({
    data: { orgId: org.id, siteId: site.id, status: "PILOT" },
  });

  await prisma.acceptanceProfile.create({
    data: {
      siteId: site.id,
      version: 1,
      criteria: { horizontalRmseM: 0.05, verticalRmseM: 0.05, minCheckpoints: 5 },
      approvedByUserId: reviewer.id,
      approvedAt: new Date(),
    },
  });

  // Two epochs: an approved baseline and a later approved candidate, so a
  // comparison and report can exist.
  const epochs = [
    { capturedAt: new Date("2026-06-15T09:00:00Z"), label: "2026-06" },
    { capturedAt: new Date("2026-08-20T09:00:00Z"), label: "2026-08" },
  ];

  const revisionIds: string[] = [];

  for (const epoch of epochs) {
    const survey = await prisma.survey.create({
      data: {
        siteId: site.id,
        capturedAt: epoch.capturedAt,
        status: "PROCESSED",
        notes: `Synthetic sample epoch ${epoch.label}.`,
      },
    });

    for (let i = 1; i <= 5; i++) {
      await prisma.controlPoint.create({
        data: {
          surveyId: survey.id,
          role: i <= 3 ? "GCP" : "CHECKPOINT",
          label: `${i <= 3 ? "GCP" : "CHK"}-${i}`,
          easting: 512000 + i * 15,
          northing: 5700000 + i * 12,
          elevation: 120 + i * 0.5,
          horizontalAccuracyM: 0.02,
          verticalAccuracyM: 0.03,
        },
      });
    }

    const run = await prisma.processingRun.create({
      data: {
        surveyId: survey.id,
        kind: "MEASUREMENT",
        status: "SUCCEEDED",
        idempotencyKey: `seed-measurement-${epoch.label}`,
        startedAt: epoch.capturedAt,
        finishedAt: new Date(epoch.capturedAt.getTime() + 2 * 3600_000),
      },
    });

    const measurementStages = [
      "INPUT_VALIDATION",
      "RECONSTRUCTION",
      "DENSE_PRODUCTS",
      "CHECKPOINT_QA",
      "PUBLISH_MEASUREMENT",
    ];
    for (const [i, stage] of measurementStages.entries()) {
      await prisma.stageAttempt.create({
        data: {
          runId: run.id,
          stage,
          attempt: 1,
          status: "SUCCEEDED",
          metrics:
            stage === "CHECKPOINT_QA"
              ? {
                  checkpointCount: 2,
                  horizontalRmseM: 0.031,
                  verticalRmseM: 0.042,
                  note: "Synthetic metrics for development.",
                }
              : { note: "Synthetic metrics for development." },
          timingSeconds: 600 + i * 300,
          startedAt: epoch.capturedAt,
          finishedAt: new Date(epoch.capturedAt.getTime() + (i + 1) * 900_000),
        },
      });
    }

    const revision = await prisma.surveyRevision.create({
      data: {
        surveyId: survey.id,
        runId: run.id,
        manifest: {},
        measurementQualityState: "PASS",
        visualizationQualityState: "UNVERIFIED",
      },
    });
    // The manifest embeds its own revision id, so write it after creation.
    await prisma.surveyRevision.update({
      where: { id: revision.id },
      data: {
        manifest: surveyManifest.parse(
          syntheticManifest({
            surveyId: survey.id,
            revisionId: revision.id,
            siteId: site.id,
            capturedAt: epoch.capturedAt,
          }),
        ),
      },
    });
    revisionIds.push(revision.id);

    for (const kind of ["DSM_COG", "DENSE_POINT_CLOUD_LAZ", "ORTHOMOSAIC_COG"]) {
      await prisma.artifact.create({
        data: {
          revisionId: revision.id,
          kind,
          storageKey: `seed/${site.id}/${epoch.label}/${kind.toLowerCase()}.bin`,
          checksumSha256: createHash("sha256").update(`${kind}-${epoch.label}`).digest("hex"),
          sizeBytes: BigInt(1024 * 1024),
          contentType: "application/octet-stream",
          provenance: SYNTHETIC_PROVENANCE,
        },
      });
    }
  }

  const comparison = await prisma.comparison.create({
    data: {
      siteId: site.id,
      baselineRevisionId: revisionIds[0],
      candidateRevisionId: revisionIds[1],
      method: "ELEVATION_DIFFERENCING",
      exploratory: false,
      manifest: {},
    },
  });
  // Conforms to comparisonManifest; embeds its own id, so written after create.
  await prisma.comparison.update({
    where: { id: comparison.id },
    data: {
      manifest: comparisonManifest.parse({
        manifestVersion: 1,
        comparisonId: comparison.id,
        siteId: site.id,
        baselineRevisionId: revisionIds[0],
        candidateRevisionId: revisionIds[1],
        method: "ELEVATION_DIFFERENCING",
        areaOfInterest: null,
        registrationCorrection: null,
        signConvention:
          "Elevation change is later minus earlier. Positive values indicate fill; negative values indicate cut.",
        result: {
          method: "ELEVATION_DIFFERENCING",
          gridResolutionM: 0.1,
          cutVolumeM3: 1240.5,
          fillVolumeM3: 310.2,
          netVolumeM3: -930.3,
          affectedAreaM2: 4820,
          volumeUncertaintyM3: 145,
          detectionThresholdM: 0.08,
        },
        exploratory: false,
        artifacts: [],
        maskArtifactIds: [],
      }),
    },
  });

  const report = await prisma.reportRevision.create({
    data: {
      comparisonId: comparison.id,
      version: 1,
      status: "DRAFT",
      authorUserId: user.id,
      reportData: {
        title: "Change report 2026-06 → 2026-08 (synthetic sample)",
        note: "Synthetic sample report data seeded for development.",
      },
    },
  });

  // Share link for the stakeholder view; token printed once here for dev use.
  const token = randomBytes(24).toString("base64url");
  await prisma.shareLink.create({
    data: {
      createdByUserId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      label: "Demo stakeholder link",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
      revisions: { create: revisionIds.map((revisionId) => ({ revisionId })) },
    },
  });

  console.log("Seeded synthetic demo data.");
  console.log(`Sign-in emails: demo@warp-survey.local, reviewer@warp-survey.local`);
  console.log(`Demo share token (dev only): ${token}`);
  console.log(`Draft report: ${report.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
