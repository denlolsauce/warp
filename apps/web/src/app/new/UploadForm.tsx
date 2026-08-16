"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADDITIONAL_AREA_CREDIT_COST,
  CAPTURE_CHECKLIST,
  MAX_DURATION_SEC,
  MAX_FILE_SIZE_BYTES,
  MIN_DURATION_SEC,
  MULTIPART_PART_SIZE_BYTES,
  MULTI_ROOM_GUIDANCE,
  TOUR_CREDIT_COST,
} from "@/lib/videoConstraints";

interface VideoValidation {
  valid: boolean;
  error?: string;
  durationSec?: number;
}

function validateVideoFile(file: File): Promise<VideoValidation> {
  return new Promise((resolve) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      resolve({ valid: false, error: `File is ${(file.size / 1e9).toFixed(2)} GB — must be under 2 GB.` });
      return;
    }

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const { videoWidth, videoHeight, duration } = video;
      URL.revokeObjectURL(video.src);

      if (videoWidth >= videoHeight) {
        resolve({ valid: false, error: "Video must be portrait orientation (taller than wide)." });
        return;
      }
      if (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC) {
        resolve({
          valid: false,
          error: `Duration must be between ${MIN_DURATION_SEC}s and ${MAX_DURATION_SEC / 60}min — this video is ${Math.round(duration)}s.`,
        });
        return;
      }
      resolve({ valid: true, durationSec: duration });
    };
    video.onerror = () => resolve({ valid: false, error: "Could not read this video file." });
    video.src = URL.createObjectURL(file);
  });
}

async function uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<string> {
  const initiateRes = await fetch("/api/uploads/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
  });
  if (!initiateRes.ok) throw new Error("Failed to start upload.");
  const { key, uploadId } = (await initiateRes.json()) as { key: string; uploadId: string };

  const totalParts = Math.max(1, Math.ceil(file.size / MULTIPART_PART_SIZE_BYTES));
  const parts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * MULTIPART_PART_SIZE_BYTES;
    const end = Math.min(start + MULTIPART_PART_SIZE_BYTES, file.size);
    const chunk = file.slice(start, end);

    const urlRes = await fetch("/api/uploads/part-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumber }),
    });
    if (!urlRes.ok) throw new Error(`Failed to get an upload URL for part ${partNumber}.`);
    const { url } = (await urlRes.json()) as { url: string };

    const putRes = await fetch(url, { method: "PUT", body: chunk });
    if (!putRes.ok) throw new Error(`Failed to upload part ${partNumber}.`);
    const etag = putRes.headers.get("ETag");
    if (!etag) {
      throw new Error(
        "Upload succeeded but the R2 bucket didn't return an ETag header — its CORS policy needs " +
          "'ETag' added to ExposeHeaders for browser uploads to complete.",
      );
    }
    parts.push({ partNumber, etag });

    uploadedBytes += chunk.size;
    onProgress(uploadedBytes / file.size);
  }

  const completeRes = await fetch("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
  });
  if (!completeRes.ok) throw new Error("Failed to finalize the upload.");

  return key;
}

interface VideoSlot {
  file: File | null;
  durationSec: number | null;
  validationError: string | null;
  slotPhase: "empty" | "validating" | "ready";
}

interface AreaSlot extends VideoSlot {
  id: string;
  name: string;
  floor: string;
}

function emptyVideoSlot(): VideoSlot {
  return { file: null, durationSec: null, validationError: null, slotPhase: "empty" };
}

function emptyAreaSlot(): AreaSlot {
  return { ...emptyVideoSlot(), id: crypto.randomUUID(), name: "", floor: "" };
}

type FormPhase = "idle" | "uploading" | "creating" | "error";

export function UploadForm({ userCredits }: { userCredits: number }) {
  const router = useRouter();
  const [tourName, setTourName] = useState("");
  const [overview, setOverview] = useState<VideoSlot>(emptyVideoSlot);
  const [areas, setAreas] = useState<AreaSlot[]>(() => [emptyAreaSlot()]);
  const [checked, setChecked] = useState<boolean[]>(() => CAPTURE_CHECKLIST.map(() => false));
  const [formPhase, setFormPhase] = useState<FormPhase>("idle");
  const [uploadStatus, setUploadStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = formPhase === "uploading" || formPhase === "creating";

  async function handleOverviewFileChange(selected: File | null) {
    if (!selected) {
      setOverview(emptyVideoSlot());
      return;
    }
    setOverview({ file: null, durationSec: null, validationError: null, slotPhase: "validating" });
    const result = await validateVideoFile(selected);
    setOverview(
      result.valid
        ? { file: selected, durationSec: result.durationSec ?? null, validationError: null, slotPhase: "ready" }
        : { file: null, durationSec: null, validationError: result.error ?? "This video isn't usable.", slotPhase: "empty" },
    );
  }

  async function handleAreaFileChange(id: string, selected: File | null) {
    if (!selected) {
      setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, ...emptyVideoSlot() } : a)));
      return;
    }
    setAreas((prev) =>
      prev.map((a) => (a.id === id ? { ...a, file: null, durationSec: null, validationError: null, slotPhase: "validating" } : a)),
    );
    const result = await validateVideoFile(selected);
    setAreas((prev) =>
      prev.map((a) =>
        a.id === id
          ? result.valid
            ? { ...a, file: selected, durationSec: result.durationSec ?? null, validationError: null, slotPhase: "ready" }
            : { ...a, file: null, durationSec: null, validationError: result.error ?? "This video isn't usable.", slotPhase: "empty" }
          : a,
      ),
    );
  }

  function updateAreaField(id: string, field: "name" | "floor", value: string) {
    setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  }

  function addArea() {
    setAreas((prev) => [...prev, emptyAreaSlot()]);
  }

  function removeArea(id: string) {
    setAreas((prev) => prev.filter((a) => a.id !== id));
  }

  const trimmedNames = areas.map((a) => a.name.trim().toLowerCase()).filter((n) => n.length > 0);
  const namesUnique = new Set(trimmedNames).size === trimmedNames.length;
  const allAreasNamed = areas.every((a) => a.name.trim().length > 0);
  const allAreasReady = areas.length > 0 && areas.every((a) => a.slotPhase === "ready");
  const overviewReady = overview.slotPhase === "ready";
  const allChecked = checked.every(Boolean);

  const creditCost = TOUR_CREDIT_COST + areas.length * ADDITIONAL_AREA_CREDIT_COST;
  const hasEnoughCredits = userCredits >= creditCost;

  const canSubmit =
    formPhase === "idle" &&
    tourName.trim().length > 0 &&
    overviewReady &&
    allAreasReady &&
    allAreasNamed &&
    namesUnique &&
    allChecked &&
    hasEnoughCredits;

  async function handleSubmit() {
    if (!overview.file) return;
    setError(null);

    const allVideos = [
      {
        role: "OVERVIEW" as const,
        file: overview.file,
        durationSec: overview.durationSec,
        areaName: undefined as string | undefined,
        floor: undefined as string | undefined,
      },
      ...areas.map((a) => ({
        role: "AREA" as const,
        file: a.file as File,
        durationSec: a.durationSec,
        areaName: a.name.trim(),
        floor: a.floor.trim() || undefined,
      })),
    ];
    const totalBytes = allVideos.reduce((sum, v) => sum + v.file.size, 0);
    let uploadedBytesSoFar = 0;

    try {
      setFormPhase("uploading");
      setProgress(0);

      const uploadedVideos: {
        role: "OVERVIEW" | "AREA";
        areaName?: string;
        floor?: string;
        storageKey: string;
        durationSec: number | null;
      }[] = [];

      for (const v of allVideos) {
        setUploadStatus(`Uploading ${v.role === "OVERVIEW" ? "overview" : v.areaName}…`);
        const fileSize = v.file.size;
        const storageKey = await uploadVideo(v.file, (fraction) => {
          setProgress((uploadedBytesSoFar + fraction * fileSize) / totalBytes);
        });
        uploadedBytesSoFar += fileSize;
        setProgress(uploadedBytesSoFar / totalBytes);
        uploadedVideos.push({ role: v.role, areaName: v.areaName, floor: v.floor, storageKey, durationSec: v.durationSec });
      }

      setFormPhase("creating");
      setUploadStatus("");
      const tourRes = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tourName, videos: uploadedVideos }),
      });
      if (!tourRes.ok) {
        const body = (await tourRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "insufficient credits" ? "Not enough credits." : (body.error ?? "Failed to create tour."),
        );
      }
      const { tourId } = (await tourRes.json()) as { tourId: string };

      router.push(`/tours/${tourId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
      setFormPhase("error");
    }
  }

  return (
    <div>
      {!hasEnoughCredits && (
        <p role="alert">
          You have {userCredits} credits — this tour ({areas.length} area{areas.length === 1 ? "" : "s"}) costs{" "}
          {creditCost}. Not enough to continue.
        </p>
      )}

      <section>
        <h2>Multi-room capture guide</h2>
        <ul>
          {MULTI_ROOM_GUIDANCE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Capture checklist</h2>
        <p>Confirm each item before filming (applies to every video):</p>
        <ul>
          {CAPTURE_CHECKLIST.map((item, index) => (
            <li key={item}>
              <label>
                <input
                  type="checkbox"
                  checked={checked[index]}
                  disabled={busy}
                  onChange={(event) =>
                    setChecked((prev) => prev.map((value, i) => (i === index ? event.target.checked : value)))
                  }
                />
                {item}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Tour name</h2>
        <input
          type="text"
          value={tourName}
          disabled={busy}
          onChange={(event) => setTourName(event.target.value)}
          placeholder="e.g. 12 Maple Street"
        />
      </section>

      <section>
        <h2>Overview video</h2>
        <p>Whole property, natural walking flow, ~8-10s per room, finish where you started.</p>
        <input
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(event) => void handleOverviewFileChange(event.target.files?.[0] ?? null)}
        />
        <p>
          Portrait orientation, {MIN_DURATION_SEC}s&ndash;{MAX_DURATION_SEC / 60}min, under 2 GB.
        </p>
        {overview.slotPhase === "validating" && <p>Checking video…</p>}
        {overview.validationError && <p role="alert">{overview.validationError}</p>}
        {overview.file && overview.durationSec && (
          <p>
            {overview.file.name} — {Math.round(overview.durationSec)}s, {(overview.file.size / 1e6).toFixed(0)} MB
          </p>
        )}
      </section>

      <section>
        <h2>Area videos</h2>
        {!namesUnique && <p role="alert">Area names must be unique.</p>}
        {areas.map((area, index) => (
          <fieldset key={area.id}>
            <legend>Area {index + 1}</legend>

            <label>
              Name
              <input
                type="text"
                value={area.name}
                disabled={busy}
                onChange={(event) => updateAreaField(area.id, "name", event.target.value)}
                placeholder="e.g. Kitchen"
              />
            </label>

            <label>
              Floor
              <input
                type="text"
                value={area.floor}
                disabled={busy}
                onChange={(event) => updateAreaField(area.id, "floor", event.target.value)}
                placeholder="e.g. Ground"
              />
            </label>

            <input
              type="file"
              accept="video/*"
              disabled={busy}
              onChange={(event) => void handleAreaFileChange(area.id, event.target.files?.[0] ?? null)}
            />
            {area.slotPhase === "validating" && <p>Checking video…</p>}
            {area.validationError && <p role="alert">{area.validationError}</p>}
            {area.file && area.durationSec && (
              <p>
                {area.file.name} — {Math.round(area.durationSec)}s, {(area.file.size / 1e6).toFixed(0)} MB
              </p>
            )}

            <button type="button" disabled={busy || areas.length === 1} onClick={() => removeArea(area.id)}>
              Remove area
            </button>
          </fieldset>
        ))}
        <button type="button" disabled={busy} onClick={addArea}>
          Add another area
        </button>
      </section>

      {formPhase === "uploading" && (
        <p>
          {uploadStatus} {Math.round(progress * 100)}%
        </p>
      )}
      {formPhase === "creating" && <p>Creating tour…</p>}
      {error && <p role="alert">{error}</p>}

      <button type="button" disabled={!canSubmit || busy} onClick={() => void handleSubmit()}>
        {busy ? "Working…" : `Start processing (${creditCost} credits)`}
      </button>
    </div>
  );
}
