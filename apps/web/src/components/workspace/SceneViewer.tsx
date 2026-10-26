"use client";

import { useEffect, useId, useRef, useState } from "react";

const ENGINE_URL = "/playcanvas.min.js";
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
const CAMERA_FOV = 45;
const ORBIT_POLAR = Math.PI / 2.35;
const TOP_POLAR = 0.12;
const DEFAULT_AZIMUTH = 0.65;
const MIN_POLAR = 0.025;
const MAX_POLAR = Math.PI - MIN_POLAR;
const ORBIT_SENSITIVITY = 0.007;
const BOUNDS_SAMPLE_LIMIT = 20_000;
const BOUNDS_TRIM_FRACTION = 0.01;
const TARGET_FRAME_FILL = 0.78;
const CAMERA_FIT_PADDING = 1.04;

interface Vec3Like {
  x?: number;
  y?: number;
  z?: number;
}

interface SceneAsset {
  resource: unknown;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
}

interface SceneEntity {
  addComponent(type: string, data?: Record<string, unknown>): void;
  addChild(child: SceneEntity): void;
  setPosition(x: number, y: number, z: number): void;
  lookAt(x: number, y: number, z: number): void;
}

interface SceneApp {
  scene: { gsplat: { antiAlias: boolean }; exposure: number };
  root: SceneEntity;
  assets: {
    add(asset: SceneAsset): void;
    load(asset: SceneAsset): void;
  };
  setCanvasFillMode(mode: unknown): void;
  setCanvasResolution(mode: unknown, width?: number, height?: number): void;
  on(event: "update", handler: (dt: number) => void): void;
  start(): void;
  destroy(): void;
}

interface SceneDevice {
  destroy(): void;
}

interface ScenePc {
  createGraphicsDevice(canvas: HTMLCanvasElement, options: Record<string, unknown>): Promise<SceneDevice>;
  Application: new (canvas: HTMLCanvasElement, options: Record<string, unknown>) => SceneApp;
  Entity: new (name?: string) => SceneEntity;
  Asset: new (name: string, type: string, file: { url: string }) => SceneAsset;
  Color: new (r: number, g: number, b: number) => unknown;
  DEVICETYPE_WEBGPU: string;
  DEVICETYPE_WEBGL2: string;
  FILLMODE_NONE: unknown;
  RESOLUTION_FIXED: unknown;
}

interface SceneBounds {
  center: { x: number; y: number; z: number };
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  radius: number;
}

interface SceneController {
  setView(view: "orbit" | "top"): void;
  reset(view: "orbit" | "top"): void;
  setExposure(exposure: number): void;
}

export interface SceneViewerProps {
  src: string;
  label: string;
  className?: string;
  view?: "orbit" | "top";
  resetKey?: number;
  exposure?: number;
  onReady?: (stats: { gaussians?: number }) => void;
  onError?: (message: string) => void;
}

type ViewerStatus = "loading" | "ready" | "error";

let enginePromise: Promise<ScenePc> | null = null;

function loadEngine(): Promise<ScenePc> {
  const runtime = (window as Window & { pc?: ScenePc }).pc;
  if (runtime) return Promise.resolve(runtime);
  if (enginePromise) return enginePromise;

  enginePromise = new Promise<ScenePc>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ENGINE_URL}"]`);
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      const loaded = (window as Window & { pc?: ScenePc }).pc;
      if (loaded) resolve(loaded);
      else reject(new Error("The PlayCanvas engine did not initialize."));
    };
    const onError = () => {
      if (!existing) script.remove();
      reject(new Error("The PlayCanvas engine could not be loaded."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = ENGINE_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return enginePromise.catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
}

function vector(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Vec3Like;
  if (![candidate.x, candidate.y, candidate.z].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return null;
  }
  return { x: candidate.x as number, y: candidate.y as number, z: candidate.z as number };
}

function sceneBounds(resource: unknown): SceneBounds | null {
  if (!resource || typeof resource !== "object") return null;
  const splat = resource as {
    aabb?: { center?: unknown; halfExtents?: unknown };
    _centers?: Float32Array;
  };
  const centers = splat._centers;
  if (centers instanceof Float32Array && centers.length >= 3) {
    const count = Math.floor(centers.length / 3);
    const sampleCount = Math.min(count, BOUNDS_SAMPLE_LIMIT);
    const xs = new Float64Array(sampleCount);
    const ys = new Float64Array(sampleCount);
    const zs = new Float64Array(sampleCount);
    let seed = 0x6d2b79f5;
    let validCount = 0;
    for (let i = 0; i < sampleCount; i++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const index = count <= sampleCount
        ? i
        : Math.floor((seed / 0x1_0000_0000) * count);
      const x = centers[index * 3];
      const y = centers[index * 3 + 1];
      const z = centers[index * 3 + 2];
      if (![x, y, z].every(Number.isFinite)) continue;
      xs[validCount] = x;
      ys[validCount] = y;
      zs[validCount] = z;
      validCount++;
    }
    if (validCount === 0) return null;
    const sortedX = xs.subarray(0, validCount).sort();
    const sortedY = ys.subarray(0, validCount).sort();
    const sortedZ = zs.subarray(0, validCount).sort();

    const percentile = (values: Float64Array, fraction: number) =>
      values[Math.floor((values.length - 1) * fraction)];
    const min = {
      x: percentile(sortedX, BOUNDS_TRIM_FRACTION),
      y: percentile(sortedY, BOUNDS_TRIM_FRACTION),
      z: percentile(sortedZ, BOUNDS_TRIM_FRACTION),
    };
    const max = {
      x: percentile(sortedX, 1 - BOUNDS_TRIM_FRACTION),
      y: percentile(sortedY, 1 - BOUNDS_TRIM_FRACTION),
      z: percentile(sortedZ, 1 - BOUNDS_TRIM_FRACTION),
    };
    if ([...Object.values(min), ...Object.values(max)].every(Number.isFinite)) {
      const center = {
        x: (min.x + max.x) / 2,
        y: (min.y + max.y) / 2,
        z: (min.z + max.z) / 2,
      };
      const radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;
      if (radius > 0) return { center, min, max, radius };
    }
  }

  const aabbCenter = vector(splat.aabb?.center);
  const aabbHalf = vector(splat.aabb?.halfExtents);
  if (aabbCenter && aabbHalf) {
    const half = {
      x: Math.abs(aabbHalf.x),
      y: Math.abs(aabbHalf.y),
      z: Math.abs(aabbHalf.z),
    };
    const min = {
      x: aabbCenter.x - half.x,
      y: aabbCenter.y - half.y,
      z: aabbCenter.z - half.z,
    };
    const max = {
      x: aabbCenter.x + half.x,
      y: aabbCenter.y + half.y,
      z: aabbCenter.z + half.z,
    };
    const radius = Math.hypot(half.x, half.y, half.z);
    if (radius > 0) return { center: aabbCenter, min, max, radius };
  }
  return null;
}

function gaussianCount(resource: unknown): number | undefined {
  if (!resource || typeof resource !== "object") return undefined;
  const splat = resource as { numSplats?: unknown; _centers?: Float32Array };
  if (typeof splat.numSplats === "number" && Number.isFinite(splat.numSplats)) return splat.numSplats;
  return splat._centers instanceof Float32Array ? Math.floor(splat._centers.length / 3) : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SceneViewer({
  src,
  label,
  className = "min-h-[360px]",
  view,
  resetKey = 0,
  exposure = 1,
  onReady,
  onError,
}: SceneViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const latestPropsRef = useRef({ view, exposure, onReady, onError });
  latestPropsRef.current = { view, exposure, onReady, onError };
  const previousControlsRef = useRef({ view, resetKey, exposure });
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const instructionsId = useId();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let device: SceneDevice | null = null;
    let app: SceneApp | null = null;
    let asset: SceneAsset | null = null;
    let cancelAssetLoad: (() => void) | null = null;
    let fitCanvas: () => void = () => {};
    const cleanups: Array<() => void> = [];
    setStatus("loading");
    setErrorMessage("");

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // Keep teardown moving if a browser resource has already disappeared.
        }
      }
      try {
        cancelAssetLoad?.();
      } catch {
        // Asset listeners may already have been cleared by PlayCanvas.
      }
      try {
        if (app) app.destroy();
        else device?.destroy();
      } catch {
        // The device may already be lost; still clear the component handle.
      }
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    const fail = (message: string) => {
      if (disposed) return;
      dispose();
      setErrorMessage(message);
      setStatus("error");
      latestPropsRef.current.onError?.(message);
    };

    let controller: SceneController | null = null;

    const start = async () => {
      try {
        const pc = await loadEngine();
        if (disposed) return;
        device = await pc.createGraphicsDevice(canvas, {
          deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
          antialias: true,
          alpha: false,
        });
        if (disposed) {
          device.destroy();
          return;
        }

        const created = new pc.Application(canvas, { graphicsDevice: device });
        app = created;
        created.scene.gsplat.antiAlias = true;
        created.scene.exposure = latestPropsRef.current.exposure;
        created.setCanvasFillMode(pc.FILLMODE_NONE);
        created.setCanvasResolution(pc.RESOLUTION_FIXED);

        const resize = () => {
          const rect = canvas.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          const cap = window.innerWidth <= 640
            ? MOBILE_MAX_DEVICE_PIXEL_RATIO
            : MAX_DEVICE_PIXEL_RATIO;
          const ratio = Math.min(window.devicePixelRatio || 1, cap);
          created.setCanvasResolution(
            pc.RESOLUTION_FIXED,
            Math.max(1, Math.round(rect.width * ratio)),
            Math.max(1, Math.round(rect.height * ratio)),
          );
          fitCanvas();
        };
        resize();
        const resizeObserver = typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(resize);
        resizeObserver?.observe(canvas);
        window.addEventListener("resize", resize);
        window.addEventListener("orientationchange", resize);
        cleanups.push(() => {
          resizeObserver?.disconnect();
          window.removeEventListener("resize", resize);
          window.removeEventListener("orientationchange", resize);
        });

        asset = new pc.Asset("scene", "gsplat", { url: src });
        const loaded = await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            asset?.off("load", onLoad);
            asset?.off("error", onLoadError);
            cancelAssetLoad = null;
            resolve(value);
          };
          const onLoad = () => finish(true);
          const onLoadError = () => finish(false);
          const cancel = () => finish(false);
          cancelAssetLoad = cancel;
          asset?.on("load", onLoad);
          asset?.on("error", onLoadError);
          cleanups.push(cancel);
          if (asset) {
            created.assets.add(asset);
            created.assets.load(asset);
          }
        });
        if (disposed) return;
        if (!loaded || !asset) {
          fail("The Gaussian splat could not be loaded. Check that the scene URL is reachable and try again.");
          return;
        }

        const splat = new pc.Entity("scene-splat");
        splat.addComponent("gsplat", { asset });
        created.root.addChild(splat);

        const bounds = sceneBounds(asset.resource) ?? {
          center: { x: 0, y: 0, z: 0 },
          min: { x: -1, y: -1, z: -1 },
          max: { x: 1, y: 1, z: 1 },
          radius: Math.sqrt(3),
        };
        const rect = canvas.getBoundingClientRect();
        let aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
        const distanceToFit = (nextView: "orbit" | "top") => {
          const azimuth = nextView === "top" ? 0 : DEFAULT_AZIMUTH;
          const polar = nextView === "top" ? TOP_POLAR : ORBIT_POLAR;
          const viewDirection = {
            x: Math.sin(polar) * Math.sin(azimuth),
            y: Math.cos(polar),
            z: Math.sin(polar) * Math.cos(azimuth),
          };
          const right = { x: Math.cos(azimuth), y: 0, z: -Math.sin(azimuth) };
          const up = {
            x: -Math.cos(polar) * Math.sin(azimuth),
            y: Math.sin(polar),
            z: -Math.cos(polar) * Math.cos(azimuth),
          };
          const verticalTangent = Math.tan((CAMERA_FOV * Math.PI) / 360);
          const horizontalTangent = verticalTangent * aspect;
          const halfFill = TARGET_FRAME_FILL;
          let requiredDistance = 0;
          for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
              for (const z of [bounds.min.z, bounds.max.z]) {
                const point = {
                  x: x - bounds.center.x,
                  y: y - bounds.center.y,
                  z: z - bounds.center.z,
                };
                const nearerBy =
                  point.x * viewDirection.x +
                  point.y * viewDirection.y +
                  point.z * viewDirection.z;
                const horizontal = Math.abs(point.x * right.x + point.y * right.y + point.z * right.z);
                const vertical = Math.abs(point.x * up.x + point.y * up.y + point.z * up.z);
                requiredDistance = Math.max(
                  requiredDistance,
                  nearerBy + horizontal / (horizontalTangent * halfFill),
                  nearerBy + vertical / (verticalTangent * halfFill),
                );
              }
            }
          }
          return Math.max(requiredDistance * CAMERA_FIT_PADDING, bounds.radius * 0.02, 0.00000001);
        };
        const initialView = latestPropsRef.current.view ?? "orbit";
        let currentView: "orbit" | "top" = initialView;
        let fitDistance = distanceToFit(initialView);
        let minZoomDistance = Math.max(fitDistance * 0.001, 0.00000001);
        let maxZoomDistance = fitDistance * 100;
        const camera = new pc.Entity("scene-camera");
        camera.addComponent("camera", {
          clearColor: new pc.Color(0.93, 0.94, 0.95),
          fov: CAMERA_FOV,
          nearClip: Math.max(fitDistance * 0.0000001, 0.000000001),
          farClip: Math.max(fitDistance * 1000, 1),
        });
        created.root.addChild(camera);
        let focus = { ...bounds.center };
        let azimuth = DEFAULT_AZIMUTH;
        let targetAzimuth = azimuth;
        let polar = ORBIT_POLAR;
        let targetPolar = polar;
        let distance = fitDistance;
        let targetDistance = fitDistance;

        fitCanvas = () => {
          const size = canvas.getBoundingClientRect();
          if (size.width < 1 || size.height < 1) return;
          const zoom = targetDistance / fitDistance;
          aspect = size.width / size.height;
          fitDistance = distanceToFit(currentView);
          minZoomDistance = Math.max(fitDistance * 0.001, 0.00000001);
          maxZoomDistance = fitDistance * 100;
          targetDistance = clamp(fitDistance * zoom, minZoomDistance, maxZoomDistance);
        };

        const setView = (nextView: "orbit" | "top") => {
          const zoom = targetDistance / fitDistance;
          currentView = nextView;
          fitDistance = distanceToFit(nextView);
          minZoomDistance = Math.max(fitDistance * 0.001, 0.00000001);
          maxZoomDistance = fitDistance * 100;
          targetDistance = clamp(fitDistance * zoom, minZoomDistance, maxZoomDistance);
          targetAzimuth = nextView === "top" ? 0 : DEFAULT_AZIMUTH;
          targetPolar = nextView === "top" ? TOP_POLAR : ORBIT_POLAR;
        };
        const reset = (nextView: "orbit" | "top") => {
          focus = { ...bounds.center };
          setView(nextView);
          targetDistance = fitDistance;
        };
        const setExposure = (nextExposure: number) => {
          if (Number.isFinite(nextExposure)) created.scene.exposure = nextExposure;
        };
        controller = { setView, reset, setExposure };
        setView(initialView);
        setExposure(latestPropsRef.current.exposure);

        const applyCamera = () => {
          const sinPolar = Math.sin(polar);
          camera.setPosition(
            focus.x + distance * sinPolar * Math.sin(azimuth),
            focus.y + distance * Math.cos(polar),
            focus.z + distance * sinPolar * Math.cos(azimuth),
          );
          camera.lookAt(focus.x, focus.y, focus.z);
        };
        const orbitBy = (dx: number, dy: number) => {
          targetAzimuth -= dx * ORBIT_SENSITIVITY;
          targetPolar = clamp(targetPolar - dy * ORBIT_SENSITIVITY, MIN_POLAR, MAX_POLAR);
        };
        const zoomTo = (nextDistance: number) => {
          targetDistance = clamp(nextDistance, minZoomDistance, maxZoomDistance);
        };
        const zoomBy = (delta: number) => {
          zoomTo(targetDistance * Math.exp(delta * 0.0012));
        };
        const panBy = (dx: number, dy: number) => {
          const rect = canvas.getBoundingClientRect();
          const height = Math.max(rect.height, 1);
          const unitsPerPixel = (2 * targetDistance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / height;
          const right = { x: Math.cos(azimuth), y: 0, z: -Math.sin(azimuth) };
          const up = {
            x: -Math.cos(polar) * Math.sin(azimuth),
            y: Math.sin(polar),
            z: -Math.cos(polar) * Math.cos(azimuth),
          };
          focus.x += (-dx * right.x + dy * up.x) * unitsPerPixel;
          focus.y += (-dx * right.y + dy * up.y) * unitsPerPixel;
          focus.z += (-dx * right.z + dy * up.z) * unitsPerPixel;
        };

        let activePointer: number | null = null;
        let dragMode: "orbit" | "pan" | null = null;
        let lastPointer: { x: number; y: number } | null = null;
        let touchIntent: "orbit" | "scroll" | null = null;
        let touchStart: { x: number; y: number } | null = null;
        let lastTouch: { x: number; y: number } | null = null;
        let pinchStartDistance: number | null = null;
        let pinchStartRadius = targetDistance;

        const onPointerDown = (event: PointerEvent) => {
          if (event.pointerType === "touch" || (event.button !== 0 && event.button !== 2)) return;
          event.preventDefault();
          canvas.focus({ preventScroll: true });
          activePointer = event.pointerId;
          dragMode = event.button === 2 || event.shiftKey ? "pan" : "orbit";
          lastPointer = { x: event.clientX, y: event.clientY };
        };
        const onPointerMove = (event: PointerEvent) => {
          if (activePointer !== event.pointerId || !lastPointer || !dragMode) return;
          const dx = event.clientX - lastPointer.x;
          const dy = event.clientY - lastPointer.y;
          if (dragMode === "pan") panBy(dx, dy);
          else orbitBy(dx, dy);
          lastPointer = { x: event.clientX, y: event.clientY };
        };
        const onPointerUp = (event: PointerEvent) => {
          if (activePointer !== event.pointerId) return;
          activePointer = null;
          dragMode = null;
          lastPointer = null;
        };
        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          zoomBy(event.deltaY);
        };
        const touchDistance = (touches: TouchList) =>
          Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
        const onTouchStart = (event: TouchEvent) => {
          if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchStart = { x: touch.clientX, y: touch.clientY };
            lastTouch = { ...touchStart };
            touchIntent = null;
          } else if (event.touches.length === 2) {
            event.preventDefault();
            touchIntent = "orbit";
            pinchStartDistance = touchDistance(event.touches);
            pinchStartRadius = targetDistance;
          }
        };
        const onTouchMove = (event: TouchEvent) => {
          if (event.touches.length === 2 && pinchStartDistance !== null) {
            event.preventDefault();
            const nextDistance = touchDistance(event.touches);
            if (nextDistance > 0) zoomTo(pinchStartRadius * (pinchStartDistance / nextDistance));
            return;
          }
          if (event.touches.length !== 1 || !lastTouch || !touchStart) return;
          const touch = event.touches[0];
          if (touchIntent === null) {
            const dx = Math.abs(touch.clientX - touchStart.x);
            const dy = Math.abs(touch.clientY - touchStart.y);
            if (Math.max(dx, dy) < 8) return;
            touchIntent = dx > dy ? "orbit" : "scroll";
            lastTouch = { x: touch.clientX, y: touch.clientY };
          }
          if (touchIntent !== "orbit") return;
          event.preventDefault();
          orbitBy(touch.clientX - lastTouch.x, touch.clientY - lastTouch.y);
          lastTouch = { x: touch.clientX, y: touch.clientY };
        };
        const onTouchEnd = (event: TouchEvent) => {
          if (event.touches.length === 0) {
            touchIntent = null;
            touchStart = null;
            lastTouch = null;
            pinchStartDistance = null;
          } else if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchStart = { x: touch.clientX, y: touch.clientY };
            lastTouch = { ...touchStart };
            touchIntent = null;
            pinchStartDistance = null;
          }
        };
        const onContextMenu = (event: MouseEvent) => event.preventDefault();
        const onKeyDown = (event: KeyboardEvent) => {
          const step = 28;
          if (event.key === "Home") {
            event.preventDefault();
            reset(currentView);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            if (event.shiftKey) panBy(event.key === "ArrowRight" ? step : -step, 0);
            else orbitBy(event.key === "ArrowRight" ? step : -step, 0);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            if (event.shiftKey) panBy(0, event.key === "ArrowDown" ? step : -step);
            else orbitBy(0, event.key === "ArrowDown" ? step : -step);
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoomTo(targetDistance * 0.85);
          } else if (event.key === "-") {
            event.preventDefault();
            zoomTo(targetDistance / 0.85);
          }
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("touchstart", onTouchStart, { passive: false });
        canvas.addEventListener("touchmove", onTouchMove, { passive: false });
        canvas.addEventListener("touchend", onTouchEnd);
        canvas.addEventListener("touchcancel", onTouchEnd);
        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("keydown", onKeyDown);
        cleanups.push(() => {
          canvas.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          canvas.removeEventListener("wheel", onWheel);
          canvas.removeEventListener("touchstart", onTouchStart);
          canvas.removeEventListener("touchmove", onTouchMove);
          canvas.removeEventListener("touchend", onTouchEnd);
          canvas.removeEventListener("touchcancel", onTouchEnd);
          canvas.removeEventListener("contextmenu", onContextMenu);
          canvas.removeEventListener("keydown", onKeyDown);
        });

        const onUpdate = (dt: number) => {
          const alpha = 1 - Math.exp(-14 * Math.min(Math.max(dt, 0), 0.1));
          azimuth += (targetAzimuth - azimuth) * alpha;
          polar += (targetPolar - polar) * alpha;
          distance += (targetDistance - distance) * alpha;
          applyCamera();
        };
        created.on("update", onUpdate);
        applyCamera();
        created.start();

        const activeController = controller;
        if (activeController) controllerRef.current = activeController;
        setStatus("ready");
        latestPropsRef.current.onReady?.({ gaussians: gaussianCount(asset.resource) });
      } catch {
        fail("3D graphics could not start. Try again in a browser with WebGL2 support.");
      }
    };

    void start();
    return dispose;
  }, [src, retry]);

  useEffect(() => {
    const previous = previousControlsRef.current;
    const controller = controllerRef.current;
    if (controller) {
      if (previous.view !== view) controller.setView(view ?? "orbit");
      if (previous.resetKey !== resetKey) controller.reset(view ?? "orbit");
      if (previous.exposure !== exposure) controller.setExposure(exposure);
    }
    previousControlsRef.current = { view, resetKey, exposure };
  }, [view, resetKey, exposure]);

  return (
    <div className={`relative w-full overflow-hidden bg-[#eef0f1] ${className}`}>
      <canvas
        ref={canvasRef}
        width={1000}
        height={600}
        aria-label={label}
        aria-describedby={instructionsId}
        role="img"
        tabIndex={0}
        className="absolute inset-0 block h-full w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
      />
      <p id={instructionsId} className="sr-only">
        Drag to orbit. Shift-drag or right-drag to pan. Scroll or pinch to zoom. With the viewer focused, use arrow keys to orbit, Shift plus arrow keys to pan, plus or minus to zoom, and Home to reset.
      </p>
      {status !== "ready" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#eef0f1] px-6 text-center"
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {status === "loading" ? (
            <span className="text-sm text-slate-500">Loading 3D scene…</span>
          ) : (
            <>
              <p className="max-w-sm text-sm text-slate-600">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
              >
                Retry loading scene
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
