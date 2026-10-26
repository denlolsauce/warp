"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { api, type WorkspaceProject } from "./types";
export function ShareDialog({ project, onClose, onChange }: { project: WorkspaceProject; onClose: () => void; onChange: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState(project.shareToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sample = project.id === "sample-house";
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/share/${token}` : "";
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function toggle(enabled: boolean) {
    setBusy(true); setMessage("");
    try {
      const result = await api<{ shareToken?: string | null; project?: WorkspaceProject; shareUrl?: string | null }>(`/api/projects/${project.id}/share`, { method: "POST", body: JSON.stringify({ enabled }) });
      setToken(enabled ? result.shareToken || result.project?.shareToken || result.shareUrl?.split("/").pop() || null : null); onChange();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not update sharing."); } finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url); setMessage("Link copied. Ready to share with your team."); } catch { setMessage("Select and copy the link above."); } }
  return <dialog ref={dialog} className="suite-dialog share-dialog" onCancel={onClose}>
    <div className="dialog-heading"><span className="dialog-icon"><Icon name="link"/></span><button className="icon-button" aria-label="Close sharing" onClick={onClose}><Icon name="close"/></button></div>
    <h2>A shared point of view.</h2><p className="muted">Send {project.name} to your engineers, clients or site team. No account or software required to view.</p>
    <div className="share-access"><Icon name={token ? "globe" : "lock"}/><div><strong>{token ? "Anyone with the link" : "Only your workspace"}</strong><p>{token ? "Read-only access to the 3D model" : "Create a link when you’re ready to share"}</p></div><span className={`status ${token ? "ready" : ""}`}>{token ? "Link active" : "Private"}</span></div>
    {token ? <><div className="copy-field"><input aria-label="Share link" readOnly value={url} onFocus={(e) => e.target.select()}/><button className="button primary" onClick={copy}><Icon name="copy" size={16}/> Copy link</button></div><a className="text-link" href={`/share/${token}`} target="_blank" rel="noreferrer">Open public viewer <Icon name="arrow" size={15}/></a></> : <button className="button primary" disabled={busy || project.status !== "READY"} onClick={() => toggle(true)}>Create share link <Icon name="link" size={16}/></button>}
    {message && <p role="status" className="share-message">{message}</p>}
    <div className="dialog-footer"><span>{sample ? "Public example · no private project data" : "Revoke the page link at any time."}</span>{token && !sample && <button className="button danger" disabled={busy} onClick={() => toggle(false)}>Revoke link</button>}</div>
  </dialog>;
}
