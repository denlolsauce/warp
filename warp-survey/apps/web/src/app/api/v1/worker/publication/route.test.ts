import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_CONVENTION } from "@warp-survey/contracts";

const WORKER_SECRET = "test-worker-secret";

const tx = vi.hoisted(() => ({
  processingRun: { findUnique: vi.fn(), updateMany: vi.fn() },
  surveyRevision: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  artifact: { createMany: vi.fn() },
  survey: { update: vi.fn() },
  comparison: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}));

const { POST } = await import("./route");

function post(body: unknown, secret: string | null = WORKER_SECRET) {
  return new Request("http://localhost/api/v1/worker/publication", {
    method: "POST",
    headers: secret === null ? {} : { "x-worker-secret": secret },
    body: JSON.stringify(body),
  });
}

const artifact = {
  kind: "DSM_COG",
  storageKey: "runs/run_1/dsm.tif",
  checksumSha256: "a".repeat(64),
  sizeBytes: 4096,
  contentType: "image/tiff",
  spatialMetadata: null,
};

const measurementQuality = {
  state: "PASS",
  checkpoints: null,
  groundSamplingDistanceM: 0.02,
  registeredImages: 410,
  totalImages: 420,
  acceptanceProfileId: "prof_1",
  acceptanceProfileVersion: 2,
  findings: [],
};

const spatial = {
  horizontalCrs: "EPSG:25832",
  verticalDatum: { id: "EPSG:7837" },
  unit: "metre",
  localOrigin: [604000, 5793000, 0],
  transforms: [],
};

function measurementUpdate(overrides: Record<string, unknown> = {}) {
  return {
    messageVersion: 1,
    runId: "run_1",
    fencingToken: 3,
    branch: "MEASUREMENT",
    artifacts: [artifact],
    measurementQuality,
    visualizationQuality: null,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    spatial,
    comparison: null,
    provenance: { backend: "odm" },
    ...overrides,
  };
}

function comparisonUpdate(overrides: Record<string, unknown> = {}) {
  return {
    messageVersion: 1,
    runId: "run_1",
    fencingToken: 3,
    branch: "COMPARISON",
    artifacts: [{ ...artifact, kind: "CHANGE_RASTER_COG" }],
    measurementQuality: null,
    visualizationQuality: null,
    bounds: null,
    spatial: null,
    comparison: {
      comparisonId: "cmp_1",
      method: "ELEVATION_DIFFERENCING",
      signConvention: SIGN_CONVENTION,
      result: { method: "ELEVATION_DIFFERENCING", netVolumeM3: -1200 },
      exploratory: false,
      registrationCorrection: null,
      findings: [],
    },
    provenance: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.WORKER_CALLBACK_SECRET = WORKER_SECRET;
  tx.processingRun.updateMany.mockResolvedValue({ count: 1 });
  tx.surveyRevision.findUnique.mockResolvedValue(null);
  tx.surveyRevision.create.mockResolvedValue({ id: "rev_1" });
  tx.artifact.createMany.mockResolvedValue({ count: 1 });
  tx.survey.update.mockResolvedValue({});
});

describe("worker publication auth", () => {
  it("rejects a missing or wrong secret", async () => {
    expect((await POST(post(measurementUpdate(), null))).status).toBe(401);
    expect((await POST(post(measurementUpdate(), "wrong-secret-value!!"))).status).toBe(401);
    expect(tx.processingRun.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a malformed publication", async () => {
    const response = await POST(post({ messageVersion: 1, runId: "run_1" }));
    expect(response.status).toBe(400);
  });
});

describe("measurement publication", () => {
  it("creates the revision, artifacts, and marks the survey processed", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "MEASUREMENT",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 2,
    });

    const response = await POST(post(measurementUpdate()));
    expect(response.status).toBe(200);

    expect(tx.surveyRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ surveyId: "srv_1", runId: "run_1", measurementQualityState: "PASS" }),
      }),
    );
    // The published manifest must carry the local origin the visualization
    // branch reads back.
    const manifest = tx.surveyRevision.create.mock.calls[0][0].data.manifest;
    expect(manifest.spatial.localOrigin).toEqual([604000, 5793000, 0]);
    expect(tx.artifact.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.survey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PROCESSED" } }),
    );
  });

  it("reuses the run's existing revision on a replayed publication", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "MEASUREMENT",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 3,
    });
    tx.surveyRevision.findUnique.mockResolvedValue({ id: "rev_1", manifest: { manifestVersion: 1 } });
    tx.surveyRevision.update.mockResolvedValue({ id: "rev_1" });

    expect((await POST(post(measurementUpdate()))).status).toBe(200);
    expect(tx.surveyRevision.create).not.toHaveBeenCalled();
    expect(tx.surveyRevision.update).toHaveBeenCalled();
  });

  it("advances the run fence so an older worker becomes stale", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "MEASUREMENT",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 1,
    });
    await POST(post(measurementUpdate({ fencingToken: 5 })));
    expect(tx.processingRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run_1", fencingToken: { lte: 5 } },
      data: { fencingToken: 5 },
    });
  });

  it("rejects a stale fencing token with 409", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "MEASUREMENT",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 9,
    });
    const response = await POST(post(measurementUpdate({ fencingToken: 3 })));
    expect(response.status).toBe(409);
    expect(tx.surveyRevision.create).not.toHaveBeenCalled();
  });

  it("rejects a publication whose branch is not the run's kind", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "VISUALIZATION",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 1,
    });
    const response = await POST(post(measurementUpdate()));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("cannot publish") });
    expect(tx.surveyRevision.create).not.toHaveBeenCalled();
  });
});

describe("comparison publication", () => {
  it("writes the manifest for the run's own comparison", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "COMPARISON",
      surveyId: null,
      comparisonId: "cmp_1",
      fencingToken: 1,
    });
    tx.comparison.findUnique.mockResolvedValue({
      id: "cmp_1",
      siteId: "site_1",
      baselineRevisionId: "rev_1",
      candidateRevisionId: "rev_2",
      areaOfInterest: null,
    });
    tx.comparison.update.mockResolvedValue({});

    expect((await POST(post(comparisonUpdate()))).status).toBe(200);
    const manifest = tx.comparison.update.mock.calls[0][0].data.manifest;
    expect(manifest.signConvention).toBe(SIGN_CONVENTION);
    expect(manifest.exploratory).toBe(false);
  });

  it("refuses to write a comparison the run does not own", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "COMPARISON",
      surveyId: null,
      comparisonId: "cmp_other",
      fencingToken: 1,
    });
    const response = await POST(post(comparisonUpdate()));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("does not belong to this run"),
    });
    expect(tx.comparison.update).not.toHaveBeenCalled();
  });

  it("refuses a comparison result smuggled into a survey publication", async () => {
    tx.processingRun.findUnique.mockResolvedValue({
      id: "run_1",
      kind: "MEASUREMENT",
      surveyId: "srv_1",
      comparisonId: null,
      fencingToken: 1,
    });
    const response = await POST(
      post(measurementUpdate({ comparison: comparisonUpdate().comparison })),
    );
    expect(response.status).toBe(500);
    expect(tx.surveyRevision.create).not.toHaveBeenCalled();
  });
});
