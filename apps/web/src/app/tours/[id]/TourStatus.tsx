"use client";

import { useEffect, useState } from "react";
import type { TourStatusPayload } from "@/lib/tourStatus";

const STAGE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  UPLOADED: "Queued",
  EXTRACTING: "Extracting frames",
  SFM: "Reconstructing the scene",
  TRAINING: "Training the splat",
  COMPRESSING: "Compressing",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

const POLL_INTERVAL_MS = 5000;

export function TourStatus({ tourId, initial }: { tourId: string; initial: TourStatusPayload }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    if (data.status === "PUBLISHED" || data.status === "FAILED") return;

    const interval = setInterval(() => {
      fetch(`/api/tours/${tourId}/status`)
        .then((res) => (res.ok ? (res.json() as Promise<TourStatusPayload>) : null))
        .then((next) => next && setData(next))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [data.status, tourId]);

  if (data.status === "FAILED") {
    return (
      <main>
        <h1>{data.name}</h1>
        <p role="alert">Processing failed{data.errorMessage ? `: ${data.errorMessage}` : "."}</p>
      </main>
    );
  }

  if (data.status !== "PUBLISHED") {
    return (
      <main>
        <h1>{data.name}</h1>
        <p>{STAGE_LABELS[data.status] ?? data.status}</p>
      </main>
    );
  }

  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/tours/${tourId}`;
  const viewerUrl = `${process.env.NEXT_PUBLIC_VIEWER_URL}/?manifest=${encodeURIComponent(data.manifestUrl ?? "")}`;
  const embedSnippet = `<iframe src="${viewerUrl}" width="100%" height="600" style="border:0" allow="xr-spatial-tracking"></iframe>`;

  return (
    <main>
      <h1>{data.name}</h1>

      <section>
        <h2>Share URL</h2>
        <code>{shareUrl}</code>
      </section>

      <section>
        <h2>Embed</h2>
        <pre>{embedSnippet}</pre>
      </section>

      <section>
        <h2>Preview</h2>
        <iframe
          src={viewerUrl}
          width="100%"
          height={600}
          style={{ border: 0 }}
          allow="xr-spatial-tracking"
          title={data.name}
        />
      </section>
    </main>
  );
}
