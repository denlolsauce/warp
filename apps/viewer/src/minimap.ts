import type { SceneManifest, Vec2 } from "@portal/schema";
import type { Point2 } from "./navigation";
import { isMobileViewport } from "./virtualJoystick";

// Narrower on mobile: the panel competes with the controls-hint text for
// top-of-screen width there (see viewer.ts's showControlsHint), and a
// touch screen has less width to spare in the first place.
const PANEL_WIDTH_PX = isMobileViewport() ? 130 : 220;
const NAV_LINE_COLOR = "rgba(120, 220, 255, 0.55)";
const POSITION_DOT_COLOR = "#ffb020";
const POSITION_DOT_RADIUS_PX = 5;
const AREA_LABEL_COLOR = "#f0f0f2";
const FLOOR_TAB_ACTIVE_BG = "rgba(255,255,255,0.28)";
const FLOOR_TAB_BG = "rgba(255,255,255,0.08)";

interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

// A pixel position on the minimap canvas — kept distinct from Point2 (a
// world x/z position) so the two can't be mixed up silently; both happen
// to be a pair of numbers, but a canvas y and a world z are not the same
// axis or the same units.
interface Pixel {
  x: number;
  y: number;
}

function toBounds([[minX, minZ], [maxX, maxZ]]: [Vec2, Vec2]): Bounds {
  return { minX, minZ, maxX, maxZ };
}

// Must match floorplan.py's render_floorplan exactly: +X -> right, +Z -> down.
function worldToPixel(x: number, z: number, b: Bounds, width: number, height: number): Pixel {
  return {
    x: ((x - b.minX) / (b.maxX - b.minX)) * width,
    y: ((z - b.minZ) / (b.maxZ - b.minZ)) * height,
  };
}

function pixelToWorld(px: number, py: number, b: Bounds, width: number, height: number): Point2 {
  return {
    x: b.minX + (px / width) * (b.maxX - b.minX),
    z: b.minZ + (py / height) * (b.maxZ - b.minZ),
  };
}

// Floorplan (background image + nav graph) overlaying a live position dot,
// with click-to-walk and a floor selector when the manifest's areas span
// more than one floor. The floorplan image itself is a single top-down
// render (pipeline/floorplan.py) — multiple floors share it; the selector
// filters which areas get labels and click targets, it doesn't re-render
// per floor.
export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bounds: Bounds;
  private readonly manifest: SceneManifest;
  private readonly onWalkTo: (target: Point2) => void;
  private readonly image = new Image();
  private imageReady = false;
  private readonly floors: string[];
  private currentFloor: string;

  private cameraPixel: Pixel = { x: 0, y: 0 };
  private cameraYawDeg = 0;

  constructor(
    container: HTMLElement,
    manifest: SceneManifest,
    floorplanUrl: string,
    floorplanBounds: [Vec2, Vec2],
    onWalkTo: (target: Point2) => void,
  ) {
    this.manifest = manifest;
    this.bounds = toBounds(floorplanBounds);
    this.onWalkTo = onWalkTo;
    this.floors = [...new Set(manifest.areas.map((a) => a.floor))].sort();
    this.currentFloor = this.floors[0] ?? "0";

    this.root = document.createElement("div");
    this.root.setAttribute(
      "style",
      `position:absolute;top:12px;right:12px;width:${PANEL_WIDTH_PX}px;` +
        "background:rgba(10,10,12,0.75);border-radius:6px;padding:6px;z-index:6;" +
        "font:11px system-ui,sans-serif;color:#e8e8ea;user-select:none;",
    );

    if (this.floors.length > 1) {
      this.root.appendChild(this.buildFloorSelector());
    }

    const aspect = (this.bounds.maxZ - this.bounds.minZ) / (this.bounds.maxX - this.bounds.minX);
    this.canvas = document.createElement("canvas");
    this.canvas.width = PANEL_WIDTH_PX;
    this.canvas.height = Math.max(1, Math.round(PANEL_WIDTH_PX * aspect));
    this.canvas.setAttribute("style", "display:block;width:100%;height:auto;border-radius:4px;cursor:pointer;");
    this.canvas.addEventListener("click", this.handleClick);
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

    this.image.onload = () => {
      this.imageReady = true;
      this.draw();
    };
    this.image.src = floorplanUrl;

    container.appendChild(this.root);
    this.draw();
  }

  private buildFloorSelector(): HTMLDivElement {
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;");

    for (const floor of this.floors) {
      const button = document.createElement("button");
      button.textContent = `Floor ${floor}`;
      button.setAttribute(
        "style",
        "border:none;border-radius:3px;padding:3px 6px;font:11px system-ui,sans-serif;" +
          "cursor:pointer;color:#e8e8ea;",
      );
      button.style.background = floor === this.currentFloor ? FLOOR_TAB_ACTIVE_BG : FLOOR_TAB_BG;
      button.addEventListener("click", () => {
        this.currentFloor = floor;
        for (const sibling of Array.from(row.children)) {
          (sibling as HTMLButtonElement).style.background =
            sibling.textContent === `Floor ${floor}` ? FLOOR_TAB_ACTIVE_BG : FLOOR_TAB_BG;
        }
        this.draw();
      });
      row.appendChild(button);
    }
    return row;
  }

  private handleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (this.canvas.width / rect.width);
    const py = (event.clientY - rect.top) * (this.canvas.height / rect.height);
    const world = pixelToWorld(px, py, this.bounds, this.canvas.width, this.canvas.height);

    // "Click a room" walks to that room's recorded doorway (spawn), not the
    // literal click point — a click near a room's edge should still land
    // you sensibly inside it. A click outside every area's footprint (e.g.
    // a hallway) falls back to walking toward the click point itself,
    // matching ordinary 3D click-to-walk.
    const area = this.manifest.areas.find(
      (a) =>
        a.floor === this.currentFloor &&
        world.x >= a.bbox[0][0] &&
        world.x <= a.bbox[1][0] &&
        world.z >= a.bbox[0][2] &&
        world.z <= a.bbox[1][2],
    );
    this.onWalkTo(area ? { x: area.spawn.pos[0], z: area.spawn.pos[2] } : world);
  };

  update(cameraPos: Point2, cameraYawDeg: number): void {
    this.cameraPixel = worldToPixel(cameraPos.x, cameraPos.z, this.bounds, this.canvas.width, this.canvas.height);
    this.cameraYawDeg = cameraYawDeg;
    this.draw();
  }

  private draw(): void {
    const { ctx, canvas, bounds } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.imageReady) {
      ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#1a1a1c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = NAV_LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [a, b] of this.manifest.nav.edges) {
      const [ax, , az] = this.manifest.nav.nodes[a];
      const [bx, , bz] = this.manifest.nav.nodes[b];
      const pa = worldToPixel(ax, az, bounds, canvas.width, canvas.height);
      const pb = worldToPixel(bx, bz, bounds, canvas.width, canvas.height);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const area of this.manifest.areas) {
      if (area.floor !== this.currentFloor) continue;
      const p = worldToPixel(area.spawn.pos[0], area.spawn.pos[2], bounds, canvas.width, canvas.height);
      const textWidth = ctx.measureText(area.name).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(p.x - textWidth / 2 - 3, p.y - 12, textWidth + 6, 14);
      ctx.fillStyle = AREA_LABEL_COLOR;
      ctx.fillText(area.name, p.x, p.y - 2);
    }

    // Facing wedge uses the same yaw convention as the main camera
    // (forward = (-sin(yaw), -cos(yaw)) in world XZ — cameraController.ts),
    // mapped directly into this canvas's +Z-down pixel space.
    const yawRad = this.cameraYawDeg * (Math.PI / 180);
    const dirX = -Math.sin(yawRad);
    const dirY = -Math.cos(yawRad);
    const { x: cx, y: cy } = this.cameraPixel;

    ctx.fillStyle = POSITION_DOT_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, POSITION_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    const tip = POSITION_DOT_RADIUS_PX * 2.2;
    const flank = POSITION_DOT_RADIUS_PX * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + dirX * tip, cy + dirY * tip);
    ctx.lineTo(cx + dirY * flank, cy - dirX * flank);
    ctx.lineTo(cx - dirY * flank, cy + dirX * flank);
    ctx.closePath();
    ctx.fill();
  }

  destroy(): void {
    this.canvas.removeEventListener("click", this.handleClick);
    this.root.remove();
  }
}
