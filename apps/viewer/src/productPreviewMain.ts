import { ProductPreview, type LoadOptions, type ViewMode } from "./productPreview";

const canvas = document.getElementById("application-canvas") as HTMLCanvasElement;
const preview = new ProductPreview(canvas);

const params = new URLSearchParams(window.location.search);
const sogUrl = params.get("sog");

function numberParam(name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

if (sogUrl) {
  const mode: ViewMode = params.get("mode") === "fly" ? "fly" : "orbit";
  const options: LoadOptions = {
    mode,
    startAzimuth: numberParam("az"),
    startPolar: numberParam("polar"),
    startRadius: numberParam("r"),
    flySpeed: numberParam("speed"),
    pivotX: numberParam("px"),
    pivotY: numberParam("py"),
    pivotZ: numberParam("pz"),
    // Opt-in per capture: `?floor=auto` detects the floor from the splat,
    // `?floor=<number>` names it outright, and omitting it leaves the camera
    // unconstrained as before.
    floorY: params.get("floor") === "auto" ? "auto" : numberParam("floor"),
  };
  void preview.load(sogUrl, options).catch((error: unknown) => {
    console.error("[product-preview] failed to load", error);
  });
  // Debug hook: this page has no module-scope `pc` global to introspect
  // from the console (unlike the plain-<script>-tag pages), so expose the
  // one thing actually needed for tuning a pivot/starting vantage by hand.
  (window as unknown as { __preview: typeof preview }).__preview = preview;

  if (mode === "fly") {
    const hint = document.createElement("div");
    hint.textContent = "drag to look · WASD to move · space/C up-down · shift to move faster";
    hint.setAttribute(
      "style",
      "position:absolute;left:50%;bottom:20px;transform:translateX(-50%);" +
        "padding:8px 16px;border-radius:999px;pointer-events:none;" +
        "background:rgba(10,10,12,0.55);color:#e8e8ea;font:13px system-ui,sans-serif;" +
        "letter-spacing:0.01em;white-space:nowrap;",
    );
    (canvas.parentElement ?? document.body).appendChild(hint);
  }
} else {
  const notice = document.createElement("div");
  notice.textContent = "No SOG specified — open this page with ?sog=<url-to-model.sog>";
  notice.setAttribute(
    "style",
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      "padding:24px;text-align:center;color:#e8e8ea;font:14px system-ui,sans-serif;" +
      "background:#0a0a0c;",
  );
  (canvas.parentElement ?? document.body).appendChild(notice);
}
