"use client";
import { useState } from "react";

export function UploadPanel({ surveyId }: { surveyId: string }) {
  const [message, setMessage] = useState("");
  async function upload(file: File) {
    setMessage("Preparing direct upload…");
    try {
      const kind = file.type.includes("video") ? (file.name.toLowerCase().endsWith(".mov") ? "VIDEO_MOV" : "VIDEO_MP4") : "DRONE_JPEG";
      const init = await fetch("/api/v1/uploads/initiate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surveyId, kind, filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }) }).then((r) => r.json());
      if (!init.uploadId) throw new Error(init.error ?? "Could not initiate upload");
      const parts: { partNumber: number; etag: string }[] = [];
      for (let offset = 0, partNumber = 1; offset < file.size; offset += init.partSizeBytes, partNumber++) {
        const signed = await fetch("/api/v1/uploads/part-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureFileId: init.captureFileId, uploadId: init.uploadId, partNumber }) }).then((r) => r.json());
        const response = await fetch(signed.url, { method: "PUT", body: file.slice(offset, offset + init.partSizeBytes) });
        const etag = response.headers.get("etag"); if (!response.ok || !etag) throw new Error("A file part could not be uploaded");
        parts.push({ partNumber, etag }); setMessage(`Uploading ${Math.min(100, Math.round(((offset + init.partSizeBytes) / file.size) * 100))}%`);
      }
      await fetch("/api/v1/uploads/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureFileId: init.captureFileId, uploadId: init.uploadId, parts }) }); setMessage("Upload complete. Inputs remain editable until processing starts.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
  }
  return <section className="rounded border border-dashed border-survey-line-strong bg-survey-card p-5"><h2 className="font-medium text-survey-heading">Capture files</h2><p className="mt-1 text-sm text-survey-muted">Files upload directly to private storage; Warp never proxies capture data.</p><label className="mt-4 inline-block cursor-pointer rounded border border-survey-slate px-3 py-2 text-sm font-medium text-survey-slate hover:bg-slate-50">Choose file<input className="sr-only" type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>{message && <p className="mt-3 text-sm text-survey-body" role="status">{message}</p>}</section>;
}
