/**
 * The selected/unselected pill treatment shared by the gallery filters and the
 * waitlist volume picker.
 */
export function chipClasses(selected: boolean): string {
  return selected
    ? "border-warp-accent bg-[rgba(121,220,214,0.13)] text-warp-accent-soft"
    : "border-warp-line-3 bg-[rgba(255,255,255,0.03)] text-warp-nav hover:text-warp-strong";
}
