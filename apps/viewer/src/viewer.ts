import * as pc from "playcanvas";
import type { SceneManifest } from "@portal/schema";
import { fetchManifest } from "./manifest";
import { createDevice } from "./device";
import { applyMeasuredGaussianBudget } from "./budget";
import { LoadingOverlay } from "./loading";
import { PortalCameraController } from "./cameraController";
import { DebugOverlay } from "./debugOverlay";
import type { Point2 } from "./navigation";
import { isMobileViewport } from "./virtualJoystick";
import { AreaVisibility } from "./areaVisibility";

interface LoadedSplat {
  entity: pc.Entity;
  asset: pc.Asset;
  bytes: number;
}

// Yaw such that the camera actually faces from a toward b. PlayCanvas's
// real forward vector at Euler yaw is (-sin(yaw), 0, -cos(yaw)) (verified
// via getWorldTransform — see cameraController.ts), so matching a facing
// direction (dx, dz) needs atan2(-dx, -dz), not atan2(dx, dz).
function yawBetween(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.atan2(-dx, -dz) * (180 / Math.PI);
}

export class PortalViewer {
  private readonly canvas: HTMLCanvasElement;
  private app: pc.AppBase | null = null;
  private overlay: LoadingOverlay | null = null;
  private splats: LoadedSplat[] = [];
  private loadToken = 0;
  private controller: PortalCameraController | null = null;
  private debugOverlay: DebugOverlay | null = null;
  private areaVisibility: AreaVisibility | null = null;
  private cameraEntity: pc.Entity | null = null;
  private controlsHint: HTMLElement | null = null;
  private fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async load(manifestUrl: string): Promise<void> {
    this.destroy();
    const token = ++this.loadToken;

    const overlay = new LoadingOverlay(this.canvas.parentElement ?? document.body);
    this.overlay = overlay;

    try {
      overlay.setStatus("Fetching manifest…");
      const manifest = await fetchManifest(manifestUrl);
      if (token !== this.loadToken) return; // superseded by a newer load()/destroy()

      overlay.setStatus("Starting renderer…");
      const device = await createDevice(this.canvas);
      if (token !== this.loadToken) return;

      const app = new pc.Application(this.canvas, { graphicsDevice: device });
      this.app = app;

      app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
      window.addEventListener("resize", this.handleResize);

      this.setupCamera(app);
      this.setupController(app, manifest);
      app.start();

      let budgetMeasured = false;

      if (manifest.overview) {
        overlay.setStatus("Loading overview…");
        await this.loadSplat(app, "overview", manifest.overview.common, overlay);

        // Measure against a scene that's actually rendering something, not an
        // empty canvas, so the budget reflects real gaussian-splat render cost.
        void applyMeasuredGaussianBudget(app);
        budgetMeasured = true;

        const chunkEntries = Object.entries(manifest.overview.chunks);
        if (chunkEntries.length > 0) {
          overlay.setStatus(`Loading ${chunkEntries.length} overview chunk(s)…`);
          await Promise.all(
            chunkEntries.map(([chunkName, url]) =>
              this.loadSplat(app, `overview-chunk-${chunkName}`, url, overlay),
            ),
          );
        }
      }

      if (manifest.areas.length > 0) {
        overlay.setStatus(`Loading ${manifest.areas.length} area(s)…`);
        await Promise.all(
          manifest.areas.map((area) => this.loadSplat(app, area.id, area.splatUrl, overlay)),
        );
      }

      if (!budgetMeasured) {
        void applyMeasuredGaussianBudget(app);
      }

      this.areaVisibility = new AreaVisibility(manifest, (name) => this.findSplatEntity(name));

      if (token !== this.loadToken) return;
      overlay.hide();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[portal-viewer] load failed", error);
      overlay.showError(message);
      throw error;
    }
  }

  destroy(): void {
    this.loadToken += 1;
    window.removeEventListener("resize", this.handleResize);

    this.controller?.destroy();
    this.controller = null;
    this.debugOverlay?.destroy();
    this.debugOverlay = null;
    this.areaVisibility = null;
    this.cameraEntity = null;
    this.controlsHint?.remove();
    this.controlsHint = null;

    for (const { entity } of this.splats) {
      entity.destroy();
    }
    this.splats = [];

    this.app?.destroy();
    this.app = null;

    this.overlay?.destroy();
    this.overlay = null;
  }

  private handleResize = (): void => {
    this.app?.resizeCanvas();
  };

  private setupCamera(app: pc.AppBase): pc.Entity {
    const camera = new pc.Entity("camera");
    // PlayCanvas's default locks *vertical* FOV at 45deg, so horizontal FOV
    // shrinks with aspect ratio — fine on a wide desktop window (~67deg
    // horizontal) but collapses to ~22deg on a narrow portrait phone screen
    // (tan-based math, not a rough estimate), which reads as a telephoto
    // zoom. Desktop keeps that proven default untouched; mobile locks
    // horizontal FOV instead ("Hor+" scaling) so portrait gets a
    // comfortable field of view too.
    const fovOptions = isMobileViewport() ? { horizontalFov: true, fov: 65 } : {};
    camera.addComponent("camera", { clearColor: new pc.Color(0.05, 0.05, 0.06), ...fovOptions });
    app.root.addChild(camera);
    this.cameraEntity = camera;
    return camera;
  }

  // Prefer the first area's recorded spawn; fall back to the start of the
  // nav path itself (the only option for an overview-only capture, since
  // manifest.areas is empty until Phase 2 splits out per-room areas).
  private resolveSpawn(manifest: SceneManifest): { pos: Point2; yaw: number } {
    const areaSpawn = manifest.areas[0]?.spawn;
    if (areaSpawn) {
      return { pos: { x: areaSpawn.pos[0], z: areaSpawn.pos[2] }, yaw: areaSpawn.yaw };
    }
    const [first, second] = manifest.nav.nodes;
    if (first) {
      return { pos: { x: first[0], z: first[2] }, yaw: second ? yawBetween(first, second) : 0 };
    }
    return { pos: { x: 0, z: 0 }, yaw: 0 };
  }

  private setupController(app: pc.AppBase, manifest: SceneManifest): void {
    if (manifest.nav.nodes.length === 0 || !this.cameraEntity) return; // no recorded path — leave the static camera as-is

    const spawn = this.resolveSpawn(manifest);
    this.controller = new PortalCameraController(manifest, this.canvas, spawn.pos, spawn.yaw);
    this.debugOverlay = new DebugOverlay(this.canvas.parentElement ?? document.body);
    this.showControlsHint();

    app.on("update", (dt: number) => {
      if (!this.controller || !this.cameraEntity) return;
      this.controller.update(dt, this.cameraEntity);
      this.areaVisibility?.update(this.cameraEntity.getPosition());

      this.fps += (1 / Math.max(dt, 1e-6) - this.fps) * 0.1;
      this.debugOverlay?.update({
        fps: this.fps,
        renderer: app.graphicsDevice.deviceType,
        splatCount: this.splats.length,
        residentMB: this.splats.reduce((sum, s) => sum + s.bytes, 0) / (1024 * 1024),
        navNodeIndex: this.controller.currentNodeIndex,
      });
    });
  }

  private showControlsHint(): void {
    const hint = document.createElement("div");
    // Touch has no keyboard, so "WASD/arrows" doesn't apply — the joystick
    // (virtualJoystick.ts) is the touch equivalent.
    hint.textContent = isMobileViewport()
      ? "Drag to look · Joystick to move · Tap to walk there"
      : "Drag to look · WASD/arrows to move · Click/tap to walk there · D for debug";
    hint.setAttribute(
      "style",
      // Bottom-center, not bottom-left: the movement joystick occupies the
      // bottom-left corner on touch devices.
      "position:absolute;left:50%;bottom:12px;transform:translateX(-50%);" +
        "padding:6px 10px;border-radius:4px;white-space:nowrap;" +
        "background:rgba(10,10,12,0.6);color:#e8e8ea;font:12px system-ui,sans-serif;" +
        "pointer-events:none;z-index:5;",
    );
    (this.canvas.parentElement ?? document.body).appendChild(hint);
    this.controlsHint = hint;
  }

  private findSplatEntity(name: string): pc.Entity | null {
    return this.splats.find((s) => s.entity.name === name)?.entity ?? null;
  }

  private loadSplat(
    app: pc.AppBase,
    name: string,
    url: string,
    overlay: LoadingOverlay,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const asset = new pc.Asset(name, "gsplat", { url });
      let bytesLoaded = 0;

      asset.on("progress", (received: number, total: number) => {
        bytesLoaded = received;
        if (total > 0) overlay.setProgress(received / total);
      });
      asset.once("load", () => {
        const entity = new pc.Entity(name);
        entity.addComponent("gsplat", { asset });
        app.root.addChild(entity);
        this.splats.push({ entity, asset, bytes: bytesLoaded });
        resolve();
      });
      asset.once("error", (err: string) => {
        reject(new Error(`failed to load splat '${name}' (${url}): ${err}`));
      });

      app.assets.add(asset);
      app.assets.load(asset);
    });
  }
}
