import type { SurveyManifest } from "@warp-survey/contracts";

export class InfoPanel {
  private container: HTMLElement;
  private element: HTMLElement;

  constructor(parent: HTMLElement, manifest: SurveyManifest) {
    this.container = parent;
    this.element = document.createElement("div");

    const origin = manifest.spatial.localOrigin;
    const originText = `Origin: (${origin[0].toFixed(2)}, ${origin[1].toFixed(2)}, ${origin[2].toFixed(2)}) ${manifest.spatial.unit}`;

    this.element.setAttribute(
      "style",
      `position:absolute;top:12px;left:12px;background:rgba(10,10,12,0.8);` +
        `color:#e8e8ea;padding:12px 16px;border-radius:6px;font:12px system-ui,sans-serif;` +
        `border:1px solid rgba(100,100,100,0.3);max-width:300px;z-index:100;`,
    );

    const warningLabel = document.createElement("div");
    warningLabel.textContent = "⚠ Visualization only — not for measurement";
    warningLabel.setAttribute(
      "style",
      `font-weight:bold;color:#ff9800;margin-bottom:8px;font-size:11px;`,
    );

    const originLabel = document.createElement("div");
    originLabel.textContent = originText;
    originLabel.setAttribute("style", `font-size:11px;opacity:0.8;`);

    this.element.appendChild(warningLabel);
    this.element.appendChild(originLabel);
    this.container.appendChild(this.element);
  }

  destroy(): void {
    this.element.remove();
  }
}
