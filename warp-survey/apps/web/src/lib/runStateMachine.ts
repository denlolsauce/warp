import type { RunStatus, StageStatus } from "@prisma/client";
import { stagesForKind, type RunKind, type StageId } from "@warp-survey/contracts";

// Run and stage lifecycles are append-only: terminal states never transition,
// a retried stage is a new StageAttempt row at attempt + 1.

export const VALID_RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return VALID_RUN_TRANSITIONS[from].includes(to);
}

export const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function canTransitionStage(from: StageStatus, to: StageStatus): boolean {
  return VALID_STAGE_TRANSITIONS[from].includes(to);
}

interface StageAttemptLike {
  stage: string;
  status: StageStatus;
  attempt: number;
}

/**
 * Resume point for a (re)claimed run on any worker: the first stage in the
 * kind's fixed order whose latest attempt isn't SUCCEEDED. Null means every
 * stage succeeded and the run is complete.
 */
export function resumeStage(kind: RunKind, attempts: StageAttemptLike[]): StageId | null {
  const latest = new Map<string, StageAttemptLike>();
  for (const a of attempts) {
    const current = latest.get(a.stage);
    if (!current || a.attempt > current.attempt) latest.set(a.stage, a);
  }
  for (const stage of stagesForKind(kind)) {
    if (latest.get(stage)?.status !== "SUCCEEDED") return stage;
  }
  return null;
}

/**
 * Fencing check: a stage update is only accepted when its token is >= the
 * highest token the run has seen, preventing a stale worker (whose lease
 * expired and whose message was re-claimed) from publishing over a newer
 * attempt.
 */
export function isFresh(updateToken: number, runToken: number): boolean {
  return updateToken >= runToken;
}
