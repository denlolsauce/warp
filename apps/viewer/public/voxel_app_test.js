(() => {
  "use strict";

  // Critically-damped spring (closed-form, damping ratio 1.0) -- ported
  // from apps/viewer/src/springDamper.ts verbatim.
  class Spring1D {
    constructor(initial) {
      this.value = initial;
      this.velocity = 0;
    }
    update(target, stiffness, dt) {
      const omega = Math.sqrt(stiffness);
      const x0 = this.value - target;
      const c1 = this.velocity + omega * x0;
      const expTerm = Math.exp(-omega * dt);
      this.value = target + (x0 + c1 * dt) * expTerm;
      this.velocity = (this.velocity - omega * c1 * dt) * expTerm;
      return this.value;
    }
  }

  const MIN_POLAR = 0.05 * Math.PI;
  const MAX_POLAR = 0.95 * Math.PI;
  // Floor constraint. Ported from apps/viewer/src/productPreview.ts, which is
  // where it was measured against the real capture -- the numbers here are
  // that file's, not re-tuned for the page.
  const FLOOR_CLEARANCE = 0.02;
  const FLOOR_HISTOGRAM_BINS = 64;
  const FLOOR_SPIKE_RATIO = 3.0;
  const FLOOR_MAX_MASS_BELOW = 0.15;
  const FLOOR_SLAB_THICKNESS_FRACTION = 0.05;
  const FLOOR_SURFACE_RESIDUAL_PERCENTILE = 0.9;
  const MIN_RADIUS = 0.2;
  const MAX_RADIUS = 8;
  const ORBIT_SENSITIVITY = 0.008;
  const ZOOM_SENSITIVITY = 0.0015;
  const SPRING_STIFFNESS = 140;
  const MAX_DEVICE_PIXEL_RATIO = 1.5;
  // Phones report device pixel ratios of 3 and up, and a splat at 1.5x on a
  // 780px panel is 1.4M pixels to sort and blend every frame on a GPU with a
  // fraction of a laptop's budget. Render at 1x there; the models are soft
  // enough that the difference is hard to see and the frame rate isn't.
  const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
  const MOBILE_BREAKPOINT_PX = 640;
  // How far a touch must travel before it counts as turning the model rather
  // than scrolling the page. Small enough not to feel laggy, large enough
  // that a slightly-diagonal scroll isn't misread as a drag.
  const TOUCH_GESTURE_THRESHOLD_PX = 8;
  // Exactly one viewer holds a live GPU context at a time. The limit here is
  // memory, not context count -- measured across three combinations on this
  // page's own models: 7.4MB + 8.8MB together were fine, 8.4MB + 8.8MB were
  // not, and any three broke ALL of them. The failure is silent and easy to
  // misread: every canvas goes black while its asset reports loaded, the
  // giveaway being a gsplat component sitting there with no resource bound.
  //
  // Since two of these models can't be relied on to coexist, the page keeps
  // one -- whichever the reader is actually looking at -- and hands the
  // context over as they scroll. That is also what the page's own "nothing
  // starts up until the viewer scrolls into view" claim ought to mean once
  // there is more than one model on the page.

  function percentile(sorted, q) {
    const i = Math.floor(q * (sorted.length - 1));
    return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
  }

  // Find the floor height, or null if the splat has no convincing one.
  //
  // A floor is a thin horizontal slab with near-vacuum under it, so it shows
  // up as a density spike in a histogram of gaussian height. The peak only
  // LOCATES the floor though -- it sits in the middle of the slab, and the
  // surface a viewer sees is the top. Standing the camera on the peak puts it
  // under the floor, which is exactly the bug this two-step fixes: fit a
  // plane to the slab (recovering the slight tilt the alignment leaves), then
  // offset to the surface via the residual spread.
  //
  // The spike tests are what make this safe: a cleaned product floating in
  // nothing has no such slab, fails them, and gets no constraint rather than
  // a fabricated one.
  function detectFloorY(centers, pivotX, pivotZ, columnHalfWidth) {
    const count = Math.floor(centers.length / 3);
    if (count < 1000 || !(columnHalfWidth > 0)) return null;

    const column = [], columnIndex = [];
    for (let i = 0; i < count; i++) {
      if (Math.abs(centers[i * 3] - pivotX) > columnHalfWidth) continue;
      if (Math.abs(centers[i * 3 + 2] - pivotZ) > columnHalfWidth) continue;
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

    const occupied = Array.from(bins).filter((n) => n > 0).sort((a, b) => a - b);
    const typical = occupied[Math.floor(0.5 * (occupied.length - 1))] || 1;
    if (bins[peak] < FLOOR_SPIKE_RATIO * typical) return null;

    let below = 0;
    for (let b = 0; b < peak; b++) below += bins[b];
    if (below / inColumn > FLOOR_MAX_MASS_BELOW) return null;

    const peakY = yLow + (peak + 0.5) * binWidth;
    const slabThickness = FLOOR_SLAB_THICKNESS_FRACTION * (yHigh - yLow);

    const sx = [], sy = [], sz = [];
    for (let j = 0; j < column.length; j++) {
      if (Math.abs(column[j] - peakY) > slabThickness) continue;
      const i = columnIndex[j];
      sx.push(centers[i * 3]);
      sy.push(column[j]);
      sz.push(centers[i * 3 + 2]);
    }
    if (sx.length < 100) return peakY;

    const n = sx.length;
    let mx = 0, my = 0, mz = 0;
    for (let j = 0; j < n; j++) { mx += sx[j]; my += sy[j]; mz += sz[j]; }
    mx /= n; my /= n; mz /= n;

    let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
    for (let j = 0; j < n; j++) {
      const dx = sx[j] - mx, dz = sz[j] - mz, dy = sy[j] - my;
      sxx += dx * dx; sxz += dx * dz; szz += dz * dz; sxy += dx * dy; szy += dz * dy;
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
    const surfaceOffset = percentile(residuals, FLOOR_SURFACE_RESIDUAL_PERCENTILE);
    const tiltRise = (Math.abs(slopeX) + Math.abs(slopeZ)) * columnHalfWidth;
    return planeAtPivot + surfaceOffset + tiltRise;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  async function createDevice(canvas) {
    const device = await pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGPU],
      antialias: true,
      alpha: false,
    });
    const cap = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
      ? MOBILE_MAX_DEVICE_PIXEL_RATIO
      : MAX_DEVICE_PIXEL_RATIO;
    device.maxPixelRatio = Math.min(window.devicePixelRatio, cap);
    return device;
  }

  class SplatDemo {
    constructor(canvas, surface, loadingEl, radius, options) {
      this.canvas = canvas;
      this.surface = surface;
      this.loadingEl = loadingEl;
      this.app = null;
      this.cameraEntity = null;
      const opts = options || {};
      // Height of the floor, once known. Opt-in per demo (data-floor="auto"):
      // a cleaned product has no floor to speak of, cleanup.py having removed
      // the support surface, so this stays off unless a capture asks for it.
      this.floorMode = opts.floor || null;
      this.floorY = null;

      this.targetAzimuth = opts.azimuth !== undefined ? opts.azimuth : 0.6;
      this.targetPolar = opts.polar !== undefined ? opts.polar : Math.PI / 2.3;
      // At this camera's 45deg FOV, radius r gives a visible frame height of
      // r*0.8284, so 2.0 clears a cleaned product's ~1.0-unit longest
      // dimension with margin. A raw capture still has the whole room around
      // the product and wants a tighter value to stay on the subject --
      // hence per-viewer rather than one constant.
      this.targetRadius = radius;
      this.azimuthSpring = new Spring1D(this.targetAzimuth);
      this.polarSpring = new Spring1D(this.targetPolar);
      this.radiusSpring = new Spring1D(this.targetRadius);

      this.dragging = false;
      this.lastPointer = null;
      this.pinchStartDistance = null;
      this.pinchStartRadius = this.targetRadius;
      // null until a one-finger gesture has declared itself: "orbit" turns
      // the model, "scroll" is left entirely to the browser.
      this.touchIntent = null;
      this.touchStart = null;
      this.autoSpin = true;
      this.lastInteraction = 0;

      this.handleUpdate = this.handleUpdate.bind(this);
      this.handleResize = this.handleResize.bind(this);
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handleWheel = this.handleWheel.bind(this);
      this.handleTouchStart = this.handleTouchStart.bind(this);
      this.handleTouchMove = this.handleTouchMove.bind(this);
      this.handleTouchEnd = this.handleTouchEnd.bind(this);
    }

    async load(sogUrl) {
      const device = await createDevice(this.canvas);
      const app = new pc.Application(this.canvas, { graphicsDevice: device });
      this.app = app;

      app.scene.gsplat.antiAlias = true;
      // Fixed backing-store resolution (the canvas's width/height HTML
      // attributes, set upfront in markup) rather than resizing to match
      // the container after device creation -- resizeCanvas() here raced
      // pc.createGraphicsDevice()'s own WebGPU swapchain setup and briefly
      // configured it at 0x0, which Dawn rejects outright. CSS still scales
      // the canvas to fill its container; only the render resolution is
      // fixed, which is a fine trade for a decorative panel this size.
      app.setCanvasFillMode(pc.FILLMODE_NONE);
      // width/height are separate optional args here, not inferred from
      // the canvas's own width/height attributes -- omitting them left the
      // backing store at 0x0, which Dawn's WebGPU swapchain rejects outright
      // (confirmed against this exact page: canvas.width/height read back
      // as "0x0" even though the HTML attributes said 780x780).
      app.setCanvasResolution(pc.RESOLUTION_FIXED);
      this.sizeCanvas();
      window.addEventListener("resize", this.handleResize);
      window.addEventListener("orientationchange", this.handleResize);

      const camera = new pc.Entity("camera");
      camera.addComponent("camera", { clearColor: new pc.Color(0.043, 0.055, 0.078) });
      app.root.addChild(camera);
      this.cameraEntity = camera;

      await new Promise((resolve, reject) => {
        // PlayCanvas picks a gsplat parser (.sog zip / .ply / etc.) by
        // sniffing the URL's file extension, never the byte content or a
        // MIME type -- a blob: URL has no extension of its own, so it
        // matches no parser and fails with a generic "no parser found"
        // unless filename is set explicitly (this is the documented seam
        // for exactly this case, per ResourceHandler's own JSDoc).
        const asset = new pc.Asset("product", "gsplat", { url: sogUrl, filename: "product.sog" });
        asset.once("load", () => {
          const entity = new pc.Entity("product");
          entity.addComponent("gsplat", { asset });
          app.root.addChild(entity);
          if (this.floorMode === "auto") {
            // `_centers` is private to the resource, so treat its absence as
            // normal -- a PlayCanvas upgrade renaming it should quietly cost
            // the constraint, not throw on every page load.
            const centers = asset.resource && asset.resource._centers;
            if (centers instanceof Float32Array) {
              this.floorY = detectFloorY(centers, 0, 0, this.targetRadius);
            }
          }
          // The opening angle is only checkable once the floor is known.
          this.targetPolar = Math.min(this.targetPolar, this.maxPolarFor(this.targetRadius));
          this.polarSpring.value = this.targetPolar;
          this.polarSpring.velocity = 0;
          resolve();
        });
        asset.once("error", (err) => reject(new Error(`failed to load '${sogUrl}': ${err}`)));
        app.assets.add(asset);
        app.assets.load(asset);
      });

      if (this.loadingEl) this.loadingEl.classList.add("hidden");
      this.attachInput();
      app.on("update", this.handleUpdate);
      app.start();
      this.startAutoSpin();
    }

    // Largest polar angle that still keeps the camera above the floor at this
    // radius. Radius-dependent, so it can't be a constant: an angle that
    // clears the floor up close dips under it once zoomed out, the camera
    // swinging on a bigger sphere around the same pivot.
    maxPolarFor(radius) {
      if (this.floorY === null || radius <= 0) return MAX_POLAR;
      const cosLimit = (this.floorY + FLOOR_CLEARANCE) / radius;
      if (cosLimit <= -1) return MAX_POLAR;
      if (cosLimit >= 1) return MIN_POLAR;
      return Math.min(MAX_POLAR, Math.acos(cosLimit));
    }

    // Match the render resolution to the space the canvas actually occupies.
    // The markup's width/height attributes are a square placeholder, but the
    // panel is only square above 640px -- below that it's sized against the
    // viewport, so rendering the attribute size both stretches the image and
    // burns pixels that are then scaled away. Read the box instead.
    sizeCanvas() {
      if (!this.app) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return; // laid out but not displayed
      const cap = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
        ? MOBILE_MAX_DEVICE_PIXEL_RATIO
        : MAX_DEVICE_PIXEL_RATIO;
      const ratio = Math.min(window.devicePixelRatio || 1, cap);
      this.app.setCanvasResolution(
        pc.RESOLUTION_FIXED,
        Math.max(1, Math.round(rect.width * ratio)),
        Math.max(1, Math.round(rect.height * ratio)),
      );
    }

    destroy() {
      window.removeEventListener("resize", this.handleResize);
      window.removeEventListener("orientationchange", this.handleResize);
      this.detachInput();
      if (this.app) {
        this.app.off("update", this.handleUpdate);
        this.app.destroy();
        this.app = null;
      }
      this.cameraEntity = null;
      this.floorY = null;
      if (this.loadingEl) {
        this.loadingEl.textContent = "loading model…";
        this.loadingEl.classList.remove("hidden");
      }
    }

    detachInput() {
      this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
      window.removeEventListener("pointermove", this.handlePointerMove);
      window.removeEventListener("pointerup", this.handlePointerUp);
      this.canvas.removeEventListener("wheel", this.handleWheel);
      this.canvas.removeEventListener("touchstart", this.handleTouchStart);
      this.canvas.removeEventListener("touchmove", this.handleTouchMove);
      this.canvas.removeEventListener("touchend", this.handleTouchEnd);
    }

    handleResize() {
      this.sizeCanvas();
    }

    startAutoSpin() {
      // Gentle idle rotation until the visitor takes over -- makes the
      // panel read as alive without demanding interaction to see it move.
      this.autoSpin = true;
    }

    handleUpdate(dt) {
      if (!this.cameraEntity) return;
      if (this.autoSpin && !this.dragging) {
        this.targetAzimuth += dt * 0.12;
      }
      const azimuth = this.azimuthSpring.update(this.targetAzimuth, SPRING_STIFFNESS, dt);
      const rawPolar = this.polarSpring.update(this.targetPolar, SPRING_STIFFNESS, dt);
      const radius = this.radiusSpring.update(this.targetRadius, SPRING_STIFFNESS, dt);
      // Clamp the rendered pair, not just the targets: the polar and radius
      // springs settle independently, so even when both endpoints clear the
      // floor an in-between frame can dip under it.
      const polar = Math.min(rawPolar, this.maxPolarFor(radius));

      const x = radius * Math.sin(polar) * Math.sin(azimuth);
      const y = radius * Math.cos(polar);
      const z = radius * Math.sin(polar) * Math.cos(azimuth);
      this.cameraEntity.setPosition(x, y, z);
      this.cameraEntity.lookAt(0, 0, 0);
    }

    attachInput() {
      this.canvas.addEventListener("pointerdown", this.handlePointerDown);
      window.addEventListener("pointermove", this.handlePointerMove);
      window.addEventListener("pointerup", this.handlePointerUp);
      this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
      this.canvas.addEventListener("touchstart", this.handleTouchStart, { passive: false });
      this.canvas.addEventListener("touchmove", this.handleTouchMove, { passive: false });
      this.canvas.addEventListener("touchend", this.handleTouchEnd);
    }

    orbitBy(dx, dy) {
      this.autoSpin = false;
      this.targetAzimuth -= dx * ORBIT_SENSITIVITY;
      this.targetPolar = clamp(
        this.targetPolar - dy * ORBIT_SENSITIVITY,
        MIN_POLAR,
        this.maxPolarFor(this.targetRadius),
      );
    }

    zoomBy(deltaRadius) {
      this.targetRadius = clamp(this.targetRadius + deltaRadius, MIN_RADIUS, MAX_RADIUS);
      // Zooming out swings the camera on a larger sphere, so an angle that
      // cleared the floor a moment ago may not any more.
      this.targetPolar = Math.min(this.targetPolar, this.maxPolarFor(this.targetRadius));
    }

    handlePointerDown(event) {
      this.dragging = true;
      this.autoSpin = false;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    }
    handlePointerMove(event) {
      if (!this.dragging || !this.lastPointer) return;
      this.orbitBy(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
      this.lastPointer = { x: event.clientX, y: event.clientY };
    }
    handlePointerUp() {
      this.dragging = false;
      this.lastPointer = null;
    }
    handleWheel(event) {
      event.preventDefault();
      this.autoSpin = false;
      this.zoomBy(event.deltaY * ZOOM_SENSITIVITY * this.targetRadius);
    }
    touchDistance(touches) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }
    handleTouchStart(event) {
      if (event.touches.length === 1) {
        // No preventDefault here: at this point it isn't known whether the
        // reader means to turn the model or scroll past it, and cancelling
        // the touch upfront would rule out the second. autoSpin also keeps
        // running until they commit, so merely touching while scrolling
        // doesn't freeze the model.
        this.dragging = true;
        this.touchIntent = null;
        this.touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        this.lastPointer = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      } else if (event.touches.length === 2) {
        event.preventDefault();
        this.autoSpin = false;
        this.dragging = false;
        this.touchIntent = "orbit";
        this.pinchStartDistance = this.touchDistance(event.touches);
        this.pinchStartRadius = this.targetRadius;
      }
    }
    handleTouchMove(event) {
      if (event.touches.length === 1 && this.dragging && this.lastPointer) {
        const touch = event.touches[0];

        if (this.touchIntent === null && this.touchStart) {
          const dx = Math.abs(touch.clientX - this.touchStart.x);
          const dy = Math.abs(touch.clientY - this.touchStart.y);
          if (Math.max(dx, dy) < TOUCH_GESTURE_THRESHOLD_PX) return;
          // Mostly sideways means they want to turn it; anything else is a
          // scroll, and stays the browser's to handle.
          this.touchIntent = dx > dy ? "orbit" : "scroll";
          if (this.touchIntent === "orbit") this.autoSpin = false;
          // Restart the delta from here so the model doesn't jump by the
          // threshold distance the moment the gesture is recognised.
          this.lastPointer = { x: touch.clientX, y: touch.clientY };
        }
        if (this.touchIntent !== "orbit") return;

        event.preventDefault();
        this.orbitBy(touch.clientX - this.lastPointer.x, touch.clientY - this.lastPointer.y);
        this.lastPointer = { x: touch.clientX, y: touch.clientY };
      } else if (event.touches.length === 2 && this.pinchStartDistance !== null) {
        event.preventDefault();
        const distance = this.touchDistance(event.touches);
        this.targetRadius = clamp(
          this.pinchStartRadius * (this.pinchStartDistance / distance),
          MIN_RADIUS,
          MAX_RADIUS,
        );
        this.targetPolar = Math.min(this.targetPolar, this.maxPolarFor(this.targetRadius));
      }
    }
    handleTouchEnd(event) {
      if (event.touches.length === 0) {
        this.dragging = false;
        this.lastPointer = null;
        this.pinchStartDistance = null;
        this.touchIntent = null;
        this.touchStart = null;
      }
    }
  }

  // The one live demo, if any. Recreating one re-decodes the model, but the
  // file itself comes from the HTTP cache, so returning to a viewer costs
  // decode time rather than another download.
  let live = null;

  function retire() {
    if (!live) return;
    live.demo.destroy();
    delete live.surface.dataset.started;
    live = null;
  }

  function start(surface) {
    if (surface.dataset.started) return;
    surface.dataset.started = "1";

    const canvas = surface.querySelector("canvas");
    const loadingEl = surface.querySelector(".demo-loading");
    const sogUrl = surface.dataset.sog;
    const radius = parseFloat(surface.dataset.radius || "2.0");
    if (!canvas || !sogUrl) return;

    const number = (name) => {
      const raw = surface.dataset[name];
      if (raw === undefined) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };
    const demo = new SplatDemo(canvas, surface, loadingEl, radius, {
      azimuth: number("azimuth"),
      polar: number("polar"),
      floor: surface.dataset.floor || null,
    });
    // Free the previous context BEFORE claiming a new one -- overlapping two
    // even briefly is what breaks every viewer on the page, so this can't
    // wait until the new one has finished initialising.
    retire();
    live = { demo, surface };

    demo.load(sogUrl).catch((err) => {
      console.error("[voxel-demo] failed to load splat", err);
      if (loadingEl) loadingEl.textContent = "3D preview unavailable in this browser";
    });
  }

  function boot() {
    const surfaces = Array.from(document.querySelectorAll("[data-sog]"));
    if (!surfaces.length) return;

    // Lazy-init on intersection, which is what the page itself claims the
    // embed does — spinning up a WebGPU context and decoding a multi-MB
    // splat for a viewer that's still below the fold is exactly the LCP cost
    // the copy promises not to charge. Also keeps two contexts from
    // initialising simultaneously on load.
    if (!("IntersectionObserver" in window)) {
      surfaces.forEach(start);
      return;
    }
    // Ratios rather than a bare "is it intersecting": with only one context
    // to give out, two panels overlapping during a scroll would otherwise
    // hand it back and forth every few frames. Whoever occupies more of the
    // viewport wins, and a tie changes nothing.
    const visibility = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visibility.set(entry.target, entry.intersectionRatio));
        let best = null;
        let bestRatio = 0;
        visibility.forEach((ratio, surface) => {
          if (ratio > bestRatio) {
            best = surface;
            bestRatio = ratio;
          }
        });
        if (!best || best.dataset.started) return;
        start(best);
      },
      { threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] },
    );
    surfaces.forEach((s) => observer.observe(s));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
