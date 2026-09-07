"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { SerializedJob } from "./jobSerialization";

// Mirrors STAGE_ORDER in lib/jobStateMachine.ts (server-only import chain).
const STAGES: { key: string; label: string }[] = [
  { key: "INGEST", label: "Ingest" },
  { key: "FRAME_EXTRACTION", label: "Frames" },
  { key: "POSE_ESTIMATION", label: "Camera solve" },
  { key: "TRAINING", label: "Training" },
  { key: "CLEANUP", label: "Cleanup" },
  { key: "COMPRESSION", label: "Compression" },
  { key: "PUBLISH", label: "Publish" },
];

const POLL_INTERVAL_MS = 5000;

type StageState = "done" | "running" | "failed" | "pending";

function stageState(job: SerializedJob, stageKey: string): StageState {
  // Latest attempt wins — stage rows are append-only.
  const runs = job.stages.filter((s) => s.stage === stageKey);
  const latest = runs.sort((a, b) => b.attempt - a.attempt)[0];
  if (!latest) return "pending";
  if (latest.status === "SUCCEEDED") return "done";
  if (latest.status === "FAILED") return "failed";
  if (latest.status === "RUNNING") return "running";
  return "pending";
}

/**
 * Per-stage progress for a job, polled while the job is live. `compact`
 * renders the thin bar used inside grid cards; the full variant is the
 * stage-by-stage list on the detail page.
 */
export function JobProgress({
  productId,
  initialJob,
  compact = false,
}: {
  productId: string;
  initialJob: SerializedJob;
  compact?: boolean;
}) {
  const [job, setJob] = useState(initialJob);
  const router = useRouter();
  const live = job.status === "QUEUED" || job.status === "RUNNING";

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job: SerializedJob | null; status: string };
        if (data.job) {
          setJob(data.job);
          // Terminal transition: refresh the server-rendered parts too
          // (status badge, viewer, assets) rather than duplicating them here.
          if (data.job.status === "SUCCEEDED" || data.job.status === "FAILED") {
            router.refresh();
          }
        }
      } catch {
        // Transient poll failure — the next tick retries.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, productId, router]);

  const doneCount = STAGES.filter((s) => stageState(job, s.key) === "done").length;
  const runningStage = STAGES.find((s) => stageState(job, s.key) === "running");
  const failedStage = STAGES.find((s) => stageState(job, s.key) === "failed");

  if (compact) {
    return (
      <div>
        <div className="flex items-center justify-between text-[11px] font-medium">
          <span className={failedStage ? "text-studio-red" : "text-studio-muted"}>
            {failedStage
              ? `Failed at ${failedStage.label.toLowerCase()}`
              : runningStage
                ? runningStage.label
                : job.status === "QUEUED"
                  ? "Queued"
                  : "Working"}
          </span>
          <span className="font-mono text-[10px] text-studio-faint">
            {doneCount}/{STAGES.length}
          </span>
        </div>
        <div className="mt-1.5 flex gap-[3px]">
          {STAGES.map((s) => {
            const state = stageState(job, s.key);
            return (
              <span
                key={s.key}
                className={`h-[4px] flex-1 rounded-full ${
                  state === "done"
                    ? "bg-studio-green"
                    : state === "running"
                      ? "animate-pulse bg-studio-amber"
                      : state === "failed"
                        ? "bg-studio-red"
                        : "bg-studio-line-2"
                }`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {STAGES.map((s, i) => {
        const state = stageState(job, s.key);
        return (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[10px] font-semibold ${
                  state === "done"
                    ? "border-studio-green bg-studio-green text-white"
                    : state === "running"
                      ? "border-studio-amber bg-studio-amber-bg text-studio-amber"
                      : state === "failed"
                        ? "border-studio-red bg-studio-red text-white"
                        : "border-studio-line-2 bg-studio-card text-studio-faint"
                }`}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                    <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : state === "failed" ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                    <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {i < STAGES.length - 1 && (
                <span
                  className={`w-px flex-1 ${state === "done" ? "bg-studio-green" : "bg-studio-line-2"}`}
                />
              )}
            </div>
            <div className="pb-4 pt-0.5">
              <div
                className={`text-[13px] font-medium ${
                  state === "pending" ? "text-studio-faint" : "text-studio-heading"
                }`}
              >
                {s.label}
                {state === "running" && (
                  <span className="ml-2 rounded-full bg-studio-amber-bg px-2 py-[1px] text-[11px] font-medium text-studio-amber">
                    running
                  </span>
                )}
              </div>
              {state === "failed" && job.errorMessage && (
                <div className="mt-1 max-w-[440px] text-[12.5px] leading-snug text-studio-red">
                  {job.errorMessage}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
