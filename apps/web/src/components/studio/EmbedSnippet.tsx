"use client";

import { useEffect, useRef, useState } from "react";

export function EmbedSnippet({ productId }: { productId: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const snippet = [
    '<script src="https://cdn.warp3d.io/v1.js"></script>',
    `<warp-viewer model="${productId}"></warp-viewer>`,
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard?.writeText(snippet);
    } catch {
      // Clipboard can be blocked; the snippet is on screen either way.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-studio-line bg-studio-card shadow-[0_1px_2px_rgba(28,26,23,0.04)]">
      <div className="flex items-center justify-between border-b border-studio-line px-4 py-2.5">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-studio-faint">
          Embed
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-studio-line-2 bg-studio-well px-2.5 py-1 font-mono text-[11px] text-studio-body hover:border-studio-line-3"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-4 py-3.5 font-mono text-[11.5px] leading-[1.8] text-studio-body">
        {snippet}
      </pre>
    </div>
  );
}
