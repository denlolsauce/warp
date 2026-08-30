"use client";

import { useEffect, useRef, useState } from "react";

import { EMBED_SNIPPET } from "@/lib/marketing/content";

export function EmbedPanel() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(EMBED_SNIPPET);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission); the
      // snippet is on screen either way, so there is nothing to recover from.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="overflow-hidden rounded-[13px] border border-warp-line-2 bg-warp-panel">
      <div className="flex h-[42px] items-center gap-3 border-b border-warp-line px-[15px] font-mono text-xs text-warp-meta">
        product-page.html
        <span className="flex-1" />
        <button
          type="button"
          onClick={copy}
          className="font-mono text-xs text-warp-accent hover:text-warp-accent-hi"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-5 py-[22px] font-mono text-[13px] leading-[2] text-warp-strong">
        <span className="text-warp-faint">{"<!-- once, in your head -->"}</span>
        {"\n<script "}
        <span className="text-warp-amber">src</span>
        {"="}
        <span className="text-warp-accent">{'"https://cdn.warp3d.io/v1.js"'}</span>
        {"></script>\n\n"}
        <span className="text-warp-faint">{"<!-- anywhere on the page -->"}</span>
        {"\n<warp-viewer "}
        <span className="text-warp-amber">model</span>
        {"="}
        <span className="text-warp-accent">{'"ribbed-vase"'}</span>
        {"></warp-viewer>"}
      </pre>
    </div>
  );
}
