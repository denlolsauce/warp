import { SurveyViewer } from "./survey-viewer";

class WarpSurveyViewer extends HTMLElement {
  private viewer: SurveyViewer | null = null;
  private canvas: HTMLCanvasElement | null = null;

  connectedCallback(): void {
    this.attachShadow({ mode: "open" });
    if (!this.shadowRoot) return;

    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      #viewer-container {
        position: relative;
        width: 100%;
        height: 100%;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `;

    const container = document.createElement("div");
    container.id = "viewer-container";

    const canvas = document.createElement("canvas");
    canvas.id = "survey-canvas";

    container.appendChild(canvas);
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(container);

    this.canvas = canvas;
    this.loadVisualization();
  }

  disconnectedCallback(): void {
    this.viewer?.destroy();
    this.viewer = null;
  }

  private async loadVisualization(): Promise<void> {
    if (!this.canvas) return;

    const manifestUrl = this.getAttribute("manifest");
    if (!manifestUrl) {
      console.error("<warp-survey-viewer> requires a 'manifest' attribute");
      return;
    }

    this.viewer = new SurveyViewer(this.canvas);
    try {
      await this.viewer.load(manifestUrl);
    } catch (error) {
      console.error("Failed to load survey visualization:", error);
    }
  }
}

customElements.define("warp-survey-viewer", WarpSurveyViewer);

declare global {
  interface HTMLElementTagNameMap {
    "warp-survey-viewer": WarpSurveyViewer;
  }
}

export { WarpSurveyViewer };
