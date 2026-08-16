import * as pc from "playcanvas";
import type { SceneManifest } from "@portal/schema";

interface AreaVisibilityEntry {
  mins: pc.Vec3;
  maxs: pc.Vec3;
  areaEntity: pc.Entity;
  chunkEntity: pc.Entity | null;
  inside: boolean;
}

// Runtime masking as a hard visibility toggle, not per-splat culling or a
// cross-fade: when the camera is inside area X's bbox, X's own high-detail
// splat shows and the overview's low-detail chunk carved for that same
// region (compress.py's chunk_overview) hides, and vice versa on the way
// out. The two tiers never render simultaneously over the same physical
// space, so there's no double-density ghosting where they'd otherwise
// overlap.
export class AreaVisibility {
  private readonly entries: AreaVisibilityEntry[];

  constructor(manifest: SceneManifest, findEntity: (name: string) => pc.Entity | null) {
    this.entries = manifest.areas.flatMap((area): AreaVisibilityEntry[] => {
      const areaEntity = findEntity(area.id);
      if (!areaEntity) return [];
      const [mins, maxs] = area.bbox;
      return [
        {
          mins: new pc.Vec3(mins[0], mins[1], mins[2]),
          maxs: new pc.Vec3(maxs[0], maxs[1], maxs[2]),
          areaEntity,
          chunkEntity: findEntity(`overview-chunk-${area.id}`),
          inside: false,
        },
      ];
    });

    // Start exactly the way the property is meant to be entered: overview
    // whole, no area yet claimed by the camera. The first update() call
    // (same frame) corrects this immediately if spawn actually lands inside
    // an area.
    for (const entry of this.entries) {
      entry.areaEntity.enabled = false;
      if (entry.chunkEntity) entry.chunkEntity.enabled = true;
    }
  }

  update(cameraPosition: pc.Vec3): void {
    for (const entry of this.entries) {
      const inside =
        cameraPosition.x >= entry.mins.x &&
        cameraPosition.x <= entry.maxs.x &&
        cameraPosition.y >= entry.mins.y &&
        cameraPosition.y <= entry.maxs.y &&
        cameraPosition.z >= entry.mins.z &&
        cameraPosition.z <= entry.maxs.z;

      if (inside === entry.inside) continue;
      entry.inside = inside;
      entry.areaEntity.enabled = inside;
      if (entry.chunkEntity) entry.chunkEntity.enabled = !inside;
    }
  }
}
