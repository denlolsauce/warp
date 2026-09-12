import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { publicationUpdate, type PublicationUpdate } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { isFresh } from "@/lib/runStateMachine";

function authorizedWorker(request: Request): boolean {
  const presented = request.headers.get("x-worker-secret") ?? "";
  const expected = process.env.WORKER_CALLBACK_SECRET ?? "";
  if (!expected || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * Pipeline worker → web publication callback. The worker owns computation and
 * object storage; the web app owns the durable records the workspace reads, so
 * tenancy, immutability, and quality gating stay enforced in one place.
 *
 * Idempotent per run: a replayed publication reuses the run's existing
 * revision instead of creating a second one.
 */
export async function POST(request: Request) {
  if (!authorizedWorker(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = publicationUpdate.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid publication", issues: parsed.error.issues }, { status: 400 });
  }
  const update = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.processingRun.findUnique({ where: { id: update.runId } });
      if (!run) throw new Error("unknown run");
      if (!isFresh(update.fencingToken, run.fencingToken)) throw new Error("stale fencing token");

      // The publication must belong to the branch this run actually executes,
      // so an authorized callback cannot reach another run's outputs.
      if (run.kind !== update.branch) {
        throw new Error(`run ${run.id} is a ${run.kind} run and cannot publish ${update.branch} results`);
      }

      // Advance the fence here too: stage-status delivery is best-effort, so
      // publication must be able to make an older worker's token stale on its
      // own. The conditional update serializes concurrent publications.
      const fenced = await tx.processingRun.updateMany({
        where: { id: run.id, fencingToken: { lte: update.fencingToken } },
        data: { fencingToken: update.fencingToken },
      });
      if (fenced.count === 0) throw new Error("stale fencing token");

      if (update.branch === "COMPARISON") {
        return publishComparison(tx, run.comparisonId, update);
      }
      if (update.comparison) throw new Error("a survey publication cannot carry a comparison result");
      if (!run.surveyId) throw new Error("run has no survey to publish");
      return publishSurveyRevision(tx, run.id, run.surveyId, update);
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "publication failed";
    const status = message === "stale fencing token" ? 409 : message === "unknown run" ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}

type Tx = Prisma.TransactionClient;

async function publishSurveyRevision(
  tx: Tx,
  runId: string,
  surveyId: string,
  update: PublicationUpdate,
) {
  const existing = await tx.surveyRevision.findUnique({ where: { runId } });

  const measurementState = update.measurementQuality?.state;
  const visualizationState = update.visualizationQuality?.state;

  const revision = existing
    ? await tx.surveyRevision.update({
        where: { id: existing.id },
        data: {
          // A branch only ever sets its own quality state; measurement and
          // visualization verdicts stay independent.
          ...(measurementState ? { measurementQualityState: measurementState } : {}),
          ...(visualizationState ? { visualizationQualityState: visualizationState } : {}),
          manifest: mergeManifest(existing.manifest, update),
        },
      })
    : await tx.surveyRevision.create({
        data: {
          surveyId,
          runId,
          manifest: mergeManifest(null, update),
          ...(measurementState ? { measurementQualityState: measurementState } : {}),
          ...(visualizationState ? { visualizationQualityState: visualizationState } : {}),
        },
      });

  // Artifacts are immutable: re-publishing the same storage key is a no-op
  // rather than a duplicate row (enforced by the (revisionId, storageKey)
  // unique index, so a concurrent retry cannot slip past the check).
  const created = await tx.artifact.createMany({
    data: update.artifacts.map((a) => ({
      revisionId: revision.id,
      kind: a.kind,
      storageKey: a.storageKey,
      checksumSha256: a.checksumSha256,
      sizeBytes: BigInt(a.sizeBytes),
      contentType: a.contentType,
      spatialMetadata: (a.spatialMetadata ?? undefined) as object | undefined,
      provenance: update.provenance as object,
    })),
    skipDuplicates: true,
  });

  await tx.survey.update({
    where: { id: surveyId },
    data: { status: "PROCESSED" },
  });

  return { revisionId: revision.id, artifactsCreated: created.count };
}

function mergeManifest(existing: unknown, update: PublicationUpdate): object {
  const base = (existing as Record<string, unknown> | null) ?? { manifestVersion: 1 };
  return {
    ...base,
    ...(update.spatial ? { spatial: update.spatial } : {}),
    ...(update.bounds ? { bounds: update.bounds } : {}),
    ...(update.measurementQuality ? { measurementQuality: update.measurementQuality } : {}),
    ...(update.visualizationQuality ? { visualizationQuality: update.visualizationQuality } : {}),
    provenance: update.provenance,
  };
}

async function publishComparison(tx: Tx, runComparisonId: string | null, update: PublicationUpdate) {
  const comparison = update.comparison;
  if (!comparison) throw new Error("comparison publication carries no result");
  // The run's own relation decides which comparison may be written, never the
  // client-supplied id.
  if (!runComparisonId || runComparisonId !== comparison.comparisonId) {
    throw new Error("publication does not belong to this run's comparison");
  }

  const row = await tx.comparison.findUnique({ where: { id: runComparisonId } });
  if (!row) throw new Error("unknown comparison");

  await tx.comparison.update({
    where: { id: row.id },
    data: {
      exploratory: comparison.exploratory,
      manifest: {
        manifestVersion: 1,
        comparisonId: row.id,
        siteId: row.siteId,
        baselineRevisionId: row.baselineRevisionId,
        candidateRevisionId: row.candidateRevisionId,
        method: comparison.method,
        areaOfInterest: row.areaOfInterest ?? null,
        registrationCorrection: comparison.registrationCorrection ?? null,
        signConvention: comparison.signConvention,
        result: comparison.result ?? null,
        exploratory: comparison.exploratory,
        findings: comparison.findings,
        artifacts: update.artifacts,
        provenance: update.provenance,
      } as object,
    },
  });

  return { comparisonId: row.id };
}
