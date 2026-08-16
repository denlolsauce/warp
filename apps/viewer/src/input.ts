import { isMobileViewport, VirtualJoystick } from "./virtualJoystick";

const LOOK_SENSITIVITY_DEG_PER_PX = 0.15;
const MAX_PITCH_DEG = 70;
// Touch gets a wider tap tolerance than mouse — fingers are less precise
// than a cursor, so the mouse's threshold misfires easily on touch (an
// intended look-drag reads as a tap-walk, or vice versa).
const TAP_MAX_MOVEMENT_PX_MOUSE = 8;
const TAP_MAX_MOVEMENT_PX_TOUCH = 16;
const TAP_MAX_DURATION_MS = 400;
const MOMENTUM_FRICTION_PER_S = 6; // exponential decay rate applied to look velocity after release

// Physical-key `code` (e.g. "KeyW") is preferred since it's layout- and
// shift-independent, but not every input source populates it reliably —
// confirmed empirically: this app's own automated test harness dispatches
// keydown with code:"" and only `key` set. Fall back to `key` so both work.
export function normalizeKey(event: KeyboardEvent): string {
  if (event.code) return event.code;
  return event.key.length === 1 ? `Key${event.key.toUpperCase()}` : event.key;
}

export interface TapPoint {
  x: number;
  y: number;
}

export class InputState {
  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly activePointers = new Set<number>();

  private dragPointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastMoveTime = 0;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private downPointerType = "mouse";
  private movedPx = 0;

  private yawVelocity = 0;
  private pitchVelocity = 0;
  private pendingTap: TapPoint | null = null;
  private readonly joystick: VirtualJoystick | null;

  yaw: number;
  pitch = 0;

  constructor(canvas: HTMLCanvasElement, initialYaw = 0) {
    this.canvas = canvas;
    this.yaw = initialYaw;

    // Touch gestures are handled entirely through our own pointer-event
    // logic (one finger looks, two fingers are ignored) — suppress the
    // browser's native pinch-zoom/pan/double-tap-zoom so it can't fight it.
    this.canvas.style.touchAction = "none";

    // Mobile has no keyboard, so it's otherwise limited to tap-to-walk with
    // no continuous free-roam equivalent to WASD. Lives on its own DOM
    // element (see virtualJoystick.ts) so its touches never reach the
    // canvas's own pointer handling below.
    this.joystick = isMobileViewport() ? new VirtualJoystick(canvas.parentElement ?? document.body) : null;

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(normalizeKey(event));
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(normalizeKey(event));
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.activePointers.add(event.pointerId);

    // A second finger landing mid-drag spoils the whole gesture — two
    // fingers must do nothing (no pinch-zoom), not just stop updating look.
    // Nothing resumes until every pointer lifts and a fresh single touch
    // begins (dragPointerId only gets set below, on a 0->1 transition).
    if (this.activePointers.size > 1) {
      this.dragPointerId = null;
      return;
    }

    this.dragPointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastMoveTime = performance.now();
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = this.lastMoveTime;
    this.downPointerType = event.pointerType;
    this.movedPx = 0;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.movedPx += Math.hypot(dx, dy);

    const yawDelta = -dx * LOOK_SENSITIVITY_DEG_PER_PX;
    const pitchDelta = -dy * LOOK_SENSITIVITY_DEG_PER_PX;
    this.yaw += yawDelta;
    this.pitch = Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, this.pitch + pitchDelta));

    // Velocity from this move alone (not averaged over the whole drag) so a
    // flick's momentum reflects how the drag ended, not how it began.
    const now = performance.now();
    const dt = Math.max((now - this.lastMoveTime) / 1000, 1 / 240);
    this.yawVelocity = yawDelta / dt;
    this.pitchVelocity = pitchDelta / dt;
    this.lastMoveTime = now;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;

    const heldMs = performance.now() - this.downTime;
    const tapThreshold =
      this.downPointerType === "touch" ? TAP_MAX_MOVEMENT_PX_TOUCH : TAP_MAX_MOVEMENT_PX_MOUSE;
    if (this.movedPx <= tapThreshold && heldMs <= TAP_MAX_DURATION_MS) {
      this.pendingTap = { x: event.clientX, y: event.clientY };
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
    }
  };

  // Advances look-momentum decay after a drag release. Called once per
  // frame by the camera controller, using the same dt as everything else.
  applyMomentum(dt: number): void {
    if (this.dragPointerId !== null) return; // actively dragging — momentum doesn't apply yet
    if (this.yawVelocity === 0 && this.pitchVelocity === 0) return;

    this.yaw += this.yawVelocity * dt;
    this.pitch = Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, this.pitch + this.pitchVelocity * dt));

    const decay = Math.exp(-MOMENTUM_FRICTION_PER_S * dt);
    this.yawVelocity *= decay;
    this.pitchVelocity *= decay;
    if (Math.abs(this.yawVelocity) < 0.01) this.yawVelocity = 0;
    if (Math.abs(this.pitchVelocity) < 0.01) this.pitchVelocity = 0;
  }

  // Returns and clears a pending tap (click/tap that didn't turn into a
  // drag), if one occurred since the last call.
  consumeTap(): TapPoint | null {
    const tap = this.pendingTap;
    this.pendingTap = null;
    return tap;
  }

  get forwardInput(): number {
    let value = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) value += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) value -= 1;
    if (this.joystick) value += this.joystick.forwardInput;
    return Math.max(-1, Math.min(1, value));
  }

  get strafeInput(): number {
    let value = 0;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) value += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) value -= 1;
    if (this.joystick) value += this.joystick.strafeInput;
    return Math.max(-1, Math.min(1, value));
  }

  destroy(): void {
    this.keys.clear();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    this.joystick?.destroy();
  }
}
