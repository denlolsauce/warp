/**
 * Hands a single GPU context around between the viewers on a page.
 *
 * Measured on this project's own models, not assumed: two large captures
 * (8.8MB + 7.4MB) on one page leave the first one black while the second
 * renders fine, and three break all of them. The failure is silent — the asset
 * reports loaded, the render loop keeps ticking, and the canvas just stays
 * empty — so it is easy to mistake for a broken model.
 *
 * The limit is memory rather than context count, which means it moves with
 * whatever else is on the GPU and cannot be tuned around with a fixed number.
 * So only one viewer is ever live: whichever one the reader is actually
 * looking at. The rest sit at their placeholder until they win the viewport.
 *
 * Start/stop are plain imperative callbacks rather than React state on
 * purpose. The outgoing viewer must have released its context *before* the
 * incoming one asks for its own — overlapping the two even briefly is exactly
 * what breaks them — and routing that through a re-render gives no ordering
 * guarantee between two sibling components.
 */

interface Entry {
  ratio: number;
  start: () => void;
  stop: () => void;
}

const entries = new Map<symbol, Entry>();
let activeKey: symbol | null = null;

function reconcile(): void {
  let bestKey: symbol | null = null;
  let bestRatio = 0;
  entries.forEach((entry, key) => {
    if (entry.ratio > bestRatio) {
      bestKey = key;
      bestRatio = entry.ratio;
    }
  });

  if (bestKey === activeKey) return;

  // Release first, claim second — never the other way around.
  if (activeKey !== null) entries.get(activeKey)?.stop();
  activeKey = bestKey;
  if (activeKey !== null) entries.get(activeKey)?.start();
}

export function registerViewer(entry: Omit<Entry, "ratio">): symbol {
  const key = Symbol("viewer");
  entries.set(key, { ...entry, ratio: 0 });
  return key;
}

export function unregisterViewer(key: symbol): void {
  const wasActive = activeKey === key;
  entries.delete(key);
  if (wasActive) {
    activeKey = null;
    reconcile();
  }
}

/** Report how much of this viewer is on screen, 0..1. */
export function reportVisibility(key: symbol, ratio: number): void {
  const entry = entries.get(key);
  if (!entry || entry.ratio === ratio) return;
  entry.ratio = ratio;
  reconcile();
}
