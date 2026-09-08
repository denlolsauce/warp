import { timingSafeEqual } from "node:crypto";
import { stageStatusUpdate, stagesForKind } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { canTransitionRun, isFresh } from "@/lib/runStateMachine";

function authorizedWorker(request: Request): boolean {
  const presented = request.headers.get("x-worker-secret") ?? "";
  const expected = process.env.WORKER_CALLBACK_SECRET ?? "";
  if (!expected || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * Pipeline worker → web status callback. Stage attempts are append-only and
 * lease-fenced: an update whose fencing token is lower than the highest token
 * the run has recorded is from a stale worker and is rejected, so it can
 * never publish over a newer attempt.
 */
export async function POST(request: Request) {
  if (!authorizedWorker(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = stageStatusUpdate.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid update", issues: parsed.error.issues }, { status: 400 });
  }
  const update = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const run = await tx.processingRun.findUnique({ where: { id: update.runId } });
      if (!run) throw new Error("unknown run");
      if (!isFresh(update.fencingToken, run.fencingToken)) throw new Error("stale fencing token");

      await tx.processingRun.update({
        where: { id: run.id },
        data: { fencingToken: Math.max(run.fencingToken, update.fencingToken) },
      });

      if (update.status === "RUNNING") {
        await tx.stageAttempt.upsert({
          where: { runId_stage_attempt: { runId: run.id, stage: update.stage, attempt: update.attempt } },
          create: {
            runId: run.id,
            stage: update.stage,
            attempt: update.attempt,
            status: "RUNNING",
            startedAt: new Date(),
          },
          update: {},
        });
        if (run.status === "QUEUED" && canTransitionRun("QUEUED", "RUNNING")) {
          await tx.processingRun.update({
            where: { id: run.id },
            data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
          });
        }
        return;
      }

      // Terminal stage statuses only apply to a RUNNING attempt (append-only).
      const completed = await tx.stageAttempt.updateMany({
        where: { runId: run.id, stage: update.stage, attempt: update.attempt, status: "RUNNING" },
        data: {
          status: update.status,
          errorMessage: update.errorMessage,
          transient: update.transient,
          metrics: (update.metrics ?? undefined) as object | undefined,
          artifactKeys: update.artifactKeys,
          timingSeconds: update.timingSeconds,
          finishedAt: new Date(),
        },
      });

      if (update.status === "FAILED" && update.transient === false) {
        // Data-quality failure: the run fails with the specific stage reason.
        if (canTransitionRun(run.status, "FAILED")) {
          await tx.processingRun.update({
            where: { id: run.id },
            data: { status: "FAILED", errorMessage: update.errorMessage, finishedAt: new Date() },
          });
        }
      }

      const stages = stagesForKind(run.kind);
      const isFinalStage = stages.at(-1) === update.stage;
      if (update.status === "SUCCEEDED" && isFinalStage && completed.count > 0) {
        if (canTransitionRun(run.status, "SUCCEEDED")) {
          await tx.processingRun.update({
            where: { id: run.id },
            data: { status: "SUCCEEDED", finishedAt: new Date() },
          });
        }
      }
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    const status = message === "stale fencing token" ? 409 : message === "unknown run" ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
