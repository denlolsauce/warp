import * as pc from "playcanvas";
import type { SceneManifest } from "@portal/schema";
import { fetchManifest } from "./manifest";
import { createDevice } from "./device";
import { applyMeasuredGaussianBudget, SPLAT_BUDGET_LOW } from "./budget";
import { LoadingOverlay } from "./loading";
import { PortalCameraController } from "./cameraController";
import { DebugOverlay } from "./debugOverlay";
import type { Point2 } from "./navigation";
import { isMobileViewport } from "./virtualJoystick";
import { AreaStreaming } from "./areaStreaming";
import { Minimap } from "./minimap";
import { HudControls } from "./hudControls";

// The gaussian budget tier already reflects measured GPU frame time
// (CLAUDE.md: never decide budgets from user-agent) — reusing it for the
// resident-area cap keeps both memory budgets driven by the same signal
// instead of introducing a second, viewport-based notion of "low-end".
const RESIDENT_AREA_BUDGET_DESKTOP = 4;
const RESIDENT_AREA_BUDGET_LOW_TIER = 2;

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
  private areaStreaming: AreaStreaming | null = null;
  private minimap: Minimap | null = null;
  private hudControls: HudControls | null = null;
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

      // Must stay in lockstep with TrainConfig.antialiased in the pipeline.
      // This sets the GSPLAT_AA define, which multiplies each gaussian's alpha
      // by sqrt(detOrig/detBlur) for the same 0.3px screen-space dilation that
      // gsplat's antialiased rasterize mode trains against. The splats are
      // optimised with that compensation applied, so rendering without it
      // leaves small/distant gaussians too opaque — enabling it on one side
      // only is worse than having it on neither.
      app.scene.gsplat.antiAlias = true;

      app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
      window.addEventListener("resize", this.handleResize);

      this.setupCamera(app);
      this.setupController(app, manifest);
      this.setupHud();
      app.start();

      let budgetMeasured = false;

      if (manifest.overview) {
        overlay.setStatus("Loading overview…");
        await this.loadSplat(app, "overview", manifest.overview.common, overlay);

        // Measure against a scene that's actually rendering something, not an
        // empty canvas, so the budget reflects real gaussian-splat render cost.
        // Not awaited — area streaming shouldn't block initial load on a ~2s
        // measurement (see AreaStreaming's constructor comment).
        void applyMeasuredGaussianBudget(app).then((budget) => {
          this.areaStreaming?.setBudget(
            budget === SPLAT_BUDGET_LOW ? RESIDENT_AREA_BUDGET_LOW_TIER : RESIDENT_AREA_BUDGET_DESKTOP,
          );
        });
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

      if (!budgetMeasured) {
        void applyMeasuredGaussianBudget(app);
      }

      // Areas stream in on demand (AreaStreaming) rather than loading here —
      // the overview substrate above is everything initial load waits on.
      this.areaStreaming = new AreaStreaming(app, manifest, RESIDENT_AREA_BUDGET_LOW_TIER, (name) =>
        this.findSplatEntity(name),
      );

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
    this.areaStreaming?.destroy();
    this.areaStreaming = null;
    this.minimap?.destroy();
    this.minimap = null;
    this.hudControls?.destroy();
    this.hudControls = null;
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
      const cameraPos = this.cameraEntity.getPosition();
      this.areaStreaming?.update(cameraPos, this.controller.currentNodeIndex, dt);
      this.minimap?.update({ x: cameraPos.x, z: cameraPos.z }, this.cameraEntity.getEulerAngles().y);

      this.fps += (1 / Math.max(dt, 1e-6) - this.fps) * 0.1;
      const streamedBytes = this.areaStreaming?.residentBytes ?? 0;
      this.debugOverlay?.update({
        fps: this.fps,
        renderer: app.graphicsDevice.deviceType,
        splatCount: this.splats.length + (this.areaStreaming?.residentCount ?? 0),
        residentMB: (this.splats.reduce((sum, s) => sum + s.bytes, 0) + streamedBytes) / (1024 * 1024),
        navNodeIndex: this.controller.currentNodeIndex,
        areasResident: this.areaStreaming?.residentCount ?? 0,
        areasLoading: this.areaStreaming?.loadingCount ?? 0,
        areaBudget: this.areaStreaming?.budgetLimit ?? 0,
      });
    });
  }

  // Minimap intentionally omitted: floorplan.py's top-down render is
  // unreadable on real trained splats (it flattens each gaussian to a
  // circle and ignores rotation, so large angled surfaces render as
  // oversized blobs instead of walls/floor). Re-enable once that renderer
  // produces something worth overlaying a nav graph on.
  private setupHud(): void {
    const container = this.canvas.parentElement ?? document.body;

    // ?embed=1 is what TourStatus.tsx's copy-paste embed snippet carries
    // (apps/web) — a tour published on someone else's site for their own
    // visitors. The creator's own preview iframe on their /tours/[id] page
    // uses the same viewer URL without it, so the badge shows there.
    const isEmbed = new URLSearchParams(window.location.search).get("embed") === "1";
    this.hudControls = new HudControls(container, {
      onReset: () => this.controller?.resetToSpawn(),
      isEmbed,
    });
  }

  private showControlsHint(): void {
    const hint = document.createElement("div");
    const mobile = isMobileViewport();
    // Touch has no keyboard, so "WASD/arrows" doesn't apply — the joystick
    // (virtualJoystick.ts) is the touch equivalent.
    // Shorter on mobile, not just keyboard-free: the full desktop string
    // doesn't fit top-left alongside the minimap (below) on a narrow screen.
    hint.textContent = mobile
      ? "Drag to look · Joystick to move"
      : "Drag to look · WASD/arrows to move · Click/tap to walk there · D for debug";
    // Bottom-center collides on mobile: the joystick (bottom-left) and the
    // reset/fullscreen/badge cluster (hudControls.ts, bottom-right) already
    // claim that whole row on a narrow screen. Top-left is what's left —
    // the minimap (top-right) and debug overlay (top-left but hidden until
    // 'D' is pressed) don't compete with it there. Desktop keeps the
    // original bottom-center, where none of that crowding exists.
    const positionStyle = mobile ? "left:12px;top:12px;" : "left:50%;bottom:12px;transform:translateX(-50%);";
    hint.setAttribute(
      "style",
      `position:absolute;${positionStyle}` +
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
