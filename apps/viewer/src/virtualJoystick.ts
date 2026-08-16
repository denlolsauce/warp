const MOBILE_VIEWPORT_MAX_WIDTH_PX = 768;

// Touch capability alone over-triggers: plenty of touchscreen laptops are
// still mouse-and-keyboard-first, and would get an unwanted joystick and
// "no WASD" hint. Narrow viewport is the actual signal for "this is a
// phone/tablet, not a touch-capable desktop" — 768px matches this repo's
// own mobile breakpoint convention (see resize_window's mobile preset).
export function isMobileViewport(): boolean {
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return hasTouch && window.innerWidth < MOBILE_VIEWPORT_MAX_WIDTH_PX;
}

const PAD_SIZE_PX = 120;
const KNOB_SIZE_PX = 56;
const MAX_KNOB_OFFSET_PX = (PAD_SIZE_PX - KNOB_SIZE_PX) / 2;

// On-screen movement stick feeding InputState's forwardInput/strafeInput —
// mobile has no keyboard, so it's the only source of continuous free-roam
// movement there; tap-to-walk alone left touch users without a WASD
// equivalent. Lives as its own DOM element layered on the canvas rather
// than a canvas-drawn control, so its pointer events naturally hit-test to
// it instead of the canvas — no explicit coordination with InputState's own
// drag-to-look handling is needed.
export class VirtualJoystick {
  private readonly pad: HTMLElement;
  private readonly knob: HTMLElement;
  private pointerId: number | null = null;
  private padCenterX = 0;
  private padCenterY = 0;

  forwardInput = 0;
  strafeInput = 0;

  constructor(container: HTMLElement) {
    this.pad = document.createElement("div");
    this.pad.setAttribute(
      "style",
      `position:absolute;left:24px;bottom:24px;width:${PAD_SIZE_PX}px;height:${PAD_SIZE_PX}px;` +
        "border-radius:50%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);" +
        "touch-action:none;z-index:7;",
    );

    this.knob = document.createElement("div");
    this.knob.setAttribute(
      "style",
      `position:absolute;left:${(PAD_SIZE_PX - KNOB_SIZE_PX) / 2}px;top:${(PAD_SIZE_PX - KNOB_SIZE_PX) / 2}px;` +
        `width:${KNOB_SIZE_PX}px;height:${KNOB_SIZE_PX}px;border-radius:50%;` +
        "background:rgba(255,255,255,0.45);pointer-events:none;",
    );
    this.pad.appendChild(this.knob);
    container.appendChild(this.pad);

    this.pad.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return; // already tracking a finger
    this.pointerId = event.pointerId;
    const rect = this.pad.getBoundingClientRect();
    this.padCenterX = rect.left + rect.width / 2;
    this.padCenterY = rect.top + rect.height / 2;
    this.updateFromPointer(event.clientX, event.clientY);
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.updateFromPointer(event.clientX, event.clientY);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.forwardInput = 0;
    this.strafeInput = 0;
    this.knob.style.transform = "translate(0px, 0px)";
  };

  private updateFromPointer(clientX: number, clientY: number): void {
    let dx = clientX - this.padCenterX;
    let dy = clientY - this.padCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_KNOB_OFFSET_PX) {
      dx = (dx / dist) * MAX_KNOB_OFFSET_PX;
      dy = (dy / dist) * MAX_KNOB_OFFSET_PX;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    this.strafeInput = dx / MAX_KNOB_OFFSET_PX;
    this.forwardInput = -dy / MAX_KNOB_OFFSET_PX; // screen up = forward
  }

  destroy(): void {
    this.pad.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    this.pad.remove();
  }
}
