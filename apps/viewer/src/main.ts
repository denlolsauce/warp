import { PortalViewer } from "./viewer";

declare global {
  interface Window {
    PortalViewer: {
      load(manifestUrl: string): Promise<void>;
      destroy(): void;
    };
  }
}

const canvas = document.getElementById("application-canvas") as HTMLCanvasElement;
const viewer = new PortalViewer(canvas);

window.PortalViewer = {
  load: (manifestUrl: string) => viewer.load(manifestUrl),
  destroy: () => viewer.destroy(),
};

const manifestUrl = new URLSearchParams(window.location.search).get("manifest");
if (manifestUrl) {
  void window.PortalViewer.load(manifestUrl).catch((error: unknown) => {
    console.error("[portal-viewer] failed to load manifest from URL", error);
  });
} else {
  // Without a ?manifest= param there's nothing to load and nothing else in
  // this file ever runs — previously just a permanently blank canvas with
  // no explanation, which reads as "broken" rather than "missing a URL
  // parameter" (confirmed the hard way).
  const notice = document.createElement("div");
  notice.textContent = "No tour specified — open this page with ?manifest=<url-to-manifest.json>";
  notice.setAttribute(
    "style",
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      "padding:24px;text-align:center;color:#e8e8ea;font:14px system-ui,sans-serif;" +
      "background:#0a0a0c;",
  );
  (canvas.parentElement ?? document.body).appendChild(notice);
}
