"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { MAX_FILE_SIZE_BYTES, MIN_DURATION_SEC, MULTIPART_PART_SIZE_BYTES } from "@/lib/videoConstraints";
import { api, fileSize } from "./types";

const GUIDANCE = [
  "Fly slow, overlapping orbits at two or more heights.",
  "Include oblique views, not only a top-down flight.",
  "Use a sharp video of at least 60 seconds, up to 4K / 60 fps.",
  "Keep exposure consistent. Avoid moving vehicles and people.",
];
function videoInfo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => { URL.revokeObjectURL(url); video.removeAttribute("src"); video.load(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Could not read this video. Try an MP4 or MOV capture.")); }, 15000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const info = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      clearTimeout(timer); cleanup(); resolve(info);
    };
    video.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error("This video cannot be read by your browser. Try an H.264 MP4.")); };
    video.src = url;
  });
}
function putPart(url: string, data: Blob, signal: AbortSignal, onProgress: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return; }
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error("Storage rejected the upload. Check bucket CORS and expose the ETag response header."));
    };
    xhr.onerror = () => reject(new Error("Could not reach object storage. Check your connection and storage CORS configuration."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.send(data);
  });
}
export function UploadDialog({ onClose, onCreated, demo }: { onClose: () => void; onCreated: (id: string) => void; demo: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [checks, setChecks] = useState<boolean[]>(GUIDANCE.map(() => false));
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => controller.current?.abort(); }, []);
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > MAX_FILE_SIZE_BYTES) { setError("This workspace accepts videos up to 2 GB. Export a smaller 4K or 1080p capture."); return; }
    if (demo) { setError("You’re exploring the sample workspace. Sign in or open a local workspace in Settings to upload your own capture."); return; }
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setPhase("Checking video…");
    let active: { key: string; uploadId: string } | null = null;
    try {
      const info = await videoInfo(file);
      if (!Number.isFinite(info.duration) || info.duration < MIN_DURATION_SEC) throw new Error("Your capture must be at least 60 seconds long. Longer, overlapping orbits help reconstruct the whole site.");
      if (info.width > 3840 && info.height > 2160 || Math.max(info.width, info.height) > 4096) throw new Error("Please export your capture at 4K or below.");
      if (abort.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      setPhase("Uploading directly to storage…");
      active = await api("/api/uploads/initiate", { method: "POST", body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", sizeBytes: file.size }), signal: abort.signal });
      const partSize = MULTIPART_PART_SIZE_BYTES;
      const parts: { partNumber: number; etag: string }[] = [];
      for (let start = 0, partNumber = 1; start < file.size; start += partSize, partNumber++) {
        const { url } = await api<{ url: string }>("/api/uploads/part-url", { method: "POST", body: JSON.stringify({ ...active, partNumber }), signal: abort.signal });
        const etag = await putPart(url, file.slice(start, start + partSize), abort.signal, (bytes) => setProgress(Math.round((start + bytes) / file.size * 100)));
        parts.push({ partNumber, etag });
      }
      setPhase("Securing your capture…");
      await api("/api/uploads/complete", { method: "POST", body: JSON.stringify({ ...active, parts }), signal: abort.signal });
      const result = await api<{ project: { id: string } }>("/api/projects", { method: "POST", body: JSON.stringify({ name: name.trim(), location: location.trim(), description: "", ...active }), signal: abort.signal });
      active = null; onCreated(result.project.id);
    } catch (e) {
      if (active) await api("/api/uploads/abort", { method: "POST", body: JSON.stringify(active) }).catch(() => {});
      setError(e instanceof Error && e.name === "AbortError" ? "Upload cancelled. No processing job was started." : e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally { setBusy(false); controller.current = null; }
  }
  return <dialog className="suite-dialog capture-dialog" ref={dialog} onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }}>
    <div className="dialog-heading"><span className="eyebrow">A NEW PERSPECTIVE</span><button className="icon-button" aria-label="Close upload" onClick={onClose} disabled={busy}><Icon name="close"/></button></div>
    <h2>Bring your site into 3D.</h2><p className="muted">One drone video. A scene your whole team can explore.</p>
    <form onSubmit={upload}>
      <div className="capture-checklist"><strong>Before you upload</strong>{GUIDANCE.map((text, i) => <label key={text}><input type="checkbox" checked={checks[i]} disabled={busy} onChange={(e) => setChecks(checks.map((value, j) => j === i ? e.target.checked : value))}/><span>{text}</span></label>)}</div>
      <label className={`dropzone ${checks.every(Boolean) ? "enabled" : ""}`}><Icon name="upload" size={28}/><strong>{file ? file.name : "Choose your drone footage"}</strong><span>{file ? fileSize(file.size) : "MP4, MOV or WebM · up to 2 GB · direct to storage"}</span><input aria-label="Drone video" type="file" accept="video/mp4,video/quicktime,video/webm,.mov" disabled={!checks.every(Boolean) || busy} onChange={(e) => { const next = e.target.files?.[0]; if (next) { setFile(next); if (!name) setName(next.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ")); } }}/></label>
      <div className="form-row"><label>Project name<input required maxLength={120} placeholder="e.g. North quay — October survey" value={name} disabled={busy} onChange={(e) => setName(e.target.value)}/></label><label>Site / location <span className="muted">(optional)</span><input maxLength={200} placeholder="e.g. Dublin, Ireland" value={location} disabled={busy} onChange={(e) => setLocation(e.target.value)}/></label></div>
      {busy && <div className="upload-progress" role="status"><div><span>{phase}</span><span>{progress}%</span></div><progress max={100} value={progress}/></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-footer"><span><Icon name="lock" size={14}/> Private until you share it</span>{busy ? <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>Cancel upload</button> : <button type="submit" className="button primary" disabled={!file || !name.trim() || !checks.every(Boolean)}>Upload & create model <Icon name="arrow" size={17}/></button>}</div>
    </form>
  </dialog>;
}
