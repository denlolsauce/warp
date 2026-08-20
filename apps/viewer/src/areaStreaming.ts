import * as pc from "playcanvas";
import type { SceneManifest } from "@portal/schema";
import { buildNavGraph, multiSourceGraphDistances, nearestNode } from "./navigation";

const PREFETCH_DISTANCE_M = 3; // nav-graph distance to a threshold that begins fetching
const UNLOAD_HYSTERESIS_M = 2; // euclidean distance outside the bbox before an area is eligible for eviction
const CROSSFADE_DURATION_S = 0.4;
const PIN_RECENT_COUNT = 2; // most-recently-entered areas are never evicted, however far away

// modifySplatColor is the one hook the stock gsplat shader calls with the
// splat's color still writable (see node_modules/playcanvas's
// gsplatCopyToWorkbuffer chunk: `modifySplatColor(worldCenter, &color);`
// immediately before the result is written to the work buffer used for
// final alpha-blended rendering) — scaling color.a here scales exactly what
// the renderer blends with, i.e. a true opacity fade rather than a tint.
const FADE_MODIFIER = {
  glsl: `
uniform float uOpacity;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) {
    color.a *= uOpacity;
}
`,
  wgsl: `
uniform uOpacity: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    (*color).a *= uniform.uOpacity;
}
`,
};

function attachFade(entity: pc.Entity, initialOpacity: number): void {
  const gsplat = entity.gsplat;
  if (!gsplat) return;
  gsplat.setWorkBufferModifier(FADE_MODIFIER);
  gsplat.setParameter("uOpacity", initialOpacity);
}

// workBufferUpdate defaults to "only re-render the work buffer when the
// transform changes" — an animated shader-only uniform like uOpacity
// doesn't count, per PlayCanvas's own docs on the property, so ALWAYS is
// required while a fade is in flight. Settling back to AUTO once the fade
// finishes avoids paying that per-frame re-render cost indefinitely.
// enabled=false at opacity 0 skips rendering the (invisible) splat
// entirely — fill-rate is the binding cost for gaussian splatting, so a
// fully-transparent resident area sitting in the hysteresis buffer must
// not still cost a render pass.
function setFadeOpacity(entity: pc.Entity | null, opacity: number, animating: boolean): void {
  const gsplat = entity?.gsplat;
  if (!entity || !gsplat) return;
  gsplat.setParameter("uOpacity", opacity);
  gsplat.workBufferUpdate = animating ? pc.WORKBUFFER_UPDATE_ALWAYS : pc.WORKBUFFER_UPDATE_AUTO;
  entity.enabled = opacity > 0;
}

// 0 when inside (or touching) the box, euclidean distance to the nearest
// face otherwise. Doubles as the AABB containment test (distance === 0).
function distanceOutsideBox(p: pc.Vec3, mins: pc.Vec3, maxs: pc.Vec3): number {
  const dx = Math.max(mins.x - p.x, 0, p.x - maxs.x);
  const dy = Math.max(mins.y - p.y, 0, p.y - maxs.y);
  const dz = Math.max(mins.z - p.z, 0, p.z - maxs.z);
  return Math.hypot(dx, dy, dz);
}

type AreaLoadState = "unloaded" | "loading" | "resident";

interface AreaStreamEntry {
  id: string;
  splatUrl: string;
  mins: pc.Vec3;
  maxs: pc.Vec3;
  distanceField: Float32Array | null; // null when the area has no detected doorway threshold
  chunkEntity: pc.Entity | null;
  areaEntity: pc.Entity | null;
  asset: pc.Asset | null;
  state: AreaLoadState;
  opacity: number;
  bytes: number;
  enteredAt: number; // monotonic — set when the area becomes resident, used for LRU + the recent-pin
}

// Streams area splats in rather than loading everything up front: PREFETCH
// starts the fetch early (nav-graph distance to the area's recorded doorway
// crossing, not euclidean — a straight-line 3m radius would fire through
// walls into rooms you can't actually be approaching), CROSSFADE dissolves
// between an area and its overview chunk once the fetch lands, HYSTERESIS
// keeps a small unload buffer plus the 2 most-recent areas pinned so
// standing in a doorway doesn't thrash the loader, and BUDGET bounds
// resident areas with LRU (by residency start, not last-seen) eviction.
export class AreaStreaming {
  private readonly app: pc.AppBase;
  private readonly entries: AreaStreamEntry[];
  private budget: number;
  private entryCounter = 0;
  private destroyed = false;

  // budget starts at its conservative (low-tier) value and is corrected via
  // setBudget() once the gaussian-budget frame-time measurement resolves —
  // that measurement takes ~2s in the background and area streaming
  // shouldn't block initial load waiting on it (the whole point of
  // streaming is to stop blocking load on splat data), so admission uses
  // whatever the best current estimate is rather than the final one.
  constructor(
    app: pc.AppBase,
    manifest: SceneManifest,
    budget: number,
    findEntity: (name: string) => pc.Entity | null,
  ) {
    this.app = app;
    this.budget = budget;
    const graph = buildNavGraph(manifest.nav);

    this.entries = manifest.areas.map((area): AreaStreamEntry => {
      const [mins, maxs] = area.bbox;
      const thresholdNodes = [
        ...new Set(area.thresholds.map((t) => nearestNode(graph, { x: t.pos[0], z: t.pos[2] }))),
      ];

      const chunkEntity = findEntity(`overview-chunk-${area.id}`);
      if (chunkEntity) attachFade(chunkEntity, 1); // fully visible until this area streams in

      return {
        id: area.id,
        splatUrl: area.splatUrl,
        mins: new pc.Vec3(mins[0], mins[1], mins[2]),
        maxs: new pc.Vec3(maxs[0], maxs[1], maxs[2]),
        distanceField: thresholdNodes.length > 0 ? multiSourceGraphDistances(graph, thresholdNodes) : null,
        chunkEntity,
        areaEntity: null,
        asset: null,
        state: "unloaded",
        opacity: 0,
        bytes: 0,
        enteredAt: 0,
      };
    });
  }

  get residentCount(): number {
    return this.entries.filter((e) => e.state === "resident").length;
  }

  get loadingCount(): number {
    return this.entries.filter((e) => e.state === "loading").length;
  }

  get residentBytes(): number {
    return this.entries.reduce((sum, e) => sum + (e.state === "resident" ? e.bytes : 0), 0);
  }

  get budgetLimit(): number {
    return this.budget;
  }

  setBudget(value: number): void {
    this.budget = value;
  }

  update(cameraPosition: pc.Vec3, currentNodeIndex: number, dt: number): void {
    for (const entry of this.entries) {
      const distOutside = distanceOutsideBox(cameraPosition, entry.mins, entry.maxs);
      const inside = distOutside === 0;
      // No distance field means no threshold was ever detected for this
      // area (nav.py found no doorway crossing to the overview) — bbox
      // entry is the fallback trigger for that case. But a bbox that the
      // recorded nav path never actually enters (a malformed or pre-
      // streaming-era manifest — confirmed against a real fixture, not
      // hypothetical) would then never load at all under the old
      // bbox-only fallback. Treat "no threshold" as "load immediately"
      // instead: we can't tell when the camera is approaching, so the
      // safe default is not to gate on a bbox that might be unreachable.
      const wantsPrefetch = entry.distanceField ? entry.distanceField[currentNodeIndex] <= PREFETCH_DISTANCE_M : true;

      if (entry.state === "unloaded" && (inside || wantsPrefetch)) {
        this.beginLoad(entry, cameraPosition);
      }

      if (entry.state !== "resident") continue;

      const target = inside ? 1 : 0;
      const step = dt / CROSSFADE_DURATION_S;
      if (entry.opacity < target) entry.opacity = Math.min(target, entry.opacity + step);
      else if (entry.opacity > target) entry.opacity = Math.max(target, entry.opacity - step);

      const animating = entry.opacity !== target;
      setFadeOpacity(entry.areaEntity, entry.opacity, animating);
      setFadeOpacity(entry.chunkEntity, 1 - entry.opacity, animating);
    }
  }

  private beginLoad(entry: AreaStreamEntry, cameraPosition: pc.Vec3): void {
    this.evictIfNeeded(cameraPosition);
    entry.state = "loading";

    const asset = new pc.Asset(entry.id, "gsplat", { url: entry.splatUrl });
    entry.asset = asset;
    let bytesLoaded = 0;

    asset.on("progress", (received: number) => {
      bytesLoaded = received;
    });
    asset.once("load", () => {
      // Evicted while in flight, or the viewer tore down mid-fetch.
      if (this.destroyed || entry.state !== "loading") return;

      const areaEntity = new pc.Entity(entry.id);
      areaEntity.addComponent("gsplat", { asset });
      this.app.root.addChild(areaEntity);
      attachFade(areaEntity, 0);

      entry.areaEntity = areaEntity;
      entry.bytes = bytesLoaded;
      entry.opacity = 0;
      entry.state = "resident";
      entry.enteredAt = ++this.entryCounter;
    });
    asset.once("error", (err: string) => {
      console.error(`[portal-viewer] failed to stream area '${entry.id}' (${entry.splatUrl}): ${err}`);
      entry.state = "unloaded";
      entry.asset = null;
    });

    this.app.assets.add(asset);
    this.app.assets.load(asset);
  }

  private evictIfNeeded(cameraPosition: pc.Vec3): void {
    const active = this.entries.filter((e) => e.state === "loading" || e.state === "resident");
    if (active.length < this.budget) return;

    const recentIds = new Set(
      this.entries
        .filter((e) => e.state === "resident")
        .sort((a, b) => b.enteredAt - a.enteredAt)
        .slice(0, PIN_RECENT_COUNT)
        .map((e) => e.id),
    );

    const candidates = this.entries
      .filter(
        (e) =>
          e.state === "resident" &&
          !recentIds.has(e.id) &&
          distanceOutsideBox(cameraPosition, e.mins, e.maxs) > UNLOAD_HYSTERESIS_M,
      )
      .sort((a, b) => a.enteredAt - b.enteredAt);

    // No safe victim (everything resident is either pinned or still close)
    // — let the budget go transiently over rather than pop something we're
    // standing next to.
    if (candidates.length > 0) this.evict(candidates[0]);
  }

  private evict(entry: AreaStreamEntry): void {
    entry.areaEntity?.destroy();
    entry.areaEntity = null;
    if (entry.asset) {
      this.app.assets.remove(entry.asset);
      entry.asset.unload();
      entry.asset = null;
    }
    entry.state = "unloaded";
    entry.opacity = 0;
    entry.bytes = 0;
    // By eviction time (>2m of walking past a 400ms fade) the chunk has
    // already settled at full opacity in the normal per-frame loop; this
    // just guarantees it isn't left stale if eviction ever races ahead of
    // that (e.g. a long click-to-walk covering >2m within one fade).
    setFadeOpacity(entry.chunkEntity, 1, false);
  }

  destroy(): void {
    this.destroyed = true;
    for (const entry of this.entries) {
      entry.areaEntity?.destroy();
      if (entry.asset) {
        this.app.assets.remove(entry.asset);
        entry.asset.unload();
      }
    }
  }
}
