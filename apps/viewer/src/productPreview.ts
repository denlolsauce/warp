import * as pc from "playcanvas";
import { createDevice } from "./device";
import { Spring1D } from "./springDamper";

// A minimal orbit viewer for a single product SOG — deliberately bypasses
// PortalViewer entirely rather than reusing it: that viewer's camera
// (cameraController.ts) is a first-person walker with hardcoded room-scale
// constants (EYE_HEIGHT_M = 1.6, tube deviation in metres) driven by a
// manifest.nav path, none of which make sense for a single object
// normalised to ~1 unit across (cleanup.py's TARGET_LONGEST_DIMENSION).
// This is a stopgap for looking at pipeline output, not CLAUDE.md's
// eventual production product viewer (no progressive load, no poster
// image, no WebGL2-unavailable fallback, no lazy-init observer) — those
// need the new product-manifest schema CLAUDE.md's Repo layout section
// already flags as not built yet.
//
// Two camera modes, not one, because an isolated ~1-unit product and a
// room-scale raw capture (cleanup.py's dilate/solidify steps exist
// precisely because that raw output is real content, not just debris —
// see pipeline/README.md) aren't the same kind of thing to look at. Orbit
// (default) fixes a look-at target and moves the camera on a sphere around
// it, which only makes sense when there's one clear subject a fixed
// distance away. Fly drops that assumption entirely: free yaw/pitch plus
// WASD translation in the camera's own local space, the same scheme
// PlayCanvas's own examples/camera/fly-camera.js script uses (ported by
// hand here rather than pulled in via pc.createScript, which needs the
// full script-component subsystem this minimal viewer never sets up).

const MIN_POLAR = 0.05 * Math.PI; // keep just short of the poles — avoids gimbal-lock disorientation
const MAX_POLAR = 0.95 * Math.PI;
const MIN_RADIUS = 0.2;
const MAX_RADIUS = 8;

// How far above the detected floor the camera is held. Scene units, where
// cleanup.py normalises a product's longest dimension to ~1 — so this is a
// couple of percent of the subject, enough to keep the near plane from
// grazing the floor slab without visibly raising the lowest usable angle.
const FLOOR_CLEARANCE = 0.02;
// Floor detection (see detectFloorY): a real floor is a thin horizontal slab
// of gaussians with near-vacuum beneath it, which shows up as a dominant
// spike in a histogram of height. These are the tests that separate that
// from an ordinary dense region partway up the scene.
const FLOOR_HISTOGRAM_BINS = 64;
const FLOOR_SPIKE_RATIO = 3.0; // peak bin must be this many times the typical occupied bin
// At most this fraction of the column may sit under the peak. Calibrated
// against chair.mp4's raw capture, where a correctly-found floor scores
// 0.06-0.10 (a raw capture really does have some floater mass underneath)
// while a wrongly-chosen peak — the mid-height wall mass picked up when the
// column is too wide, or the seat itself when it's too narrow — scores
// 0.43-0.57. The gap between those two regimes is wide, so this sits in the
// middle of it rather than close to either.
const FLOOR_MAX_MASS_BELOW = 0.15;
// Column half-width, as a fraction of the orbit radius. This has to cover
// everywhere the camera can actually get to, not just the subject's own
// footprint: the floor is never perfectly level relative to the alignment's
// up-axis (1.1 degrees off on chair.mp4), so a bound measured only under the
// subject sits below the floor out at the edge of the orbit.
const FLOOR_COLUMN_RADIUS_FRACTION = 1.0;
// Thickness of the floor slab, as a fraction of the column's height range.
// Relative rather than absolute so it means the same thing at any scene
// scale — and NOT a bin count, which shrinks with the histogram range and so
// picks out a different physical thickness on every capture.
const FLOOR_SLAB_THICKNESS_FRACTION = 0.05;
// Where the floor's *surface* sits within that slab. Gaussian centres near a
// floor scatter through a slab of real thickness, and what a viewer sees is
// the top of it, not the middle — measured on chair.mp4, the plane through
// the slab's centre of mass runs ~0.04 below the surface, which is exactly
// the gap that let the camera end up under the floor.
const FLOOR_SURFACE_RESIDUAL_PERCENTILE = 0.9;
const ORBIT_SENSITIVITY = 0.008; // radians per pixel dragged
const ZOOM_SENSITIVITY = 0.0015; // per wheel-delta-y pixel
const SPRING_STIFFNESS = 140;

const LOOK_SENSITIVITY = 0.15; // degrees per pixel dragged, fly mode
const MAX_PITCH_DEGREES = 89; // short of vertical — 90 is a real gimbal flip, not just disorientation
const DEFAULT_FLY_SPEED = 1.5; // scene units/second — see load()'s flySpeed option to override per capture
const FLY_SPEED_BOOST = 4; // Shift multiplier, matching fly-camera.js's fastSpeed/speed ratio
const FLY_WHEEL_SENSITIVITY = 0.0015; // dolly units per wheel-delta-y pixel, scaled by current speed

export type ViewMode = "orbit" | "fly";

export interface LoadOptions {
  mode?: ViewMode;
  // Starting camera placement, shared by both modes: orbit begins here and
  // stays on this sphere; fly begins here, looking at the pivot, then
  // moves freely — see LOAD.md's "reuse the same spherical math so a
  // decent orbit vantage is also a decent fly-mode starting point" idea.
  startAzimuth?: number;
  startPolar?: number;
  startRadius?: number;
  // What orbit mode circles and both modes initially look at. Defaults to
  // the origin, which is only "the product" when cleanup actually isolated
  // one — a capture where background removal failed (see
  // is_plausible_support_surface's docstring) can leave the alignment
  // centroid pulled toward room mass instead, off-center from the product
  // a viewer actually cares about. Overriding this is how you re-center on
  // the real subject without re-running cleanup.
  pivotX?: number;
  pivotY?: number;
  pivotZ?: number;
  // Fly mode only. Room-scale raw captures and ~1-unit cleaned products
  // don't want the same speed; there's no single right default.
  flySpeed?: number;
  // Height of the floor plane, in scene units. When set, the camera is kept
  // above it in both modes — CLAUDE.md's "constrained polar angle so users
  // can't fly under the floor". Pass a number for a known height, or "auto"
  // to detect it from the splat (see detectFloorY).
  //
  // Omitted means no constraint, deliberately: this is opt-in per capture
  // rather than on by default. A capture whose floor detection is wrong
  // would silently lose orbit range with no obvious cause, which is a worse
  // failure than simply not having the constraint — and a cleaned product
  // has no floor to speak of anyway, cleanup.py having removed the support
  // surface outright.
  //
  // Opting in per call is a stopgap for where this should really come from:
  // the product-manifest schema CLAUDE.md's Repo layout section flags as not
  // built yet is the right home for a floor/bounds field, since cleanup.py
  // already knows exactly where the support surface is whenever its RANSAC
  // fit passes the plausibility gate.
  floorY?: number | "auto";
}

/** Cheap percentile over an unsorted array, via a copy-and-sort. */
function percentile(sorted: Float64Array | number[], q: number): number {
  const index = Math.floor(q * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

/**
 * Find the floor height in a splat, or null if there isn't a convincing one.
 *
 * A floor is a thin horizontal slab with near-vacuum beneath it, so it shows
 * up as a dominant spike in a histogram of gaussian height. Two things this
 * deliberately does NOT do, both because they were measured against a real
 * capture (chair.mp4's raw 600k-gaussian output) and found useless:
 *
 *  - Use the asset's own AABB. Its min was y = -2567 on that capture, driven
 *    by a handful of far-flung scale outliers. Bounds are worthless here.
 *  - Take a low percentile of all heights. That capture's heights are
 *    heavy-tailed at BOTH ends (p5 = -0.76, p95 = +1.37) — floaters scatter
 *    in every direction, so a low quantile measures floater spread, not a
 *    floor.
 *
 * What does work is a narrow column centred on the pivot — the subject the
 * viewer is actually about — and looking for the density spike within it. A
 * robust horizontal percentile is NOT a substitute for that, also measured:
 * on the chair capture p10..p90 of x spans -2.26..2.60, i.e. the whole room,
 * and the peak then lands on mid-height wall mass rather than the floor.
 *
 * The spike tests are what make this safe to run by default. A scene with no
 * floor in it — a product cleanup fully isolated, floating in nothing — has
 * no such spike, fails the tests, and gets no constraint rather than a
 * fabricated one. The same tests also catch a badly-sized column: too narrow
 * on the chair capture and the peak becomes the seat, which the mass-below
 * test rejects outright rather than returning a floor at chair height.
 */
export function detectFloorY(
  centers: Float32Array,
  pivotX: number,
  pivotZ: number,
  columnHalfWidth: number,
): number | null {
  const count = Math.floor(centers.length / 3);
  if (count < 1000) return null; // too few to say anything about density
  if (!(columnHalfWidth > 0)) return null;

  const column: number[] = [];
  const columnIndex: number[] = [];
  for (let i = 0; i < count; i++) {
    if (Math.abs(centers[i * 3] - pivotX) > columnHalfWidth) continue;
    if (Math.abs(centers[i * 3 + 2] - pivotZ) > columnHalfWidth) continue;
    column.push(centers[i * 3 + 1]);
    columnIndex.push(i);
  }
  if (column.length < 1000) return null;
  const sortedColumn = Float64Array.from(column).sort();

  // Vertical range from the column's own percentiles, not the whole scene's:
  // the histogram should resolve the subject's own height range, and a
  // handful of extreme floaters would otherwise stretch it until the floor
  // slab and everything else share a single bin.
  const yLow = percentile(sortedColumn, 0.01);
  const yHigh = percentile(sortedColumn, 0.99);
  if (!(yHigh > yLow)) return null;

  const bins = new Int32Array(FLOOR_HISTOGRAM_BINS);
  const binWidth = (yHigh - yLow) / FLOOR_HISTOGRAM_BINS;
  let inColumn = 0;
  for (const y of column) {
    if (y < yLow || y > yHigh) continue;
    const bin = Math.min(FLOOR_HISTOGRAM_BINS - 1, Math.floor((y - yLow) / binWidth));
    bins[bin]++;
    inColumn++;
  }
  if (inColumn < 1000) return null;

  let peak = 0;
  for (let b = 1; b < FLOOR_HISTOGRAM_BINS; b++) {
    if (bins[b] > bins[peak]) peak = b;
  }

  // Is the peak actually a spike, or just the tallest part of a broad mass?
  const occupied = Array.from(bins).filter((n) => n > 0).sort((a, b) => a - b);
  const typical = occupied[Math.floor(0.5 * (occupied.length - 1))] || 1;
  if (bins[peak] < FLOOR_SPIKE_RATIO * typical) return null;

  let below = 0;
  for (let b = 0; b < peak; b++) below += bins[b];
  if (below / inColumn > FLOOR_MAX_MASS_BELOW) return null;

  // The peak locates the floor; it is not itself a safe bound to stand on.
  // Turning it into one means answering two separate questions, both of
  // which were measured putting the camera under the floor when skipped:
  //   1. Which way does the floor slope? The alignment's up-axis is never
  //      exact, so the floor tilts slightly and is higher on one side.
  //   2. Where in the slab is the surface? Centres scatter through a slab of
  //      real thickness and the visible surface is its top, not its middle.
  const peakY = yLow + (peak + 0.5) * binWidth;
  const slabThickness = FLOOR_SLAB_THICKNESS_FRACTION * (yHigh - yLow);

  const slabX: number[] = [];
  const slabY: number[] = [];
  const slabZ: number[] = [];
  for (let j = 0; j < column.length; j++) {
    if (Math.abs(column[j] - peakY) > slabThickness) continue;
    const i = columnIndex[j];
    slabX.push(centers[i * 3]);
    slabY.push(column[j]);
    slabZ.push(centers[i * 3 + 2]);
  }
  if (slabX.length < 100) return peakY;

  // Least-squares fit of y = a*x + b*z + d over the slab. Safe in this form
  // precisely because the surface is near-horizontal by construction — the
  // slab was found by looking for a horizontal density spike in the first
  // place, so it can never be near-vertical here.
  const n = slabX.length;
  let meanX = 0;
  let meanY = 0;
  let meanZ = 0;
  for (let j = 0; j < n; j++) {
    meanX += slabX[j];
    meanY += slabY[j];
    meanZ += slabZ[j];
  }
  meanX /= n;
  meanY /= n;
  meanZ /= n;

  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let j = 0; j < n; j++) {
    const dx = slabX[j] - meanX;
    const dz = slabZ[j] - meanZ;
    const dy = slabY[j] - meanY;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  if (det === 0) return peakY; // degenerate footprint — no slope to recover
  const slopeX = (szz * sxy - sxz * szy) / det;
  const slopeZ = (sxx * szy - sxz * sxy) / det;
  const planeAtPivot = meanY - slopeX * meanX - slopeZ * meanZ;

  const residuals = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    residuals[j] = slabY[j] - (slopeX * slabX[j] + slopeZ * slabZ[j] + planeAtPivot);
  }
  residuals.sort();
  const surfaceOffset = percentile(residuals, FLOOR_SURFACE_RESIDUAL_PERCENTILE);

  // Take the plane at its highest over the whole column, so the bound holds
  // at every azimuth rather than only where the camera happens to start.
  const tiltRise = (Math.abs(slopeX) + Math.abs(slopeZ)) * columnHalfWidth;
  return planeAtPivot + surfaceOffset + tiltRise;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class ProductPreview {
  private readonly canvas: HTMLCanvasElement;
  private app: pc.AppBase | null = null;
  private cameraEntity: pc.Entity | null = null;
  private mode: ViewMode = "orbit";
  private flySpeed = DEFAULT_FLY_SPEED;
  private pivot = new pc.Vec3(0, 0, 0);
  private floorY: number | null = null;

  private targetAzimuth = 0;
  private targetPolar = Math.PI / 2.4; // slightly above eye level
  private targetRadius = 2.2;
  private readonly azimuthSpring = new Spring1D(0);
  private readonly polarSpring = new Spring1D(Math.PI / 2.4);
  private readonly radiusSpring = new Spring1D(2.2);

  // Fly mode's own orientation state — plain yaw/pitch, no spring damping.
  // The spring exists in orbit mode to smooth *snapping back* after a drag
  // ends; fly mode's camera has no rest position to snap back to, so
  // damping it would only add lag to direct look input.
  private flyYaw = 0;
  private flyPitch = 0;

  private dragging = false;
  private lastPointer: { x: number; y: number } | null = null;
  private pinchStartDistance: number | null = null;
  private pinchStartRadius = 2.2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async load(sogUrl: string, options: LoadOptions = {}): Promise<void> {
    this.destroy();

    this.mode = options.mode ?? "orbit";
    this.flySpeed = options.flySpeed ?? DEFAULT_FLY_SPEED;
    this.pivot = new pc.Vec3(options.pivotX ?? 0, options.pivotY ?? 0, options.pivotZ ?? 0);
    const startAzimuth = options.startAzimuth ?? 0;
    const startPolar = options.startPolar ?? Math.PI / 2.4;
    const startRadius = options.startRadius ?? 2.2;

    this.targetAzimuth = startAzimuth;
    this.targetPolar = startPolar;
    this.targetRadius = startRadius;
    this.azimuthSpring.reset(startAzimuth);
    this.polarSpring.reset(startPolar);
    this.radiusSpring.reset(startRadius);

    const device = await createDevice(this.canvas);
    // keyboard is only read in fly mode, but harmless (and cheap) to
    // attach unconditionally rather than threading "which mode" through
    // Application construction too.
    const app = new pc.Application(this.canvas, {
      graphicsDevice: device,
      keyboard: new pc.Keyboard(window),
    });
    this.app = app;

    // Must match TrainConfig.antialiased — see viewer.ts's identical comment.
    app.scene.gsplat.antiAlias = true;
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener("resize", this.handleResize);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.05, 0.05, 0.06) });
    app.root.addChild(camera);
    this.cameraEntity = camera;

    // Place the camera at the shared starting vantage, looking at the
    // pivot, for both modes — fly mode then reads pitch/yaw back off of
    // this lookAt() as its free-look starting orientation, rather than
    // duplicating the spherical-to-Euler math by hand.
    this.applyStartVantage(startAzimuth, startPolar, startRadius);

    await new Promise<void>((resolve, reject) => {
      const asset = new pc.Asset("product", "gsplat", { url: sogUrl });
      asset.once("load", () => {
        const entity = new pc.Entity("product");
        entity.addComponent("gsplat", { asset });
        app.root.addChild(entity);
        this.resolveFloor(options, asset);
        resolve();
      });
      asset.once("error", (err: string) => reject(new Error(`failed to load '${sogUrl}': ${err}`)));
      app.assets.add(asset);
      app.assets.load(asset);
    });

    // Only now is the floor known, so the starting vantage may itself be
    // below it (a caller-supplied startPolar, or a saved camera from before
    // detection existed). Pull it up rather than starting underground.
    this.targetPolar = clamp(this.targetPolar, MIN_POLAR, this.maxPolarFor(this.targetRadius));
    this.polarSpring.reset(this.targetPolar);
    this.applyStartVantage(this.targetAzimuth, this.targetPolar, this.targetRadius);

    this.attachInput();
    app.on("update", this.handleUpdate);
    app.start();
  }

  /**
   * No floor unless the caller asks for one — either by naming the height
   * or by asking for it to be detected.
   */
  private resolveFloor(options: LoadOptions, asset: pc.Asset): void {
    if (options.floorY === undefined) {
      this.floorY = null;
      return;
    }
    if (typeof options.floorY === "number") {
      this.floorY = options.floorY;
      return;
    }
    // `_centers` is private to the resource, so treat its absence as normal
    // rather than a bug — a PlayCanvas upgrade renaming it should quietly
    // cost the constraint, not throw on every load.
    const centers = (asset.resource as { _centers?: Float32Array } | null)?._centers;
    this.floorY =
      centers instanceof Float32Array
        ? detectFloorY(
            centers,
            this.pivot.x,
            this.pivot.z,
            this.targetRadius * FLOOR_COLUMN_RADIUS_FRACTION,
          )
        : null;
  }

  /**
   * The largest polar angle that still keeps the camera above the floor at
   * the given radius. Radius-dependent, so it can't be a constant: the same
   * angle that clears the floor up close dips under it once zoomed out,
   * because the camera swings on a bigger sphere around the same pivot.
   */
  private maxPolarFor(radius: number): number {
    if (this.floorY === null || radius <= 0) return MAX_POLAR;
    // Camera height is pivot.y + radius*cos(polar); require it above the
    // floor, and invert (acos decreases, so the bound on cos is a bound on
    // polar from above).
    const cosLimit = (this.floorY + FLOOR_CLEARANCE - this.pivot.y) / radius;
    if (cosLimit <= -1) return MAX_POLAR; // floor out of reach at this radius
    if (cosLimit >= 1) return MIN_POLAR; // pivot itself is under the floor
    return Math.min(MAX_POLAR, Math.acos(cosLimit));
  }

  private applyStartVantage(azimuth: number, polar: number, radius: number): void {
    const camera = this.cameraEntity;
    if (!camera) return;
    camera.setPosition(
      this.pivot.x + radius * Math.sin(polar) * Math.sin(azimuth),
      this.pivot.y + radius * Math.cos(polar),
      this.pivot.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.lookAt(this.pivot);
    const eulers = camera.getEulerAngles();
    this.flyPitch = eulers.x;
    this.flyYaw = eulers.y;
  }

  /** Debug/tooling accessor — not used by the viewer itself. */
  getFloorY(): number | null {
    return this.floorY;
  }

  destroy(): void {
    window.removeEventListener("resize", this.handleResize);
    this.detachInput();
    this.app?.destroy();
    this.app = null;
    this.cameraEntity = null;
  }

  private handleResize = (): void => {
    this.app?.resizeCanvas();
  };

  private handleUpdate = (dt: number): void => {
    if (!this.cameraEntity) return;
    if (this.mode === "fly") {
      this.updateFly(dt);
      return;
    }

    const azimuth = this.azimuthSpring.update(this.targetAzimuth, SPRING_STIFFNESS, dt);
    const rawPolar = this.polarSpring.update(this.targetPolar, SPRING_STIFFNESS, dt);
    const radius = this.radiusSpring.update(this.targetRadius, SPRING_STIFFNESS, dt);

    // Clamp the *rendered* pair, not just the targets. The polar and radius
    // springs settle independently, so even when both endpoints clear the
    // floor an in-between frame can combine a still-large polar with an
    // already-grown radius and dip under it — a brief flash of the scene's
    // underside that only shows up in motion.
    const polar = Math.min(rawPolar, this.maxPolarFor(radius));

    // Standard spherical -> Cartesian, polar measured from +Y (up), offset
    // by the pivot rather than fixed at the origin — see LoadOptions.pivotX
    // for why the two aren't always the same point.
    const x = this.pivot.x + radius * Math.sin(polar) * Math.sin(azimuth);
    const y = this.pivot.y + radius * Math.cos(polar);
    const z = this.pivot.z + radius * Math.sin(polar) * Math.cos(azimuth);
    this.cameraEntity.setPosition(x, y, z);
    this.cameraEntity.lookAt(this.pivot);
  };

  /** Debug/tooling accessor — not used by the viewer itself. */
  getCameraPosition(): pc.Vec3 | null {
    return this.cameraEntity?.getPosition() ?? null;
  }

  private updateFly(dt: number): void {
    const camera = this.cameraEntity;
    const keyboard = this.app?.keyboard;
    if (!camera || !keyboard) return;

    camera.setEulerAngles(this.flyPitch, this.flyYaw, 0);

    const speed = keyboard.isPressed(pc.KEY_SHIFT) ? this.flySpeed * FLY_SPEED_BOOST : this.flySpeed;
    const step = speed * dt;

    // -Z is forward in PlayCanvas's local space (matching fly-camera.js's
    // own convention) — translateLocal moves relative to the camera's
    // current facing, which is exactly what makes this "fly" rather than
    // "slide along fixed world axes".
    if (keyboard.isPressed(pc.KEY_W) || keyboard.isPressed(pc.KEY_UP)) camera.translateLocal(0, 0, -step);
    if (keyboard.isPressed(pc.KEY_S) || keyboard.isPressed(pc.KEY_DOWN)) camera.translateLocal(0, 0, step);
    if (keyboard.isPressed(pc.KEY_A) || keyboard.isPressed(pc.KEY_LEFT)) camera.translateLocal(-step, 0, 0);
    if (keyboard.isPressed(pc.KEY_D) || keyboard.isPressed(pc.KEY_RIGHT)) camera.translateLocal(step, 0, 0);
    // Vertical movement in world space, not local: local-Y would tilt
    // "up" toward wherever the camera happens to be pitched, which feels
    // wrong for a fly camera exploring a room (real up should stay real
    // up regardless of look direction).
    if (keyboard.isPressed(pc.KEY_SPACE)) camera.translate(0, step, 0);
    if (keyboard.isPressed(pc.KEY_C)) camera.translate(0, -step, 0);

    this.enforceFloor();
  }

  /**
   * Fly mode's floor. Orbit constrains the angle it derives a position from;
   * fly has no such angle, so the position is corrected directly — pinning
   * height while leaving the horizontal move intact, so walking into the
   * floor slides along it rather than stopping dead.
   */
  private enforceFloor(): void {
    if (this.floorY === null || !this.cameraEntity) return;
    const minY = this.floorY + FLOOR_CLEARANCE;
    const position = this.cameraEntity.getPosition();
    if (position.y < minY) {
      this.cameraEntity.setPosition(position.x, minY, position.z);
    }
  }

  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    this.canvas.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.handleTouchEnd);
  }

  private detachInput(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("touchstart", this.handleTouchStart);
    this.canvas.removeEventListener("touchmove", this.handleTouchMove);
    this.canvas.removeEventListener("touchend", this.handleTouchEnd);
  }

  private orbitBy(dx: number, dy: number): void {
    this.targetAzimuth -= dx * ORBIT_SENSITIVITY;
    this.targetPolar = clamp(
      this.targetPolar - dy * ORBIT_SENSITIVITY,
      MIN_POLAR,
      this.maxPolarFor(this.targetRadius),
    );
  }

  private lookBy(dx: number, dy: number): void {
    this.flyYaw -= dx * LOOK_SENSITIVITY;
    this.flyPitch = clamp(this.flyPitch - dy * LOOK_SENSITIVITY, -MAX_PITCH_DEGREES, MAX_PITCH_DEGREES);
  }

  private zoomBy(deltaRadius: number): void {
    this.targetRadius = clamp(this.targetRadius + deltaRadius, MIN_RADIUS, MAX_RADIUS);
    // Zooming out swings the camera on a larger sphere, so an angle that
    // cleared the floor a moment ago may not any more — re-clamp rather
    // than letting the zoom push the camera underground.
    this.targetPolar = Math.min(this.targetPolar, this.maxPolarFor(this.targetRadius));
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging || !this.lastPointer) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    if (this.mode === "fly") {
      this.lookBy(dx, dy);
    } else {
      this.orbitBy(dx, dy);
    }
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (): void => {
    this.dragging = false;
    this.lastPointer = null;
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.mode === "fly") {
      this.cameraEntity?.translateLocal(0, 0, event.deltaY * FLY_WHEEL_SENSITIVITY * this.flySpeed);
      this.enforceFloor();
    } else {
      this.zoomBy(event.deltaY * ZOOM_SENSITIVITY * this.targetRadius);
    }
  };

  private touchDistance(touches: TouchList): number {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  private handleTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    if (event.touches.length === 1) {
      this.dragging = true;
      this.lastPointer = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else if (event.touches.length === 2) {
      this.dragging = false;
      this.pinchStartDistance = this.touchDistance(event.touches);
      this.pinchStartRadius = this.targetRadius;
    }
  };

  private handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
    if (event.touches.length === 1 && this.dragging && this.lastPointer) {
      const touch = event.touches[0];
      const dx = touch.clientX - this.lastPointer.x;
      const dy = touch.clientY - this.lastPointer.y;
      if (this.mode === "fly") {
        this.lookBy(dx, dy);
      } else {
        this.orbitBy(dx, dy);
      }
      this.lastPointer = { x: touch.clientX, y: touch.clientY };
    } else if (event.touches.length === 2 && this.pinchStartDistance !== null) {
      const distance = this.touchDistance(event.touches);
      if (this.mode === "fly") {
        // No pinch-to-move-forward tracking needed: dolly by the *change*
        // in distance each event, same as a wheel tick, rather than
        // re-deriving an absolute target the way orbit's radius does.
        const previous = this.pinchStartDistance;
        this.cameraEntity?.translateLocal(0, 0, (previous - distance) * FLY_WHEEL_SENSITIVITY * 40 * this.flySpeed);
        this.enforceFloor();
        this.pinchStartDistance = distance;
      } else {
        // Pinch out (distance grows) should zoom in (radius shrinks) — inverse ratio.
        this.targetRadius = clamp(
          this.pinchStartRadius * (this.pinchStartDistance / distance),
          MIN_RADIUS,
          MAX_RADIUS,
        );
        this.targetPolar = Math.min(this.targetPolar, this.maxPolarFor(this.targetRadius));
      }
    }
  };

  private handleTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length === 0) {
      this.dragging = false;
      this.lastPointer = null;
      this.pinchStartDistance = null;
    }
  };
}
