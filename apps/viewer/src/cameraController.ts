import * as pc from "playcanvas";
import type { SceneManifest } from "@portal/schema";
import { InputState, type TapPoint } from "./input";
import {
  buildNavGraph,
  clampToTube,
  findPath,
  nearestNode,
  projectOntoNearestEdge,
  RouteSpline,
  type NavGraph,
  type Point2,
} from "./navigation";
import { Spring1D } from "./springDamper";

const MOVE_SPEED_M_S = 1.4;
const TUBE_MAX_DEVIATION_M = 0.6; // hard lateral clamp off the nearest nav edge
const EYE_HEIGHT_M = 1.6;
const CAMERA_SPRING_STIFFNESS = 120; // higher = snappier; damping ratio is always 1.0 (see springDamper.ts)
const WALK_TO_DURATION_S = 0.8;
const MAX_DT_S = 0.1; // guards against a huge single-frame jump after tab-backgrounding

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface WalkTo {
  spline: RouteSpline;
  elapsed: number;
}

// Movement is constrained to the recorded capture trajectory (nav.nodes/
// edges) — "the viewer camera is constrained to a tube around the SfM
// capture trajectory" (CLAUDE.md). Free-fly would let the camera wander to
// where the splat was never trained and quality collapses. Looking around
// is unconstrained; only position follows the tube.
export class PortalCameraController {
  private readonly graph: NavGraph;
  private readonly floorY: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputState;

  private targetX: number;
  private targetZ: number;
  private readonly springX: Spring1D;
  private readonly springZ: Spring1D;
  private readonly springYaw: Spring1D;
  private readonly springPitch: Spring1D;

  private walkTo: WalkTo | null = null;
  currentNodeIndex: number;

  constructor(manifest: SceneManifest, canvas: HTMLCanvasElement, startPos: Point2, initialYaw: number) {
    this.graph = buildNavGraph(manifest.nav);
    this.floorY = manifest.floorY;
    this.canvas = canvas;

    this.targetX = startPos.x;
    this.targetZ = startPos.z;
    this.springX = new Spring1D(startPos.x);
    this.springZ = new Spring1D(startPos.z);
    this.springYaw = new Spring1D(initialYaw);
    this.springPitch = new Spring1D(0);

    this.input = new InputState(canvas, initialYaw);
    this.currentNodeIndex = nearestNode(this.graph, startPos);
  }

  update(dt: number, camera: pc.Entity): void {
    const clampedDt = Math.min(dt, MAX_DT_S);

    this.input.applyMomentum(clampedDt);

    const tap = this.input.consumeTap();
    if (tap) {
      this.startWalkTo(tap, camera);
    }

    if (this.walkTo) {
      // Deliberate movement input cancels an in-progress walk-to and hands
      // control straight back — pressing a key should respond immediately,
      // not wait out the animation.
      if (this.input.forwardInput !== 0 || this.input.strafeInput !== 0) {
        this.walkTo = null;
      } else {
        this.advanceWalkTo(clampedDt);
      }
    }

    if (!this.walkTo) {
      this.applyFreeMovement(clampedDt);
    }

    this.springX.update(this.targetX, CAMERA_SPRING_STIFFNESS, clampedDt);
    this.springZ.update(this.targetZ, CAMERA_SPRING_STIFFNESS, clampedDt);
    this.springYaw.update(this.input.yaw, CAMERA_SPRING_STIFFNESS, clampedDt);
    this.springPitch.update(this.input.pitch, CAMERA_SPRING_STIFFNESS, clampedDt);

    this.currentNodeIndex = nearestNode(this.graph, { x: this.springX.value, z: this.springZ.value });

    // Eye height is locked to floorY + 1.6, independent of look direction —
    // never sprung, so the invariant holds exactly on every frame rather
    // than converging toward it.
    camera.setPosition(this.springX.value, this.floorY + EYE_HEIGHT_M, this.springZ.value);
    camera.setEulerAngles(this.springPitch.value, this.springYaw.value, 0);
  }

  private applyFreeMovement(dt: number): void {
    const { forwardInput, strafeInput } = this.input;
    if (forwardInput === 0 && strafeInput === 0) return;

    // Empirically verified against PlayCanvas's actual setEulerAngles(pitch,
    // yaw, 0) behavior (read back via getWorldTransform): at yaw=0 the
    // camera faces (0,0,-1), and forward = (-sin(yaw), 0, -cos(yaw)) —
    // not (sin(yaw), 0, -cos(yaw)), which is the mirror image and was
    // walking the camera backward off the start of the recorded path.
    const yawRad = this.input.yaw * pc.math.DEG_TO_RAD;
    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);

    let dx = forwardX * forwardInput + rightX * strafeInput;
    let dz = forwardZ * forwardInput + rightZ * strafeInput;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }

    const desired: Point2 = {
      x: this.targetX + dx * MOVE_SPEED_M_S * dt,
      z: this.targetZ + dz * MOVE_SPEED_M_S * dt,
    };

    const projection = projectOntoNearestEdge(this.graph, desired);
    const clamped = clampToTube(desired, projection.point, TUBE_MAX_DEVIATION_M);
    this.targetX = clamped.x;
    this.targetZ = clamped.z;
  }

  private startWalkTo(screenPos: TapPoint, camera: pc.Entity): void {
    const cameraComponent = camera.camera;
    if (!cameraComponent) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = screenPos.x - rect.left;
    const y = screenPos.y - rect.top;

    const near = cameraComponent.screenToWorld(x, y, cameraComponent.nearClip);
    const far = cameraComponent.screenToWorld(x, y, cameraComponent.farClip);

    const dy = far.y - near.y;
    if (Math.abs(dy) < 1e-6) return; // ray parallel to the floor plane — no ground hit
    const t = (this.floorY - near.y) / dy;
    if (t < 0) return; // floor plane is behind the camera along this ray

    const hit: Point2 = { x: near.x + t * (far.x - near.x), z: near.z + t * (far.z - near.z) };

    const startIndex = nearestNode(this.graph, { x: this.targetX, z: this.targetZ });
    const goalIndex = nearestNode(this.graph, hit);
    const routeNodes = findPath(this.graph, startIndex, goalIndex);

    const waypoints: Point2[] = [
      { x: this.targetX, z: this.targetZ },
      ...routeNodes.map((i) => this.graph.positions[i]),
    ];
    this.walkTo = { spline: new RouteSpline(waypoints), elapsed: 0 };
  }

  private advanceWalkTo(dt: number): void {
    if (!this.walkTo) return;
    this.walkTo.elapsed += dt;
    const progress = Math.min(this.walkTo.elapsed / WALK_TO_DURATION_S, 1);
    const sample = this.walkTo.spline.sampleAtFraction(easeInOutCubic(progress));

    this.targetX = sample.x;
    this.targetZ = sample.z;

    if (progress >= 1) {
      this.walkTo = null;
    }
  }

  destroy(): void {
    this.input.destroy();
  }
}
