import { normalizeKey } from "./input";

export interface DebugStats {
  fps: number;
  renderer: string;
  splatCount: number;
  residentMB: number;
  navNodeIndex: number;
}

export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.setAttribute(
      "style",
      "position:absolute;top:12px;left:12px;padding:8px 10px;border-radius:4px;" +
        "background:rgba(10,10,12,0.7);color:#8fe38f;font:12px/1.5 ui-monospace,monospace;" +
        "white-space:pre;pointer-events:none;z-index:6;display:none;",
    );
    container.appendChild(this.el);

    window.addEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (normalizeKey(event) !== "KeyD") return;
    this.visible = !this.visible;
    this.el.style.display = this.visible ? "block" : "none";
  };

  update(stats: DebugStats): void {
    if (!this.visible) return;
    this.el.textContent =
      `FPS: ${stats.fps.toFixed(0)}\n` +
      `Renderer: ${stats.renderer}\n` +
      `Splats loaded: ${stats.splatCount}\n` +
      `Resident: ${stats.residentMB.toFixed(1)} MB\n` +
      `Nav node: ${stats.navNodeIndex}`;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.el.remove();
  }
}
