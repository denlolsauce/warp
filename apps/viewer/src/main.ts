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
}
