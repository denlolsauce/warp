import type { Job, Tour, TourStatus } from "@prisma/client";

export interface TourStatusPayload {
  status: TourStatus;
  stage: string | null;
  state: string | null;
  errorMessage: string | null;
  manifestUrl: string | null;
  name: string;
}

export function toTourStatusPayload(tour: Tour & { jobs: Job[] }): TourStatusPayload {
  const latestJob = tour.jobs[0] as Job | undefined;
  return {
    status: tour.status,
    stage: latestJob?.stage ?? null,
    state: latestJob?.state ?? null,
    errorMessage: latestJob?.errorMessage ?? null,
    manifestUrl: tour.manifestUrl,
    name: tour.name,
  };
}
