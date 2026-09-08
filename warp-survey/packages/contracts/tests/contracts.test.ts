import { describe, expect, it } from "vitest";
import {
  processingJobMessage,
  stageStatusUpdate,
  stagesForKind,
  surveyManifest,
  comparisonManifest,
  SIGN_CONVENTION,
  crsId,
} from "../src";

describe("processingJobMessage", () => {
  const valid = {
    messageVersion: 1,
    runId: "run_1",
    kind: "MEASUREMENT",
    surveyId: "srv_1",
    organizationId: "org_1",
    comparisonId: null,
    idempotencyKey: "idem-1",
    enqueuedAt: "2026-09-08T12:00:00.000Z",
  };

  it("accepts a valid message", () => {
    expect(processingJobMessage.parse(valid).kind).toBe("MEASUREMENT");
  });

  it("rejects unknown kinds and missing idempotency keys", () => {
    expect(processingJobMessage.safeParse({ ...valid, kind: "TRAIN" }).success).toBe(false);
    expect(processingJobMessage.safeParse({ ...valid, idempotencyKey: "" }).success).toBe(false);
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
