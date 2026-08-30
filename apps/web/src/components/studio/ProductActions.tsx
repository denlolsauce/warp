"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProductActions({
  productId,
  canRegenerate,
  hasPly,
  hasSog,
}: {
  productId: string;
  canRegenerate: boolean;
  hasPly: boolean;
  hasSog: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"regenerate" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy("regenerate");
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/regenerate`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start a new job.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a new job.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this capture and all its assets? This can't be undone.")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      router.push("/studio");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setBusy(null);
    }
  }

  const secondaryButton =
    "flex h-[32px] items-center gap-1.5 rounded-lg border border-studio-line-2 bg-studio-card px-3 text-[12.5px] font-medium text-studio-body shadow-[0_1px_2px_rgba(28,26,23,0.04)] hover:border-studio-line-3 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {hasSog && (
          <a href={`/api/products/${productId}/download?kind=SOG`} className={secondaryButton}>
            Download SOG
          </a>
        )}
        {hasPly && (
          <a href={`/api/products/${productId}/download?kind=PLY`} className={secondaryButton}>
            Download PLY
          </a>
        )}
        <button type="button" onClick={regenerate} disabled={!canRegenerate || busy !== null} className={secondaryButton}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.7h-2.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy === "regenerate" ? "Starting…" : "Regenerate"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="flex h-[32px] items-center rounded-lg border border-[rgba(179,64,42,0.3)] bg-studio-card px-3 text-[12.5px] font-medium text-studio-red hover:bg-studio-red-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error && <div className="text-[12px] text-studio-red">{error}</div>}
    </div>
  );
}
