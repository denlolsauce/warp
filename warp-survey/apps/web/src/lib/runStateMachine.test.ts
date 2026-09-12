import { describe, expect, it } from "vitest";
import {
  canTransitionRun,
  canTransitionStage,
  isFresh,
  resumeStage,
} from "./runStateMachine";

describe("run transitions", () => {
  it("allows only forward transitions", () => {
    expect(canTransitionRun("QUEUED", "RUNNING")).toBe(true);
    expect(canTransitionRun("RUNNING", "SUCCEEDED")).toBe(true);
    expect(canTransitionRun("RUNNING", "FAILED")).toBe(true);
  });

  it("terminal states never transition", () => {
    expect(canTransitionRun("SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransitionRun("FAILED", "QUEUED")).toBe(false);
    expect(canTransitionStage("SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransitionStage("FAILED", "PENDING")).toBe(false);
  });
});

describe("resumeStage", () => {
  it("starts at the first stage with no attempts", () => {
    expect(resumeStage("MEASUREMENT", [])).toBe("INPUT_VALIDATION");
  });

  it("resumes at the first non-succeeded stage in fixed order", () => {
    const attempts = [
      { stage: "INPUT_VALIDATION", status: "SUCCEEDED", attempt: 1 },
      { stage: "RECONSTRUCTION", status: "FAILED", attempt: 1 },
    ] as const;
    expect(resumeStage("MEASUREMENT", [...attempts])).toBe("RECONSTRUCTION");
  });

  it("uses the latest attempt per stage", () => {
    const attempts = [
      { stage: "INPUT_VALIDATION", status: "SUCCEEDED", attempt: 1 },
      { stage: "RECONSTRUCTION", status: "FAILED", attempt: 1 },
      { stage: "RECONSTRUCTION", status: "SUCCEEDED", attempt: 2 },
    ] as const;
    expect(resumeStage("MEASUREMENT", [...attempts])).toBe("DENSE_PRODUCTS");
  });

  it("returns null when every stage succeeded", () => {
    const attempts = [
      "COMPATIBILITY_CHECKS",
      "REGISTRATION",
      "CHANGE_COMPUTATION",
      "PUBLISH_COMPARISON",
    ].map((stage) => ({ stage, status: "SUCCEEDED" as const, attempt: 1 }));
    expect(resumeStage("COMPARISON", attempts)).toBeNull();
  });
});

describe("fencing", () => {
  it("rejects stale tokens and accepts fresh ones", () => {
    expect(isFresh(2, 1)).toBe(true);
    expect(isFresh(1, 1)).toBe(true);
    expect(isFresh(1, 2)).toBe(false);
  });
});
