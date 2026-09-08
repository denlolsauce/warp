import * as pc from "playcanvas";
import type { SurveyManifest } from "@warp-survey/contracts";
import { fetchManifest } from "./manifest-loader";
import { LoadingOverlay } from "./loading-overlay";
import { CameraController } from "./camera-controller";
import { InfoPanel } from "./info-panel";
import type { LoadedSplat } from "./types";

export class SurveyViewer {
  private canvas: HTMLCanvasElement;
  private app: pc.AppBase | null = null;
  private overlay: LoadingOverlay | null = null;
  private controller: CameraController | null = null;
  private infoPanel: InfoPanel | null = null;
  private splats: LoadedSplat[] = [];
  private loadToken = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async load(manifestUrl: string): Promise<void> {
    this.destroy();
    const token = ++this.loadToken;

    const parent = this.canvas.parentElement ?? document.body;
    const overlay = new LoadingOverlay(parent);
    this.overlay = overlay;

    try {
      overlay.setStatus("Fetching survey manifest…");
      const manifest = await fetchManifest(manifestUrl);
      if (token !== this.loadToken) return;

      overlay.setStatus("Checking WebGL2 support…");
      const webgl2 = this.checkWebGL2Support();
      if (!webgl2) {
        throw new Error("WebGL2 is required for this viewer. Please update your browser.");
      }
      if (token !== this.loadToken) return;

      overlay.setStatus("Initializing viewer…");
      const app = new pc.AppBase(this.canvas);
      this.app = app;

      app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);

      this.setupCamera(app);
      this.setupController(app, manifest);
      this.setupInfoPanel(manifest);

      app.start();

      overlay.setStatus("Loading splat visualization…");
      if (manifest.viewer?.chunks && manifest.viewer.chunks.length > 0) {
        const chunks = manifest.viewer.chunks;
        for (let i = 0; i < chunks.length; i++) {
          if (token !== this.loadToken) return;
          const chunk = chunks[i];
          const progress = (i / chunks.length) * 0.9 + 0.1;
          overlay.setProgress(progress);
          await this.loadSplat(app, chunk.id, chunk.storageKey, overlay);
        }
      }

      if (token !== this.loadToken) return;
      overlay.hide();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[survey-viewer] load failed", error);
      overlay.showError(message);
      throw error;
    }
  }

  private checkWebGL2Support(): boolean {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl !== null;
  }

  private setupCamera(app: pc.AppBase): void {
    const camera = new pc.Entity("camera");
    camera.addComponent("camera" as any, {
      nearClip: 0.1,
      farClip: 2000,
      fov: 60,
    } as any);

    camera.setLocalPosition(100, 50, 100);
    camera.lookAt(0, 0, 0);
    (app.root as pc.Entity).addChild(camera);

    const light = new pc.Entity("light");
    light.addComponent("light" as any, {
      type: "directional",
      color: new pc.Color(1, 1, 1),
      intensity: 2,
      castShadows: false,
    } as any);
    light.setLocalEulerAngles(45, 45, 0);
    (app.root as pc.Entity).addChild(light);
  }

  private setupController(app: pc.AppBase, manifest: SurveyManifest): void {
    const camera = (app.root as pc.Entity).findByName("camera") as pc.Entity | null;
    if (!camera) {
      throw new Error("Camera not found");
    }
    this.controller = new CameraController(camera, manifest);

    const frameHandler = () => {
      if (this.app && this.controller) {
        this.controller.update();
      }
    };
    app.on("update", frameHandler);
  }

  private setupInfoPanel(manifest: SurveyManifest): void {
    const parent = this.canvas.parentElement ?? document.body;
    this.infoPanel = new InfoPanel(parent, manifest);
  }

  private loadSplat(app: pc.AppBase, name: string, storageKey: string, overlay: LoadingOverlay): Promise<void> {
    return new Promise((resolve, reject) => {
      const asset = new pc.Asset(name, "gsplat", { url: storageKey });
      let bytesLoaded = 0;

      asset.on("progress", (received: number, total: number) => {
        bytesLoaded = received;
        if (total > 0) {
          overlay.setProgress(0.1 + (received / total) * 0.8);
        }
      });

      asset.once("load", () => {
        const entity = new pc.Entity(name);
        entity.addComponent("gsplat" as any, { asset } as any);
        (app.root as pc.Entity).addChild(entity);
        this.splats.push({ entity, asset, bytes: bytesLoaded });
        resolve();
      });

      asset.once("error", (err: string) => {
        reject(new Error(`Failed to load splat '${name}': ${err}`));
      });

      app.assets.add(asset);
      app.assets.load(asset);
    });
  }

  destroy(): void {
    this.loadToken += 1;

    this.controller?.destroy();
    this.controller = null;

    this.infoPanel?.destroy();
    this.infoPanel = null;

    for (const { entity } of this.splats) {
      entity.destroy();
    }
    this.splats = [];

    this.app?.destroy();
    this.app = null;

    this.overlay?.destroy();
    this.overlay = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
