import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  survey: { findUnique: vi.fn() },
  processingRun: { findFirst: vi.fn() },
  surveyRevision: { findFirst: vi.fn() },
  comparison: { findUnique: vi.fn() },
}));

vi.mock("./prisma", () => ({ prisma: db }));

const {
  PayloadError,
  buildComparisonPayload,
  buildMeasurementPayload,
  buildVisualizationPayload,
} = await import("./jobPayloads");

const site = { horizontalCrs: "EPSG:25832", verticalDatum: "EPSG:7837", acceptanceProfiles: [] as unknown[] };

function surveyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv_1",
    site: { ...site },
    controlPoints: [],
    captureFiles: [
      { kind: "DRONE_JPEG", storageKey: "surveys/srv_1/capture/a.jpg" },
      { kind: "DRONE_JPEG", storageKey: "surveys/srv_1/capture/b.jpg" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildMeasurementPayload", () => {
  it("resolves the imagery, reference system, and control points the worker needs", async () => {
    db.survey.findUnique.mockResolvedValue(
      surveyRow({
        controlPoints: [
          {
            label: "GCP01",
            role: "GCP",
            easting: 604000,
            northing: 5793000,
            elevation: 210,
            observations: [{ imageName: "a.jpg", x: 1024, y: 768 }],
          },
          {
            label: "CP01",
            role: "CHECKPOINT",
            easting: 604050,
            northing: 5793050,
            elevation: 211,
            observations: null,
          },
        ],
      }),
    );

    const payload = await buildMeasurementPayload("srv_1");

    expect(payload.imageKeys).toEqual([
      "surveys/srv_1/capture/a.jpg",
      "surveys/srv_1/capture/b.jpg",
    ]);
    expect(payload.crs).toBe("EPSG:25832");
    expect(payload.verticalDatum).toBe("EPSG:7837");
    expect(payload.controlPoints).toHaveLength(2);
    expect(payload.controlPoints[0].observations).toEqual([{ imageName: "a.jpg", x: 1024, y: 768 }]);
    // Checkpoints stay independent: no observations are passed to optimization.
    expect(payload.controlPoints[1].observations).toBeNull();
  });

  it("refuses a survey with no uploaded stills", async () => {
    db.survey.findUnique.mockResolvedValue(surveyRow({ captureFiles: [] }));
    await expect(buildMeasurementPayload("srv_1")).rejects.toBeInstanceOf(PayloadError);
  });

  it("carries the site's acceptance profile so QA has criteria", async () => {
    db.survey.findUnique.mockResolvedValue(
      surveyRow({
        site: {
          ...site,
          acceptanceProfiles: [
            {
              id: "prof_1",
              version: 2,
              criteria: { maxVerticalRmseM: 0.05, maxAbsVerticalBiasM: 0.02, minCheckpointCount: 5 },
            },
          ],
        },
      }),
    );

    const payload = await buildMeasurementPayload("srv_1");
    expect(payload.acceptanceProfile).toMatchObject({
      profileId: "prof_1",
      version: 2,
      maxVerticalRmseM: 0.05,
      minCheckpointCount: 5,
    });
  });

  it("fails loudly on a malformed acceptance profile instead of dropping the gate", async () => {
    db.survey.findUnique.mockResolvedValue(
      surveyRow({
        site: { ...site, acceptanceProfiles: [{ id: "prof_1", version: 1, criteria: { note: "todo" } }] },
      }),
    );
    await expect(buildMeasurementPayload("srv_1")).rejects.toThrow(/maxVerticalRmseM/);
  });
});

describe("buildVisualizationPayload", () => {
  it("reuses the measurement run's reconstructed cameras and published origin", async () => {
    db.survey.findUnique.mockResolvedValue(surveyRow());
    db.processingRun.findFirst.mockResolvedValue({
      id: "run_m",
      stageAttempts: [{ artifactKeys: ["runs/run_m/RECONSTRUCTION/cameras_reconstructed.json"] }],
    });
    db.surveyRevision.findFirst.mockResolvedValue({
      manifest: { spatial: { localOrigin: [604000.5, 5793000.25, 210] } },
    });

    const payload = await buildVisualizationPayload("srv_1");
    expect(payload.camerasArtifactKey).toBe("runs/run_m/RECONSTRUCTION/cameras_reconstructed.json");
    expect(payload.localOrigin).toEqual([604000.5, 5793000.25, 210]);
  });

  it("refuses to run before the measurement branch has produced cameras", async () => {
    db.survey.findUnique.mockResolvedValue(surveyRow());
    db.processingRun.findFirst.mockResolvedValue(null);
    await expect(buildVisualizationPayload("srv_1")).rejects.toThrow(/measurement run/);
  });

  it("refuses to assume a zero local origin", async () => {
    db.survey.findUnique.mockResolvedValue(surveyRow());
    db.processingRun.findFirst.mockResolvedValue({
      id: "run_m",
      stageAttempts: [{ artifactKeys: ["runs/run_m/RECONSTRUCTION/cameras_reconstructed.json"] }],
    });
    db.surveyRevision.findFirst.mockResolvedValue({ manifest: {} });
    await expect(buildVisualizationPayload("srv_1")).rejects.toThrow(/local origin/);
  });
});

describe("buildComparisonPayload", () => {
  function revision(id: string, artifacts: { kind: string; storageKey: string }[], rmse: number | null = 0.03) {
    return {
      id,
      manifest: { measurementQuality: { checkpoints: { verticalRmseM: rmse } } },
      measurementQualityState: "PASS",
      survey: { site: { horizontalCrs: "EPSG:25832", verticalDatum: "EPSG:7837" } },
      artifacts,
    };
  }

  it("resolves both epochs' surfaces and uncertainties", async () => {
    db.comparison.findUnique.mockResolvedValue({
      id: "cmp_1",
      siteId: "site_1",
      method: "ELEVATION_DIFFERENCING",
      areaOfInterest: null,
      parameters: null,
      baselineRevision: revision("rev_1", [{ kind: "DSM_COG", storageKey: "a/dsm.tif" }]),
      candidateRevision: revision("rev_2", [{ kind: "DSM_COG", storageKey: "b/dsm.tif" }], 0.04),
    });

    const payload = await buildComparisonPayload("cmp_1");
    expect(payload.baseline.dsmKey).toBe("a/dsm.tif");
    expect(payload.candidate.dsmKey).toBe("b/dsm.tif");
    // Both uncertainties are needed for a detection threshold.
    expect(payload.baseline.verticalRmseM).toBe(0.03);
    expect(payload.candidate.verticalRmseM).toBe(0.04);
    expect(payload.stablePointPairs).toBeNull();
  });

  it("requires point clouds for M3C2", async () => {
    db.comparison.findUnique.mockResolvedValue({
      id: "cmp_1",
      siteId: "site_1",
      method: "M3C2",
      areaOfInterest: null,
      parameters: null,
      baselineRevision: revision("rev_1", [{ kind: "DSM_COG", storageKey: "a/dsm.tif" }]),
      candidateRevision: revision("rev_2", [{ kind: "DSM_COG", storageKey: "b/dsm.tif" }]),
    });
    await expect(buildComparisonPayload("cmp_1")).rejects.toThrow(/dense point cloud/);
  });

  it("passes an area of interest through as engineering-frame bounds", async () => {
    db.comparison.findUnique.mockResolvedValue({
      id: "cmp_1",
      siteId: "site_1",
      method: "ELEVATION_DIFFERENCING",
      areaOfInterest: { minEasting: 1, minNorthing: 2, maxEasting: 3, maxNorthing: 4 },
      parameters: null,
      baselineRevision: revision("rev_1", [{ kind: "DSM_COG", storageKey: "a/dsm.tif" }]),
      candidateRevision: revision("rev_2", [{ kind: "DSM_COG", storageKey: "b/dsm.tif" }]),
    });
    const payload = await buildComparisonPayload("cmp_1");
    expect(payload.areaOfInterest).toEqual([1, 2, 3, 4]);
  });
});
