const BUTTON_STYLE =
  "border:none;border-radius:4px;padding:6px 10px;font:12px system-ui,sans-serif;" +
  "cursor:pointer;color:#e8e8ea;background:rgba(10,10,12,0.7);pointer-events:auto;";

export interface HudControlsOptions {
  onReset: () => void;
  isEmbed: boolean;
}

// Reset-view and fullscreen buttons, plus the "Powered by Warp" badge —
// grouped together since all three are small, mostly-static corner HUD
// pieces, unlike the minimap's data-driven rendering. The badge is the one
// piece that's conditional: shown when the viewer is loaded directly or
// previewed by the tour's own creator, omitted when main.ts sees ?embed=1
// (the snippet TourStatus.tsx hands out for embedding on someone else's
// site for their visitors — see apps/web's embedSnippet).
export class HudControls {
  private readonly root: HTMLDivElement;
  private readonly container: HTMLElement;
  private readonly handleFullscreenChange = (): void => {
    this.fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  };
  private readonly fullscreenButton: HTMLButtonElement;

  constructor(container: HTMLElement, options: HudControlsOptions) {
    this.container = container;

    this.root = document.createElement("div");
    this.root.setAttribute(
      "style",
      "position:absolute;bottom:12px;right:12px;display:flex;gap:6px;align-items:center;" +
        "z-index:6;pointer-events:none;",
    );

    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset view";
    resetButton.setAttribute("style", BUTTON_STYLE);
    resetButton.addEventListener("click", options.onReset);
    this.root.appendChild(resetButton);

    this.fullscreenButton = document.createElement("button");
    this.fullscreenButton.textContent = "Fullscreen";
    this.fullscreenButton.setAttribute("style", BUTTON_STYLE);
    this.fullscreenButton.addEventListener("click", this.toggleFullscreen);
    this.root.appendChild(this.fullscreenButton);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);

    if (!options.isEmbed) {
      const badge = document.createElement("div");
      badge.textContent = "Powered by Warp";
      badge.setAttribute(
        "style",
        "padding:6px 10px;font:11px system-ui,sans-serif;color:rgba(232,232,234,0.7);" +
          "background:rgba(10,10,12,0.7);border-radius:4px;",
      );
      this.root.appendChild(badge);
    }

    container.appendChild(this.root);
  }

  private toggleFullscreen = (): void => {
    // Can be denied by the embedding context (an iframe without
    // allow="fullscreen", a restrictive permissions policy) with no
    // visible effect otherwise — log it rather than fail silently.
    const request = document.fullscreenElement ? document.exitFullscreen() : this.container.requestFullscreen();
    request.catch((error: unknown) => {
      console.error("[portal-viewer] fullscreen request failed", error);
    });
  };

  destroy(): void {
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    this.root.remove();
  }
}
