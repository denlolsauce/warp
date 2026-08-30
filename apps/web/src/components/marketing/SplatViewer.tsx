"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { registerViewer, reportVisibility, unregisterViewer } from "./viewerCoordinator";

// A live model. PlayCanvas is loaded from /playcanvas.min.js rather than
// bundled: it is ~2.4MB, only marketing pages need it, and CLAUDE.md's viewer
// is meant to ship as a standalone CDN bundle anyway, so keeping it out of the
// app bundle matches where this is heading.

const ENGINE_URL = "/playcanvas.min.js";

const MIN_POLAR = 0.05 * Math.PI;
const MAX_POLAR = 0.95 * Math.PI;
const MIN_RADIUS = 0.2;
const MAX_RADIUS = 8;
const ORBIT_SENSITIVITY = 0.008;
const ZOOM_SENSITIVITY = 0.0015;
const SPRING_STIFFNESS = 140;
const AUTOSPIN_RATE = 0.12; // radians/second, until the visitor takes over

const MAX_DEVICE_PIXEL_RATIO = 1.5;
// Phones report ratios of 3+, and this splat at 1.5x is well over a million
// pixels to blend per frame on a GPU with a fraction of a laptop's budget.
const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
const MOBILE_BREAKPOINT_PX = 640;
// How far a touch travels before it counts as turning the model rather than
// scrolling the page.
const TOUCH_GESTURE_THRESHOLD_PX = 8;

const FLOOR_CLEARANCE = 0.02;
const FLOOR_HISTOGRAM_BINS = 64;
const FLOOR_SPIKE_RATIO = 3;
const FLOOR_MAX_MASS_BELOW = 0.15;
const FLOOR_SLAB_THICKNESS_FRACTION = 0.05;
const FLOOR_SURFACE_RESIDUAL_PERCENTILE = 0.9;

// Structural types for just the engine surface used here. The package itself
// is deliberately not a dependency — it is loaded at runtime from /public — so
// importing its types would mean carrying 2.4MB of package for typing alone.
interface PcEntity {
  addComponent(type: string, data?: Record<string, unknown>): void;
  addChild(child: PcEntity): void;
  setPosition(x: number, y: number, z: number): void;
  lookAt(x: number, y: number, z: number): void;
}

interface PcAsset {
  once(event: string, handler: (arg?: unknown) => void): void;
  resource: unknown;
}

interface PcApp {
  scene: { gsplat: { antiAlias: boolean } };
  root: PcEntity;
  assets: { add(asset: PcAsset): void; load(asset: PcAsset): void };
  setCanvasFillMode(mode: unknown): void;
  setCanvasResolution(mode: unknown, width?: number, height?: number): void;
  on(event: "update", handler: (dt: number) => void): void;
  start(): void;
  destroy(): void;
}

interface Pc {
  createGraphicsDevice(canvas: HTMLCanvasElement, options: Record<string, unknown>): Promise<unknown>;
  Application: new (canvas: HTMLCanvasElement, options: Record<string, unknown>) => PcApp;
  Entity: new (name?: string) => PcEntity;
  Asset: new (name: string, type: string, file: { url: string }) => PcAsset;
  Color: new (r: number, g: number, b: number) => unknown;
  DEVICETYPE_WEBGPU: string;
  DEVICETYPE_WEBGL2: string;
  FILLMODE_NONE: unknown;
  RESOLUTION_FIXED: unknown;
}

declare global {
  interface Window {
    pc?: Pc;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(sorted: Float64Array | number[], q: number): number {
  const i = Math.floor(q * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
}

/**
 * Find the floor height in the splat, or null if there isn't a convincing one.
 *
 * A floor is a thin horizontal slab of gaussians with near-vacuum beneath it,
 * so it shows as a density spike in a histogram of height. The peak only
 * *locates* the floor though — it sits mid-slab, and what a viewer sees is the
 * top. Standing the camera on the peak puts it under the floor, so the plane
 * is fitted (recovering the ~1 degree of tilt the alignment leaves) and then
 * offset to the surface by the residual spread.
 *
 * The spike tests make this safe to run unconditionally: a cleaned product
 * floating in nothing has no such slab, fails them, and gets no constraint
 * rather than a fabricated one.
 */
function detectFloorY(centers: Float32Array, halfWidth: number): number | null {
  const count = Math.floor(centers.length / 3);
  if (count < 1000 || !(halfWidth > 0)) return null;

  const column: number[] = [];
  const columnIndex: number[] = [];
  for (let i = 0; i < count; i++) {
    if (Math.abs(centers[i * 3]) > halfWidth) continue;
    if (Math.abs(centers[i * 3 + 2]) > halfWidth) continue;
    column.push(centers[i * 3 + 1]);
    columnIndex.push(i);
  }
  if (column.length < 1000) return null;

  const sortedColumn = Float64Array.from(column).sort();
  const yLow = percentile(sortedColumn, 0.01);
  const yHigh = percentile(sortedColumn, 0.99);
  if (!(yHigh > yLow)) return null;

  const bins = new Int32Array(FLOOR_HISTOGRAM_BINS);
  const binWidth = (yHigh - yLow) / FLOOR_HISTOGRAM_BINS;
  let inColumn = 0;
  for (const y of column) {
    if (y < yLow || y > yHigh) continue;
    bins[Math.min(FLOOR_HISTOGRAM_BINS - 1, Math.floor((y - yLow) / binWidth))]++;
    inColumn++;
  }
  if (inColumn < 1000) return null;

  let peak = 0;
  for (let b = 1; b < FLOOR_HISTOGRAM_BINS; b++) if (bins[b] > bins[peak]) peak = b;

  const occupied = Array.from(bins)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const typical = occupied[Math.floor(0.5 * (occupied.length - 1))] || 1;
  if (bins[peak] < FLOOR_SPIKE_RATIO * typical) return null;

  let below = 0;
  for (let b = 0; b < peak; b++) below += bins[b];
  if (below / inColumn > FLOOR_MAX_MASS_BELOW) return null;

  const peakY = yLow + (peak + 0.5) * binWidth;
  const slabThickness = FLOOR_SLAB_THICKNESS_FRACTION * (yHigh - yLow);

  const sx: number[] = [];
  const sy: number[] = [];
  const sz: number[] = [];
  for (let j = 0; j < column.length; j++) {
    if (Math.abs(column[j] - peakY) > slabThickness) continue;
    const i = columnIndex[j];
    sx.push(centers[i * 3]);
    sy.push(column[j]);
    sz.push(centers[i * 3 + 2]);
  }
  if (sx.length < 100) return peakY;

  const n = sx.length;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let j = 0; j < n; j++) {
    mx += sx[j];
    my += sy[j];
    mz += sz[j];
  }
  mx /= n;
  my /= n;
  mz /= n;

  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let j = 0; j < n; j++) {
    const dx = sx[j] - mx;
    const dz = sz[j] - mz;
    const dy = sy[j] - my;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  if (det === 0) return peakY;
  const slopeX = (szz * sxy - sxz * szy) / det;
  const slopeZ = (sxx * szy - sxz * sxy) / det;
  const planeAtPivot = my - slopeX * mx - slopeZ * mz;

  const residuals = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    residuals[j] = sy[j] - (slopeX * sx[j] + slopeZ * sz[j] + planeAtPivot);
  }
  residuals.sort();

  // Take the plane at its highest across the orbit so the bound holds at every
  // azimuth, not only where the camera happens to start.
  const tiltRise = (Math.abs(slopeX) + Math.abs(slopeZ)) * halfWidth;
  return planeAtPivot + percentile(residuals, FLOOR_SURFACE_RESIDUAL_PERCENTILE) + tiltRise;
}

/** Critically-damped spring, closed form — ported from the viewer package. */
class Spring1D {
  value: number;
  velocity = 0;

  constructor(initial: number) {
    this.value = initial;
  }

  update(target: number, stiffness: number, dt: number): number {
    const omega = Math.sqrt(stiffness);
    const x0 = this.value - target;
    const c1 = this.velocity + omega * x0;
    const expTerm = Math.exp(-omega * dt);
    this.value = target + (x0 + c1 * dt) * expTerm;
    this.velocity = (this.velocity - omega * c1 * dt) * expTerm;
    return this.value;
  }
}

function loadEngine(): Promise<Pc> {
  if (window.pc) return Promise.resolve(window.pc);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ENGINE_URL}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => (window.pc ? resolve(window.pc) : reject(new Error("engine did not register")));
    script.addEventListener("load", done);
    script.addEventListener("error", () => reject(new Error("failed to load the 3D engine")));
    if (!existing) {
      script.src = ENGINE_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

type Status = "idle" | "loading" | "ready" | "unsupported";

export interface SplatViewerProps {
  /** Path to the .sog under /public. */
  src: string;
  label: string;
  /** Starting vantage. Defaults suit a cleaned, roughly 1-unit product. */
  startAzimuth?: number;
  startPolar?: number;
  startRadius?: number;
  /** Extra classes for the wrapper — callers own the aspect and rounding. */
  className?: string;
  /** Caption while this viewer is waiting its turn for the GPU context. */
  idleLabel?: string;
}

export function SplatViewer({
  src,
  label,
  startAzimuth = 0.6,
  startPolar = Math.PI / 2.3,
  startRadius = 2,
  className = "min-h-[400px]",
  idleLabel = "scroll to view in 3D",
}: SplatViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  // Whether this viewer currently holds the page's one GPU context.
  const [live, setLive] = useState(false);

  // Claim the context when this viewer is the most-visible one on the page,
  // and give it straight back on the way out. See viewerCoordinator for why
  // only one may be live at a time.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = registerViewer({
      start: () => setLive(true),
      stop: () => setLive(false),
    });
    const observer = new IntersectionObserver(
      (records) => records.forEach((record) => reportVisibility(key, record.intersectionRatio)),
      { threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
      unregisterViewer(key);
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus("loading");

    let disposed = false;
    let app: PcApp | null = null;
    const cleanups: Array<() => void> = [];

    void (async () => {
      let pc: Pc;
      try {
        pc = await loadEngine();
      } catch {
        if (!disposed) setStatus("unsupported");
        return;
      }
      if (disposed) return;

      // Probe capabilities before handing the canvas to the engine: on a
      // device with neither backend, createGraphicsDevice's failure surfaces
      // as an async throw inside an engine callback rather than a rejection,
      // which would leave this promise pending and the UI on "loading" forever.
      const hasWebgl2 = !!document.createElement("canvas").getContext("webgl2");
      // navigator.gpu isn't in this TS lib version yet.
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      const hasWebgpu = gpu ? !!(await gpu.requestAdapter().catch(() => null)) : false;
      if (disposed) return;
      if (!hasWebgl2 && !hasWebgpu) {
        setStatus("unsupported");
        return;
      }

      let device;
      try {
        device = await pc.createGraphicsDevice(canvas, {
          deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
          antialias: true,
          alpha: false,
        });
      } catch {
        if (!disposed) setStatus("unsupported");
        return;
      }
      if (disposed) return;

      const created = new pc.Application(canvas, { graphicsDevice: device });
      app = created;
      // Must match the training config's antialiased setting.
      created.scene.gsplat.antiAlias = true;
      created.setCanvasFillMode(pc.FILLMODE_NONE);
      created.setCanvasResolution(pc.RESOLUTION_FIXED);

      // Size the render target to the box the canvas actually occupies. The
      // width/height attributes are only a placeholder — the panel is fluid,
      // so rendering the attribute size would both stretch the image and burn
      // pixels that get scaled away.
      const sizeCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const cap = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
          ? MOBILE_MAX_DEVICE_PIXEL_RATIO
          : MAX_DEVICE_PIXEL_RATIO;
        const ratio = Math.min(window.devicePixelRatio || 1, cap);
        created.setCanvasResolution(
          pc.RESOLUTION_FIXED,
          Math.max(1, Math.round(rect.width * ratio)),
          Math.max(1, Math.round(rect.height * ratio)),
        );
      };
      sizeCanvas();
      window.addEventListener("resize", sizeCanvas);
      window.addEventListener("orientationchange", sizeCanvas);
      cleanups.push(() => {
        window.removeEventListener("resize", sizeCanvas);
        window.removeEventListener("orientationchange", sizeCanvas);
      });

      const camera = new pc.Entity("camera");
      camera.addComponent("camera", { clearColor: new pc.Color(0.035, 0.043, 0.06) });
      created.root.addChild(camera);

      const asset = new pc.Asset("model", "gsplat", { url: src });
      const loaded = await new Promise<boolean>((resolve) => {
        asset.once("load", () => resolve(true));
        asset.once("error", () => resolve(false));
        created.assets.add(asset);
        created.assets.load(asset);
      });
      if (disposed) return;
      if (!loaded) {
        setStatus("unsupported");
        return;
      }

      const product = new pc.Entity("product");
      product.addComponent("gsplat", { asset });
      created.root.addChild(product);

      // `_centers` is private to the resource, so treat its absence as normal:
      // an engine upgrade renaming it should quietly cost the floor
      // constraint, not throw on every page load.
      const centers = (asset.resource as { _centers?: Float32Array } | null)?._centers;
      const floorY =
        centers instanceof Float32Array ? detectFloorY(centers, startRadius) : null;

      // Largest polar angle that still keeps the camera above the floor at a
      // given radius. Radius-dependent, so it can't be a constant: an angle
      // that clears the floor up close dips under it once zoomed out, the
      // camera swinging on a bigger sphere around the same pivot.
      const maxPolarFor = (radius: number) => {
        if (floorY === null || radius <= 0) return MAX_POLAR;
        const cosLimit = (floorY + FLOOR_CLEARANCE) / radius;
        if (cosLimit <= -1) return MAX_POLAR;
        if (cosLimit >= 1) return MIN_POLAR;
        return Math.min(MAX_POLAR, Math.acos(cosLimit));
      };

      let targetAzimuth = startAzimuth;
      let targetPolar = Math.min(startPolar, maxPolarFor(startRadius));
      let targetRadius = startRadius;
      const azimuthSpring = new Spring1D(targetAzimuth);
      const polarSpring = new Spring1D(targetPolar);
      const radiusSpring = new Spring1D(targetRadius);

      let autoSpin = true;
      let dragging = false;
      let lastPointer: { x: number; y: number } | null = null;
      let touchIntent: "orbit" | "scroll" | null = null;
      let touchStart: { x: number; y: number } | null = null;
      let pinchStartDistance: number | null = null;
      let pinchStartRadius = targetRadius;

      const orbitBy = (dx: number, dy: number) => {
        autoSpin = false;
        targetAzimuth -= dx * ORBIT_SENSITIVITY;
        targetPolar = clamp(targetPolar - dy * ORBIT_SENSITIVITY, MIN_POLAR, maxPolarFor(targetRadius));
      };
      const zoomBy = (delta: number) => {
        autoSpin = false;
        targetRadius = clamp(targetRadius + delta, MIN_RADIUS, MAX_RADIUS);
        // Zooming out swings the camera on a larger sphere, so an angle that
        // cleared the floor a moment ago may not any more.
        targetPolar = Math.min(targetPolar, maxPolarFor(targetRadius));
      };

      const onPointerDown = (event: PointerEvent) => {
        dragging = true;
        autoSpin = false;
        lastPointer = { x: event.clientX, y: event.clientY };
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragging || !lastPointer) return;
        orbitBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
        lastPointer = { x: event.clientX, y: event.clientY };
      };
      const onPointerUp = () => {
        dragging = false;
        lastPointer = null;
      };
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        zoomBy(event.deltaY * ZOOM_SENSITIVITY * targetRadius);
      };
      const touchDistance = (touches: TouchList) =>
        Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);

      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length === 1) {
          // No preventDefault yet: it isn't known whether this is a turn or a
          // scroll, and cancelling upfront would rule out scrolling past a
          // viewer that fills most of a phone screen.
          dragging = true;
          touchIntent = null;
          touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
          lastPointer = { ...touchStart };
        } else if (event.touches.length === 2) {
          event.preventDefault();
          autoSpin = false;
          dragging = false;
          touchIntent = "orbit";
          pinchStartDistance = touchDistance(event.touches);
          pinchStartRadius = targetRadius;
        }
      };
      const onTouchMove = (event: TouchEvent) => {
        if (event.touches.length === 1 && dragging && lastPointer) {
          const touch = event.touches[0];
          if (touchIntent === null && touchStart) {
            const dx = Math.abs(touch.clientX - touchStart.x);
            const dy = Math.abs(touch.clientY - touchStart.y);
            if (Math.max(dx, dy) < TOUCH_GESTURE_THRESHOLD_PX) return;
            // Mostly sideways means turn it; anything else is a scroll and
            // stays the browser's to handle.
            touchIntent = dx > dy ? "orbit" : "scroll";
            if (touchIntent === "orbit") autoSpin = false;
            // Restart the delta so the model doesn't jump by the threshold.
            lastPointer = { x: touch.clientX, y: touch.clientY };
          }
          if (touchIntent !== "orbit") return;
          event.preventDefault();
          orbitBy(touch.clientX - lastPointer.x, touch.clientY - lastPointer.y);
          lastPointer = { x: touch.clientX, y: touch.clientY };
        } else if (event.touches.length === 2 && pinchStartDistance !== null) {
          event.preventDefault();
          const distance = touchDistance(event.touches);
          targetRadius = clamp(pinchStartRadius * (pinchStartDistance / distance), MIN_RADIUS, MAX_RADIUS);
          targetPolar = Math.min(targetPolar, maxPolarFor(targetRadius));
        }
      };
      const onTouchEnd = (event: TouchEvent) => {
        if (event.touches.length === 0) {
          dragging = false;
          lastPointer = null;
          touchIntent = null;
          touchStart = null;
          pinchStartDistance = null;
        }
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("touchstart", onTouchStart, { passive: false });
      canvas.addEventListener("touchmove", onTouchMove, { passive: false });
      canvas.addEventListener("touchend", onTouchEnd);
      cleanups.push(() => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("touchstart", onTouchStart);
        canvas.removeEventListener("touchmove", onTouchMove);
        canvas.removeEventListener("touchend", onTouchEnd);
      });

      const onUpdate = (dt: number) => {
        if (autoSpin && !dragging) targetAzimuth += dt * AUTOSPIN_RATE;
        const azimuth = azimuthSpring.update(targetAzimuth, SPRING_STIFFNESS, dt);
        const rawPolar = polarSpring.update(targetPolar, SPRING_STIFFNESS, dt);
        const radius = radiusSpring.update(targetRadius, SPRING_STIFFNESS, dt);
        // Clamp the rendered pair, not just the targets: the springs settle
        // independently, so an in-between frame can pair a large polar with an
        // already-grown radius and flash the underside.
        const polar = Math.min(rawPolar, maxPolarFor(radius));
        camera.setPosition(
          radius * Math.sin(polar) * Math.sin(azimuth),
          radius * Math.cos(polar),
          radius * Math.sin(polar) * Math.cos(azimuth),
        );
        camera.lookAt(0, 0, 0);
      };
      created.on("update", onUpdate);
      created.start();
      setStatus("ready");
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      app?.destroy();
      setStatus("idle");
    };
  }, [live, src, startAzimuth, startPolar, startRadius]);

  return (
    <div ref={wrapperRef} className={`relative bg-warp-well ${className}`}>
      <canvas
        ref={canvasRef}
        width={1000}
        height={400}
        aria-label={label}
        // Fades in rather than being display:none until ready — a hidden
        // canvas has a zero-sized layout box, the render resolution is derived
        // from that box, and WebGPU rejects a zero-sized swapchain outright.
        // pan-y, not none: this viewer fills most of a phone screen, so
        // swallowing every vertical swipe would strand the reader with no way
        // to scroll past it.
        className={`block h-full w-full touch-pan-y transition-opacity duration-500 ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-warp-well bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.035)_0_2px,transparent_2px_11px)]">
          <span className="px-5 text-center text-[11.5px] font-semibold uppercase tracking-[0.1em] text-warp-faint">
            {status === "loading"
              ? "loading model"
              : status === "unsupported"
                ? "3D preview unavailable on this device"
                : idleLabel}
          </span>
        </div>
      )}
    </div>
  );
}
