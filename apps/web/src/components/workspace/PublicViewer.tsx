"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SceneViewer } from "./SceneViewer";
import { Icon } from "./Icon";
import { DEMO_PROJECT, type WorkspaceProject } from "./types";
import "./workspace.css";
export function PublicViewer({ token }: { token: string }) {
  const [project, setProject] = useState<WorkspaceProject | null>(token === "demo" ? DEMO_PROJECT : null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"orbit" | "top">("orbit");
  const [reset, setReset] = useState(0);
  useEffect(() => {
    if (token === "demo") return;
    const controller = new AbortController();
    fetch(`/api/shares/${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "This link has been revoked, is unavailable, or the model is not ready." : "The model could not be loaded. Please try again.");
      setProject(body.project);
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [token]);
  return <div className="suite share-viewer-page"><header className="share-topbar"><Link href="/" className="brand"><span className="brand-mark"><Icon name="cube" size={21}/></span><span>warp<span className="brand-dot">.</span></span></Link><div className="share-title"><strong>{project?.name || "Shared 3D model"}</strong><small>{project?.location || "A new perspective, shared with you"}</small></div><span className="share-view-only"><Icon name="lock" size={13}/>View only</span></header>
    {error ? <div className="public-error" role="alert"><Icon name="link" size={35}/><h1>This view isn’t available.</h1><p>{error}</p><Link className="button secondary" href="/">Explore WARP</Link></div> : project?.sogUrl ? <><SceneViewer src={project.sogUrl} label={`Shared interactive 3D model: ${project.name}`} view={view} resetKey={reset} className="public-scene"/><div className="public-controls"><button className={view === "orbit" ? "selected" : ""} onClick={() => setView("orbit")}><Icon name="cube" size={14}/>Orbit</button><button className={view === "top" ? "selected" : ""} onClick={() => setView("top")}><Icon name="layers" size={14}/>Top view</button><button onClick={() => { setReset(reset + 1); setView("orbit"); }}><Icon name="reset" size={14}/>Reset view</button></div></> : <div className="public-error"><Icon name="cube" size={35}/><h1>{project ? "Model unavailable" : "Opening a new perspective…"}</h1>{project && <p>The model asset is not available. Ask the owner to check object storage.</p>}</div>}
    <footer className="public-footer"><span><Icon name="cube" size={13}/>Photorealistic perspective. Uncalibrated geometry.</span><span>Drag to orbit · Scroll to zoom · Shift + drag to pan</span><Link href="/">Made with warp. ↗</Link></footer></div>;
}
