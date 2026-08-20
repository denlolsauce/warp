from pathlib import Path

import numpy as np
from PIL import Image
from plyfile import PlyData

SH_C0 = 0.28209479177387814  # degree-0 spherical harmonic basis constant

MAX_IMAGE_DIMENSION_PX = 1024
MAX_RENDERED_GAUSSIANS = 150_000
BOUNDS_PAD_METERS = 0.5
# MCMC's dead-gaussian relocation continuously strands stray "floater"
# points far from the real geometry throughout training; on a real trained
# PLY this wasn't one or two extreme values but 76%+ of all gaussians under
# 0.1 opacity, spread across a heavy tail out to thousands of units — no
# fixed position-percentile trim is robust to that (confirmed empirically:
# even a 1/99 percentile trim left the bounds ~2x too wide). Floaters stay
# low-opacity even after relocation, so restricting the BOUNDS computation
# (not the render itself) to meaningfully-opaque gaussians is what actually
# isolates the real geometry — verified against this same PLY's independent
# sparse-reconstruction bbox, which it matches closely.
BOUNDS_OPACITY_THRESHOLD = 0.5
RADIUS_MULTIPLIER = 2.0  # visual coverage over the raw trained scale — gaussians are soft-edged, a 1:1 radius under-covers
MIN_RADIUS_PX = 1.0
BACKGROUND_RGB = (0.12, 0.12, 0.13)  # neutral dark fill for pixels no gaussian ever reaches, not true black ("outside the property")


# Rasterizes a top-down view of a trained gaussian PLY to PNG — a wayfinding
# reference for the viewer's minimap, not a photorealistic render. Runs on
# plyfile + numpy + Pillow alone (no CUDA, no gsplat's own differentiable
# rasterizer), so it doesn't depend on the separate GPU training venv and
# works on a CPU-only box. Each gaussian is drawn as a flat, opacity-blended
# circle sized from its own trained scale (ignoring its rotation quaternion
# — projecting the true rotated ellipse onto one plane is a lot of extra
# math a minimap doesn't need), in low-Y-first painter's order so higher
# points correctly occlude what's beneath them, the way a real top-down
# photo would.
#
# Returns the world-space [[minX, minZ], [maxX, maxZ]] the image covers —
# the viewer's minimap needs this to map pixels back to world (x, z).
def render_floorplan(ply_path: Path, needs_flip: bool, output_path: Path, rng_seed: int = 0) -> list[list[float]]:
    ply = PlyData.read(str(ply_path))
    vertex = ply["vertex"]

    positions = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1).astype(np.float64)
    if needs_flip:
        positions[:, [1, 2]] *= -1  # matches compress.py's UP_AXIS_FLIP_EULER_XYZ (180 about X)

    dc = np.stack([vertex["f_dc_0"], vertex["f_dc_1"], vertex["f_dc_2"]], axis=1).astype(np.float64)
    colors = np.clip(0.5 + SH_C0 * dc, 0.0, 1.0)

    opacities = 1.0 / (1.0 + np.exp(-vertex["opacity"].astype(np.float64)))  # stored as a pre-sigmoid logit
    scales = np.exp(  # stored as log-scale
        np.stack([vertex["scale_0"], vertex["scale_1"], vertex["scale_2"]], axis=1).astype(np.float64)
    )
    radii_world = (scales[:, 0] + scales[:, 2]) / 2 * RADIUS_MULTIPLIER  # XZ footprint, axis-aligned approximation

    count = len(positions)
    if count > MAX_RENDERED_GAUSSIANS:
        keep = np.random.default_rng(rng_seed).choice(count, size=MAX_RENDERED_GAUSSIANS, replace=False)
        positions, colors, opacities, radii_world = positions[keep], colors[keep], opacities[keep], radii_world[keep]

    bounds_mask = opacities > BOUNDS_OPACITY_THRESHOLD
    if not bounds_mask.any():
        bounds_mask = np.ones(len(positions), dtype=bool)
    bounds_positions = positions[bounds_mask]

    min_x = float(bounds_positions[:, 0].min() - BOUNDS_PAD_METERS)
    max_x = float(bounds_positions[:, 0].max() + BOUNDS_PAD_METERS)
    min_z = float(bounds_positions[:, 2].min() - BOUNDS_PAD_METERS)
    max_z = float(bounds_positions[:, 2].max() + BOUNDS_PAD_METERS)
    world_width, world_height = max_x - min_x, max_z - min_z

    scale_px_per_m = MAX_IMAGE_DIMENSION_PX / max(world_width, world_height)
    image_width = max(1, round(world_width * scale_px_per_m))
    image_height = max(1, round(world_height * scale_px_per_m))

    canvas = np.zeros((image_height, image_width, 3), dtype=np.float64)
    coverage = np.zeros((image_height, image_width), dtype=np.float64)  # accumulated alpha, for background compositing

    # +X -> right, +Z -> down. Arbitrary (there's no "true north" in this
    # coordinate system) but fixed and shared with the viewer's minimap,
    # which must use the identical mapping to place the nav graph and
    # position dot on top of this image correctly.
    px = (positions[:, 0] - min_x) / world_width * image_width
    py = (positions[:, 2] - min_z) / world_height * image_height
    radii_px = np.maximum(radii_world * scale_px_per_m, MIN_RADIUS_PX)

    draw_order = np.argsort(positions[:, 1])  # low Y first, so high-Y (closer to a top-down camera) draws on top

    for i in draw_order:
        cx, cy, r, color, alpha = px[i], py[i], radii_px[i], colors[i], opacities[i]
        r_int = int(np.ceil(r))
        x0, x1 = max(0, int(cx - r_int)), min(image_width, int(cx + r_int) + 1)
        y0, y1 = max(0, int(cy - r_int)), min(image_height, int(cy + r_int) + 1)
        if x0 >= x1 or y0 >= y1:
            continue

        yy, xx = np.mgrid[y0:y1, x0:x1]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        if not mask.any():
            continue

        canvas_patch = canvas[y0:y1, x0:x1]
        canvas_patch[mask] = canvas_patch[mask] * (1 - alpha) + color * alpha
        coverage_patch = coverage[y0:y1, x0:x1]
        coverage_patch[mask] = coverage_patch[mask] * (1 - alpha) + alpha

    coverage_3 = coverage[:, :, None]
    final = canvas * coverage_3 + np.array(BACKGROUND_RGB) * (1 - coverage_3)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(final, 0, 1) * 255).astype(np.uint8), mode="RGB").save(output_path)

    return [[min_x, min_z], [max_x, max_z]]
