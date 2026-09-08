import type { RunKind } from "@prisma/client";
import type { ProcessingJobMessage } from "@warp-survey/contracts";
import { prisma } from "./prisma";
import { enqueueViaOutbox, relayOutbox } from "./queue";

/**
 * Submit a processing run. Idempotent: resubmitting the same idempotency key
 * returns the existing run instead of creating a duplicate. The run row and
 * its queue message commit in one transaction (transactional outbox).
 */
export async function submitProcessingRun(params: {
  kind: RunKind;
  surveyId: string | null;
  comparisonId: string | null;
  organizationId: string;
  idempotencyKey: string;
}): Promise<{ runId: string; created: boolean }> {
  const existing = await prisma.processingRun.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { runId: existing.id, created: false };

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.processingRun.create({
      data: {
        kind: params.kind,
        surveyId: params.surveyId,
        comparisonId: params.comparisonId,
        idempotencyKey: params.idempotencyKey,
      },
    });
    const message: ProcessingJobMessage = {
      messageVersion: 1,
      runId: created.id,
      kind: params.kind,
      surveyId: params.surveyId ?? "",
      organizationId: params.organizationId,
      comparisonId: params.comparisonId,
      idempotencyKey: params.idempotencyKey,
      enqueuedAt: new Date().toISOString(),
    };
    await enqueueViaOutbox(tx, message);
    return created;
  });

  // Best-effort immediate delivery; a background relay covers failures.
  await relayOutbox().catch(() => undefined);

  return { runId: run.id, created: true };
}
