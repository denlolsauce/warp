export class LoadingOverlay {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private statusEl: HTMLElement;
  private progressEl: HTMLElement;
  private errorEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.overlay = document.createElement("div");
    this.overlay.setAttribute(
      "style",
      `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;` +
        `background:rgba(10,10,12,0.9);z-index:1000;flex-direction:column;`,
    );

    this.statusEl = document.createElement("div");
    this.statusEl.setAttribute(
      "style",
      `color:#e8e8ea;font:14px system-ui,sans-serif;margin-bottom:16px;text-align:center;`,
    );

    this.progressEl = document.createElement("div");
    this.progressEl.setAttribute(
      "style",
      `width:200px;height:4px;background:rgba(200,200,200,0.2);border-radius:2px;overflow:hidden;`,
    );
    const bar = document.createElement("div");
    bar.setAttribute("style", `height:100%;width:0;background:#4f46e5;transition:width 0.2s;`);
    bar.id = "progress-bar";
    this.progressEl.appendChild(bar);

    this.errorEl = document.createElement("div");
    this.errorEl.setAttribute(
      "style",
      `color:#ff6b6b;font:12px system-ui,sans-serif;margin-top:16px;max-width:300px;text-align:center;word-wrap:break-word;`,
    );
    this.errorEl.style.display = "none";

    this.overlay.appendChild(this.statusEl);
    this.overlay.appendChild(this.progressEl);
    this.overlay.appendChild(this.errorEl);
    this.container.appendChild(this.overlay);
  }

  setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  setProgress(fraction: number): void {
    const bar = this.progressEl.querySelector("#progress-bar") as HTMLElement;
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    }
  }

  showError(message: string): void {
    this.statusEl.textContent = "Error loading visualization";
    this.errorEl.textContent = message;
    this.errorEl.style.display = "block";
    this.progressEl.style.display = "none";
  }

  hide(): void {
    this.overlay.style.display = "none";
  }

  destroy(): void {
    this.overlay.remove();
  }
}
