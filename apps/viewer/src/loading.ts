const OVERLAY_STYLE = `
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(10, 10, 12, 0.92);
  color: #e8e8ea;
  font: 14px/1.4 system-ui, sans-serif;
  z-index: 10;
  transition: opacity 0.25s ease;
`;

const BAR_TRACK_STYLE = `
  width: 240px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
`;

const BAR_FILL_STYLE = `
  height: 100%;
  width: 0%;
  background: #e8e8ea;
  transition: width 0.15s ease;
`;

export class LoadingOverlay {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly barFillEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.setAttribute("style", OVERLAY_STYLE);

    this.statusEl = document.createElement("div");
    this.statusEl.textContent = "Loading…";

    const track = document.createElement("div");
    track.setAttribute("style", BAR_TRACK_STYLE);

    this.barFillEl = document.createElement("div");
    this.barFillEl.setAttribute("style", BAR_FILL_STYLE);
    track.appendChild(this.barFillEl);

    this.root.appendChild(this.statusEl);
    this.root.appendChild(track);

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(this.root);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setProgress(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.barFillEl.style.width = `${(clamped * 100).toFixed(1)}%`;
  }

  showError(message: string): void {
    this.statusEl.textContent = `Failed to load: ${message}`;
    this.statusEl.style.color = "#ff6b6b";
  }

  hide(): void {
    this.root.style.opacity = "0";
    this.root.addEventListener(
      "transitionend",
      () => {
        this.root.style.display = "none";
      },
      { once: true },
    );
  }

  destroy(): void {
    this.root.remove();
  }
}
