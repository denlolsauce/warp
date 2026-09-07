"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CAPTURE_CHECKLIST,
  MAX_FILE_SIZE_BYTES,
  MIN_DURATION_SEC,
  MULTIPART_PART_SIZE_BYTES,
} from "@/lib/videoConstraints";

type Phase =
  | { name: "idle" }
  | { name: "uploading"; percent: number }
  | { name: "creating" }
  | { name: "error"; message: string };

async function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    };
    video.src = URL.createObjectURL(file);
  });
}

async function apiJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function UploadFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    if (!picked.type.startsWith("video/")) {
      setPhase({ name: "error", message: "That doesn't look like a video file." });
      return;
    }
    if (picked.size > MAX_FILE_SIZE_BYTES) {
      setPhase({
        name: "error",
        message: `File is over the ${Math.round(MAX_FILE_SIZE_BYTES / 1024 ** 3)} GB limit.`,
      });
      return;
    }
    setPhase({ name: "idle" });
    setFile(picked);
    if (!name) setName(picked.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }

  async function start() {
    if (!file || !name.trim()) return;

    const durationSec = await readVideoDuration(file);
    if (durationSec !== null && durationSec < MIN_DURATION_SEC) {
      setPhase({
        name: "error",
        message: `Video is ${Math.round(durationSec)}s — captures need at least ${MIN_DURATION_SEC}s of footage to solve cameras reliably.`,
      });
      return;
    }

    try {
      // 1. Direct-to-R2 multipart upload via presigned part URLs — the video
      //    never passes through the app server.
      const { key, uploadId } = await apiJson<{ key: string; uploadId: string }>(
        "/api/uploads/initiate",
        { filename: file.name, contentType: file.type },
      );

      const partCount = Math.ceil(file.size / MULTIPART_PART_SIZE_BYTES);
      const parts: { partNumber: number; etag: string }[] = [];
      setPhase({ name: "uploading", percent: 0 });

      try {
        for (let i = 0; i < partCount; i++) {
          const partNumber = i + 1;
          const blob = file.slice(i * MULTIPART_PART_SIZE_BYTES, (i + 1) * MULTIPART_PART_SIZE_BYTES);
          const { url } = await apiJson<{ url: string }>("/api/uploads/part-url", {
            key,
            uploadId,
            partNumber,
          });
          const res = await fetch(url, { method: "PUT", body: blob });
          if (!res.ok) throw new Error(`Part ${partNumber} upload failed (${res.status})`);
          const etag = res.headers.get("ETag");
          if (!etag) throw new Error("Storage did not return an ETag — check bucket CORS ExposeHeaders.");
          parts.push({ partNumber, etag: etag.replaceAll('"', "") });
          setPhase({ name: "uploading", percent: Math.round((partNumber / partCount) * 100) });
        }
        await apiJson("/api/uploads/complete", { key, uploadId, parts });
      } catch (error) {
        await apiJson("/api/uploads/abort", { key, uploadId }).catch(() => {});
        throw error;
      }

      // 2. Create the product + job around the uploaded key and enqueue it.
      setPhase({ name: "creating" });
      const { productId } = await apiJson<{ productId: string }>("/api/products", {
        name: name.trim(),
        videoKey: key,
        durationSec,
      });
      router.push(`/studio/products/${productId}`);
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Upload failed." });
    }
  }

  const busy = phase.name === "uploading" || phase.name === "creating";

  return (
    <div className="max-w-[560px]">
      {/* Capture checklist — shown before the file picker per CLAUDE.md. */}
      <div className="rounded-xl border border-studio-line bg-studio-card p-5 shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
        <div className="text-[13.5px] font-semibold text-studio-heading">Before you shoot</div>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {CAPTURE_CHECKLIST.map((item) => (
            <li key={item} className="flex gap-2.5 text-[13px] leading-snug text-studio-body">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-[2px] h-3.5 w-3.5 shrink-0 text-studio-green">
                <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files[0]);
        }}
        onClick={() => !busy && fileInputRef.current?.click()}
        className={`mt-4 flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-studio-brand bg-[rgba(226,73,47,0.04)]"
            : "border-studio-line-2 bg-studio-well hover:border-studio-line-3"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-studio-line bg-studio-card text-studio-muted shadow-[0_1px_2px_rgba(28,26,23,0.05)]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4.5 w-4.5">
            <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {file ? (
          <>
            <div className="mt-3 text-[13.5px] font-medium text-studio-heading">{file.name}</div>
            <div className="mt-0.5 font-mono text-[11.5px] text-studio-muted">
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 text-[13.5px] font-medium text-studio-heading">
              Drop your product video here
            </div>
            <div className="mt-0.5 text-[12.5px] text-studio-muted">
              2–4 minutes, MP4 or MOV, up to 2 GB — or click to browse
            </div>
          </>
        )}
      </div>

      {/* Name + submit */}
      <div className="mt-4 flex gap-2.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Capture name — e.g. Ribbed vase"
          disabled={busy}
          className="h-[38px] flex-1 rounded-[9px] border border-studio-line-2 bg-studio-card px-3.5 text-[13.5px] text-studio-heading placeholder:text-studio-faint"
        />
        <button
          type="button"
          onClick={start}
          disabled={!file || !name.trim() || busy}
          className="h-[38px] whitespace-nowrap rounded-[9px] bg-studio-dark px-4 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(28,26,23,0.25)] hover:bg-studio-dark-hi disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase.name === "uploading"
            ? `Uploading ${phase.percent}%`
            : phase.name === "creating"
              ? "Starting job…"
              : "Upload & process"}
        </button>
      </div>

      {phase.name === "uploading" && (
        <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-studio-line">
          <div
            className="h-full rounded-full bg-studio-brand transition-[width] duration-300"
            style={{ width: `${phase.percent}%` }}
          />
        </div>
      )}

      {phase.name === "error" && (
        <div className="mt-3 rounded-[9px] border border-[rgba(179,64,42,0.25)] bg-studio-red-bg px-3.5 py-2.5 text-[13px] leading-snug text-studio-red">
          {phase.message}
        </div>
      )}
    </div>
  );
}
