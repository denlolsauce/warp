import type {
  ComparisonEpochPayload,
  ComparisonJobPayload,
  JobControlPoint,
  MeasurementJobPayload,
  VisualizationJobPayload,
} from "@warp-survey/contracts";
import { prisma } from "./prisma";

/**
 * Resolve everything a pipeline run needs at submission time and put it on the
 * queue message. The Python worker never reads the application database for
 * inputs, so a replayed message reproduces exactly the same run.
 */

export class PayloadError extends Error {}

const IMAGE_KINDS = ["DRONE_JPEG"] as const;

function controlPointPayload(point: {
  label: string;
  role: string;
  easting: number;
  northing: number;
  elevation: number;
  observations: unknown;
}): JobControlPoint {
  const observations = Array.isArray(point.observations)
    ? (point.observations as { imageName?: unknown; x?: unknown; y?: unknown }[])
        .filter((o) => typeof o?.imageName === "string" && typeof o.x === "number" && typeof o.y === "number")
        .map((o) => ({ imageName: o.imageName as string, x: o.x as number, y: o.y as number }))
    : [];
  return {
    label: point.label,
    role: point.role as JobControlPoint["role"],
    easting: point.easting,
    northing: point.northing,
    elevation: point.elevation,
    observations: observations.length > 0 ? observations : null,
  };
}

async function surveyInputs(surveyId: string) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      site: { include: { acceptanceProfiles: { orderBy: { version: "desc" }, take: 1 } } },
      controlPoints: true,
      captureFiles: { where: { status: "UPLOADED" } },
    },
  });
  if (!survey) throw new PayloadError("Survey not found");

  const imageKeys = survey.captureFiles
    .filter((f) => (IMAGE_KINDS as readonly string[]).includes(f.kind))
    .map((f) => f.storageKey);
  if (imageKeys.length === 0) {
    throw new PayloadError(
      "This survey has no uploaded still imagery. The measurement branch requires original JPEG stills.",
    );
  }
  return { survey, imageKeys };
}

export async function buildMeasurementPayload(surveyId: string): Promise<MeasurementJobPayload> {
  const { survey, imageKeys } = await surveyInputs(surveyId);
  const profile = survey.site.acceptanceProfiles[0];

  return {
    imageKeys,
    crs: survey.site.horizontalCrs,
    verticalDatum: survey.site.verticalDatum,
    units: "metre",
    controlPoints: survey.controlPoints.map(controlPointPayload),
    // RTK/PPK positions arrive as a capture file; until that parser exists the
    // worker georeferences from ground control alone rather than guessing.
    cameraPositions: {},
    acceptanceProfile: profile
      ? parseAcceptanceCriteria(profile.id, profile.version, profile.criteria)
      : null,
  };
}

function parseAcceptanceCriteria(
  profileId: string,
  version: number,
  criteria: unknown,
): MeasurementJobPayload["acceptanceProfile"] {
  const c = criteria as Record<string, unknown> | null;
  if (!c || typeof c.maxVerticalRmseM !== "number" || typeof c.maxAbsVerticalBiasM !== "number") {
    // A malformed profile must not silently become "no criteria" — that would
    // turn a configured gate into an UNVERIFIED pass-through.
    throw new PayloadError(
      `Acceptance profile ${profileId} v${version} is missing maxVerticalRmseM/maxAbsVerticalBiasM. ` +
        "Fix the profile rather than processing without QA criteria.",
    );
  }
  return {
    profileId,
    version,
    minCheckpointCount: typeof c.minCheckpointCount === "number" ? c.minCheckpointCount : 0,
    maxHorizontalRmseM: typeof c.maxHorizontalRmseM === "number" ? c.maxHorizontalRmseM : null,
    maxVerticalRmseM: c.maxVerticalRmseM,
    maxAbsVerticalBiasM: c.maxAbsVerticalBiasM,
    minRegistrationRate: typeof c.minRegistrationRate === "number" ? c.minRegistrationRate : 0.8,
  };
}

export async function buildVisualizationPayload(surveyId: string): Promise<VisualizationJobPayload> {
  const { survey, imageKeys } = await surveyInputs(surveyId);

  // Visualization reuses the measurement run's reconstructed cameras: the two
  // branches must describe the same geometry, and re-solving would drift.
  const measurementRun = await prisma.processingRun.findFirst({
    where: { surveyId, kind: "MEASUREMENT", status: "SUCCEEDED" },
    orderBy: { finishedAt: "desc" },
    include: { stageAttempts: { where: { stage: "RECONSTRUCTION", status: "SUCCEEDED" } } },
  });
  const camerasArtifactKey = measurementRun?.stageAttempts
    .flatMap((a) => a.artifactKeys)
    .find((key) => key.endsWith("cameras_reconstructed.json"));
  if (!measurementRun || !camerasArtifactKey) {
    throw new PayloadError(
      "Visualization requires a completed measurement run for this survey: its reconstructed cameras " +
        "define the shared geometry. Process the measurement branch first.",
    );
  }

  const revision = await prisma.surveyRevision.findFirst({
    where: { surveyId, runId: measurementRun.id },
    orderBy: { publishedAt: "desc" },
  });
  const localOrigin = localOriginFromManifest(revision?.manifest);

  return { imageKeys: imageKeys, camerasArtifactKey, localOrigin };
}

function localOriginFromManifest(manifest: unknown): [number, number, number] {
  const spatial = (manifest as { spatial?: { localOrigin?: unknown } } | null)?.spatial;
  const origin = spatial?.localOrigin;
  if (Array.isArray(origin) && origin.length === 3 && origin.every((v) => typeof v === "number")) {
    return origin as [number, number, number];
  }
  throw new PayloadError(
    "The measurement revision has no local origin. The viewer frame must be derived from the " +
      "published engineering frame, never assumed to be zero.",
  );
}

function epochPayload(revision: {
  id: string;
  manifest: unknown;
  measurementQualityState: string;
  survey: { site: { horizontalCrs: string; verticalDatum: string } };
  artifacts: { kind: string; storageKey: string }[];
}): ComparisonEpochPayload {
  const quality = (revision.manifest as { measurementQuality?: { checkpoints?: { verticalRmseM?: unknown } } } | null)
    ?.measurementQuality;
  const verticalRmseM = typeof quality?.checkpoints?.verticalRmseM === "number"
    ? quality.checkpoints.verticalRmseM
    : null;

  const keyOf = (kind: string) => revision.artifacts.find((a) => a.kind === kind)?.storageKey ?? null;

  return {
    revisionId: revision.id,
    crs: revision.survey.site.horizontalCrs,
    verticalDatumId: revision.survey.site.verticalDatum,
    measurementState: revision.measurementQualityState as ComparisonEpochPayload["measurementState"],
    verticalRmseM,
    dsmKey: keyOf("DSM_COG"),
    cloudKey: keyOf("DENSE_POINT_CLOUD_LAZ"),
  };
}

export async function buildComparisonPayload(comparisonId: string): Promise<ComparisonJobPayload> {
  const comparison = await prisma.comparison.findUnique({
    where: { id: comparisonId },
    include: {
      baselineRevision: { include: { artifacts: true, survey: { include: { site: true } } } },
      candidateRevision: { include: { artifacts: true, survey: { include: { site: true } } } },
    },
  });
  if (!comparison) throw new PayloadError("Comparison not found");

  const method = comparison.method as ComparisonJobPayload["method"];
  const baseline = epochPayload(comparison.baselineRevision);
  const candidate = epochPayload(comparison.candidateRevision);

  const required = method === "M3C2" ? "cloudKey" : "dsmKey";
  const missing = [
    ["baseline", baseline],
    ["candidate", candidate],
  ].filter(([, epoch]) => !(epoch as ComparisonEpochPayload)[required]);
  if (missing.length > 0) {
    const product = method === "M3C2" ? "dense point cloud" : "surface model (DSM)";
    throw new PayloadError(
      `The ${missing.map(([name]) => name).join(" and ")} revision has no published ${product}, ` +
        `which ${method} requires.`,
    );
  }

  const aoi = comparison.areaOfInterest as Record<string, number> | null;
  const params = comparison.parameters as Record<string, number> | null;

  return {
    comparisonId: comparison.id,
    method,
    baseline,
    candidate,
    areaOfInterest: aoi
      ? [aoi.minEasting, aoi.minNorthing, aoi.maxEasting, aoi.maxNorthing]
      : null,
    m3c2Parameters:
      method === "M3C2"
        ? {
            normalRadiusM: params?.normalRadiusM ?? 2.0,
            projectionRadiusM: params?.projectionRadiusM ?? 1.0,
            maxDepthM: params?.maxDepthM ?? 10.0,
          }
        : null,
    // Stable-area pairs come from a reviewer-approved selection; none yet
    // means no registration correction is applied, which is the safe default.
    stablePointPairs: null,
    stableAreaDescription: null,
  };
}
