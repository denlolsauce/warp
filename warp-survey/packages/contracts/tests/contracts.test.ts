import { describe, expect, it } from "vitest";
import {
  processingJobMessage,
  publicationUpdate,
  stageStatusUpdate,
  stagesForKind,
  surveyManifest,
  comparisonManifest,
  SIGN_CONVENTION,
  crsId,
} from "../src";

describe("processingJobMessage", () => {
  const measurementPayload = {
    imageKeys: ["surveys/srv_1/capture/a.jpg"],
    crs: "EPSG:25832",
    verticalDatum: "EPSG:7837",
    units: "metre",
    controlPoints: [
      {
        label: "GCP01",
        role: "GCP",
        easting: 604000,
        northing: 5793000,
        elevation: 210,
        observations: [{ imageName: "a.jpg", x: 1024, y: 768 }],
      },
    ],
    cameraPositions: {},
    acceptanceProfile: null,
  };
  const valid = {
    messageVersion: 1,
    runId: "run_1",
    kind: "MEASUREMENT",
    surveyId: "srv_1",
    organizationId: "org_1",
    comparisonId: null,
    idempotencyKey: "idem-1",
    enqueuedAt: "2026-09-08T12:00:00.000Z",
    payload: measurementPayload,
  };

  it("accepts a valid message", () => {
    expect(processingJobMessage.parse(valid).kind).toBe("MEASUREMENT");
  });

  it("rejects unknown kinds and missing idempotency keys", () => {
    expect(processingJobMessage.safeParse({ ...valid, kind: "TRAIN" }).success).toBe(false);
    expect(processingJobMessage.safeParse({ ...valid, idempotencyKey: "" }).success).toBe(false);
  });

  it("carries the stage inputs the worker needs", () => {
    // The worker never queries the app database for inputs, so a message
    // without them could never execute.
    expect(processingJobMessage.safeParse({ ...valid, payload: { ...measurementPayload, imageKeys: [] } }).success).toBe(
      false,
    );
  });

  it("allows a null surveyId only alongside a comparison payload", () => {
    const comparisonEpoch = {
      revisionId: "rev_1",
      crs: "EPSG:25832",
      verticalDatumId: "EPSG:7837",
      measurementState: "PASS",
      verticalRmseM: 0.03,
      dsmKey: "sites/site_1/rev_1/dsm.tif",
      cloudKey: null,
    };
    const comparison = {
      ...valid,
      kind: "COMPARISON",
      surveyId: null,
      comparisonId: "cmp_1",
      payload: {
        comparisonId: "cmp_1",
        method: "ELEVATION_DIFFERENCING",
        baseline: comparisonEpoch,
        candidate: { ...comparisonEpoch, revisionId: "rev_2" },
        areaOfInterest: null,
        m3c2Parameters: null,
        stablePointPairs: null,
        stableAreaDescription: null,
      },
    };
    expect(processingJobMessage.parse(comparison).surveyId).toBeNull();
  });
});

describe("publicationUpdate", () => {
  const base = {
    messageVersion: 1,
    runId: "run_1",
    fencingToken: 4,
    branch: "COMPARISON",
    artifacts: [
      {
        kind: "CHANGE_RASTER_COG",
        storageKey: "runs/run_1/change.tif",
        checksumSha256: "b".repeat(64),
        sizeBytes: 2048,
        contentType: "image/tiff",
        spatialMetadata: null,
      },
    ],
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
    provenance: { backend: "odm" },
  };

  it("accepts a comparison publication", () => {
    expect(publicationUpdate.parse(base).comparison?.comparisonId).toBe("cmp_1");
  });

  it("pins the sign convention and requires a fencing token", () => {
    expect(
      publicationUpdate.safeParse({ ...base, comparison: { ...base.comparison, signConvention: "up is down" } })
        .success,
    ).toBe(false);
    expect(publicationUpdate.safeParse({ ...base, fencingToken: 0 }).success).toBe(false);
  });

  it("rejects artifacts without a real checksum", () => {
    expect(
      publicationUpdate.safeParse({
        ...base,
        artifacts: [{ ...base.artifacts[0], checksumSha256: "unknown" }],
      }).success,
    ).toBe(false);
  });
});

describe("stageStatusUpdate", () => {
  it("requires a positive fencing token", () => {
    const base = {
      messageVersion: 1,
      runId: "run_1",
      stage: "RECONSTRUCTION",
      attempt: 1,
      status: "SUCCEEDED",
      fencingToken: 3,
      errorMessage: null,
      transient: null,
      metrics: { registeredImages: 412 },
      artifactKeys: ["runs/run_1/reconstruction.zip"],
      timingSeconds: 812.5,
    };
    expect(stageStatusUpdate.parse(base).fencingToken).toBe(3);
    expect(stageStatusUpdate.safeParse({ ...base, fencingToken: 0 }).success).toBe(false);
  });
});

describe("stagesForKind", () => {
  it("keeps measurement and visualization stages disjoint", () => {
    const m = new Set(stagesForKind("MEASUREMENT"));
    for (const s of stagesForKind("VISUALIZATION")) expect(m.has(s)).toBe(false);
  });
});

describe("crsId", () => {
  it("accepts EPSG codes only", () => {
    expect(crsId.safeParse("EPSG:25832").success).toBe(true);
    expect(crsId.safeParse("WGS84").success).toBe(false);
  });
});

describe("surveyManifest", () => {
  it("enforces checksums and quality states", () => {
    const manifest = {
      manifestVersion: 1,
      surveyId: "srv_1",
      revisionId: "rev_1",
      siteId: "site_1",
      capturedAt: "2026-09-01T09:00:00.000Z",
      spatial: {
        horizontalCrs: "EPSG:25832",
        verticalDatum: { id: "EPSG:7837" },
        unit: "metre",
        localOrigin: [604000.5, 5793000.25, 210.0],
        transforms: [],
      },
      bounds: { min: [603900, 5792900, 200], max: [604100, 5793100, 260] },
      artifacts: [
        {
          artifactId: "art_1",
          kind: "DSM_COG",
          storageKey: "sites/site_1/rev_1/dsm.tif",
          checksumSha256: "a".repeat(64),
          sizeBytes: 1024,
          contentType: "image/tiff",
        },
      ],
      measurementQuality: {
        state: "UNVERIFIED",
        checkpoints: null,
        groundSamplingDistanceM: 0.021,
        registeredImages: 410,
        totalImages: 420,
        acceptanceProfileId: null,
        acceptanceProfileVersion: null,
        findings: ["No independent checkpoints supplied; survey remains UNVERIFIED."],
      },
      visualizationQuality: { state: "PASS", gaussianCount: 2_400_000, findings: [] },
      provenance: {
        pipelineVersion: "0.1.0",
        backendName: "opendronemap",
        backendVersion: "3.5.4",
        containerDigest: null,
        configHash: "deadbeef",
        packageVersions: { pdal: "2.7.1" },
      },
      viewer: null,
    };
    expect(surveyManifest.parse(manifest).measurementQuality.state).toBe("UNVERIFIED");
    expect(
      surveyManifest.safeParse({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], checksumSha256: "not-hex" }],
      }).success,
    ).toBe(false);
  });
});

describe("comparisonManifest", () => {
  it("pins the sign convention literal", () => {
    const parsed = comparisonManifest.parse({
      manifestVersion: 1,
      comparisonId: "cmp_1",
      siteId: "site_1",
      baselineRevisionId: "rev_1",
      candidateRevisionId: "rev_2",
      method: "ELEVATION_DIFFERENCING",
      areaOfInterest: null,
      registrationCorrection: null,
      signConvention: SIGN_CONVENTION,
      result: null,
      exploratory: true,
      artifacts: [],
      maskArtifactIds: [],
    });
    expect(parsed.exploratory).toBe(true);
    expect(
      comparisonManifest.safeParse({ ...parsed, signConvention: "up is down" }).success,
    ).toBe(false);
  });
});
