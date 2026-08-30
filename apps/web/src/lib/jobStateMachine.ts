import type { Job, JobStage, JobStatus, Product, StageStatus } from "@prisma/client";

// Mirrors CLAUDE.md's "Pipeline stages" list. The Python worker matches
// against this same set of strings with no shared import to enforce it —
// same contract as the old STAGE_TO_TOUR_STATUS: the Prisma enum's stored
// text is the interface.
export const STAGE_ORDER: JobStage[] = [
  "INGEST",
  "FRAME_EXTRACTION",
  "POSE_ESTIMATION",
  "TRAINING",
  "CLEANUP",
  "COMPRESSION",
  "PUBLISH",
];

export const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[from].includes(to);
}

// Every JobStageRun is append-only (PENDING -> RUNNING -> terminal, never
// reused) — a retry is a new row at attempt + 1, not a transition back out
// of FAILED on the same row.
export const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function canTransitionStage(from: StageStatus, to: StageStatus): boolean {
  return VALID_STAGE_TRANSITIONS[from].includes(to);
}

export function nextStage(current: JobStage | null): JobStage | null {
  const index = current === null ? -1 : STAGE_ORDER.indexOf(current);
  return STAGE_ORDER[index + 1] ?? null;
}

interface StageRunLike {
  stage: JobStage;
  status: StageStatus;
  attempt: number;
}

// Where a (re)started worker should pick up: the first stage in fixed order
// whose latest attempt isn't SUCCEEDED. A stage with no rows yet counts the
// same as a stage whose latest attempt failed — both mean "not done".
// Returns null once every stage has a SUCCEEDED row, i.e. the job is done.
export function resumeStage(stageRuns: StageRunLike[]): JobStage | null {
  const latestAttempt = new Map<JobStage, StageRunLike>();
  for (const run of stageRuns) {
    const current = latestAttempt.get(run.stage);
    if (!current || run.attempt > current.attempt) {
      latestAttempt.set(run.stage, run);
    }
  }

  for (const stage of STAGE_ORDER) {
    if (latestAttempt.get(stage)?.status !== "SUCCEEDED") {
      return stage;
    }
  }
  return null;
}

export interface ProductStatusPayload {
  status: Product["status"];
  jobStatus: JobStatus | null;
  currentStage: JobStage | null;
  errorMessage: string | null;
  name: string;
}

export function toProductStatusPayload(product: Product & { jobs: Job[] }): ProductStatusPayload {
  const latestJob = product.jobs[0] as Job | undefined;
  return {
    status: product.status,
    jobStatus: latestJob?.status ?? null,
    currentStage: latestJob?.currentStage ?? null,
    errorMessage: latestJob?.errorMessage ?? null,
    name: product.name,
  };
}
