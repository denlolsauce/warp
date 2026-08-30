import type { Job, JobStageRun } from "@prisma/client";

export interface SerializedStageRun {
  stage: string;
  attempt: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SerializedJob {
  id: string;
  status: string;
  currentStage: string | null;
  errorMessage: string | null;
  stages: SerializedStageRun[];
}

export function serializeJob(job: Job & { stages: JobStageRun[] }): SerializedJob {
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    errorMessage: job.errorMessage,
    stages: job.stages.map((s) => ({
      stage: s.stage,
      attempt: s.attempt,
      status: s.status,
      startedAt: s.startedAt?.toISOString() ?? null,
      finishedAt: s.finishedAt?.toISOString() ?? null,
    })),
  };
}
