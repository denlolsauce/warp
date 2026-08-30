"""Feed-forward pose estimation with VGGT, written out as a COLMAP sparse model.

Executed as a *standalone script* by a separate interpreter
(SPLAT_VGGT_PYTHON), never imported by this package — VGGT needs torch with
CUDA and its own pinned dependency set, the same reason train.py shells out
to SPLAT_GSPLAT_PYTHON instead of importing gsplat. So: no
`from .something import ...` here, and nothing in this file may be relied on
by the rest of splat_pipeline. Everything worth unit-testing lives in
pose.py on the near side of the subprocess boundary.

Derived from facebookresearch/vggt's demo_colmap.py (its no-bundle-adjustment
path), with three deliberate differences:

  * Frames come from an explicit ordered JSON list rather than a bare
    glob. demo_colmap.py globs unsorted and then renames images by list
    index, so the reconstruction's image names can be assigned to the wrong
    poses. It also lets the caller (pose.py) own frame subsampling, which
    matters because VGGT holds every frame's tokens in VRAM at once.
  * Output goes to <output-dir>/0, the sub-model layout the rest of this
    pipeline reads (sfm.py's verify_reconstruction, train.py, cleanup.py).
  * A metrics JSON is written alongside it. A feed-forward estimator poses
    every frame unconditionally, so the registration-rate gate that guards
    the GLOMAP path cannot detect a bad capture here — depth confidence is
    the only signal there is, and pose.py gates on it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from vggt.dependency.np_to_pycolmap import batch_np_matrix_to_pycolmap_wo_track
from vggt.models.vggt import VGGT
from vggt.utils.geometry import unproject_depth_map_to_point_map
from vggt.utils.helper import create_pixel_coordinate_grid, randomly_limit_trues
from vggt.utils.load_fn import load_and_preprocess_images_square
from vggt.utils.pose_enc import pose_encoding_to_extri_intri

# VGGT is trained at 518x518 and its patch grid is not resolution-agnostic;
# this is a property of the released weights, not a tunable.
VGGT_RESOLUTION = 518
# Images are loaded at this resolution so the exported camera intrinsics can
# be rescaled back to a sensible pixel size, matching demo_colmap.py.
IMAGE_LOAD_RESOLUTION = 1024
MODEL_ID = "facebook/VGGT-1B"


def run_vggt(model, images: torch.Tensor, dtype: torch.dtype):
    images = F.interpolate(
        images, size=(VGGT_RESOLUTION, VGGT_RESOLUTION), mode="bilinear", align_corners=False
    )
    with torch.no_grad():
        with torch.autocast("cuda", dtype=dtype):
            batched = images[None]
            aggregated_tokens_list, ps_idx = model.aggregator(batched)
        pose_enc = model.camera_head(aggregated_tokens_list)[-1]
        # OpenCV convention (camera-from-world), same as COLMAP's.
        extrinsic, intrinsic = pose_encoding_to_extri_intri(pose_enc, batched.shape[-2:])
        depth_map, depth_conf = model.depth_head(aggregated_tokens_list, batched, ps_idx)

    return (
        extrinsic.squeeze(0).cpu().numpy(),
        intrinsic.squeeze(0).cpu().numpy(),
        depth_map.squeeze(0).cpu().numpy(),
        depth_conf.squeeze(0).cpu().numpy(),
        images,
    )


def rescale_cameras_to_original_resolution(reconstruction, frame_names, original_coords) -> None:
    """Rename each image to its real frame filename and undo the square
    pad+resize in the camera parameters, so the exported model is expressed
    in the frames' own pixel coordinates — which is what the trainer and
    cleanup's reprojection assume.
    """
    for image_id in reconstruction.images:
        image = reconstruction.images[image_id]
        camera = reconstruction.cameras[image.camera_id]
        # pycolmap image ids are 1-based and assigned in input order.
        index = image_id - 1
        image.name = frame_names[index]

        real_size = original_coords[index, -2:]
        resize_ratio = max(real_size) / VGGT_RESOLUTION
        params = camera.params * resize_ratio
        params[-2:] = real_size / 2  # principal point at the real image centre
        camera.params = params
        camera.width = int(real_size[0])
        camera.height = int(real_size[1])

        top_left = original_coords[index, :2]
        for point2d in image.points2D:
            point2d.xy = (point2d.xy - top_left) * resize_ratio


def main() -> int:
    parser = argparse.ArgumentParser(prog="vggt_runner")
    parser.add_argument("--frames-file", type=Path, required=True, help="JSON array of frame paths, in capture order")
    parser.add_argument("--output-dir", type=Path, required=True, help="Sparse model root; the model is written to <dir>/0")
    parser.add_argument("--metrics-path", type=Path, required=True)
    parser.add_argument("--conf-threshold", type=float, required=True)
    parser.add_argument("--max-points", type=int, required=True)
    args = parser.parse_args()

    # Imported late so an import error names the real missing piece rather
    # than failing at module load before argparse can report anything.
    import pycolmap  # noqa: F401  (batch_np_matrix_to_pycolmap_wo_track needs it present)

    frame_paths = [Path(p) for p in json.loads(args.frames_file.read_text())]
    frame_names = [p.name for p in frame_paths]

    if not torch.cuda.is_available():
        raise SystemExit("vggt: CUDA is required for feed-forward pose estimation, but no GPU is visible")

    device = "cuda"
    # bfloat16 needs Ampere or newer; older cards fall back to fp16.
    dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16

    model = VGGT.from_pretrained(MODEL_ID).to(device).eval()

    images, original_coords = load_and_preprocess_images_square(
        [str(p) for p in frame_paths], IMAGE_LOAD_RESOLUTION
    )
    images = images.to(device)
    original_coords = original_coords.cpu().numpy()

    extrinsic, intrinsic, depth_map, depth_conf, resized_images = run_vggt(model, images, dtype)
    points_3d = unproject_depth_map_to_point_map(depth_map, extrinsic, intrinsic)

    points_rgb = F.interpolate(
        resized_images, size=(VGGT_RESOLUTION, VGGT_RESOLUTION), mode="bilinear", align_corners=False
    )
    points_rgb = (points_rgb.cpu().numpy() * 255).astype(np.uint8).transpose(0, 2, 3, 1)

    num_frames, height, width, _ = points_3d.shape
    points_xyf = create_pixel_coordinate_grid(num_frames, height, width)

    confident = depth_conf >= args.conf_threshold
    # Measured before the point-count cap below, which is a size limit on the
    # exported model rather than a statement about reconstruction quality.
    confident_fraction = float(confident.mean())
    mean_confidence = float(depth_conf.mean())

    conf_mask = randomly_limit_trues(confident, args.max_points)
    points_3d = points_3d[conf_mask]
    points_xyf = points_xyf[conf_mask]
    points_rgb = points_rgb[conf_mask]

    reconstruction = batch_np_matrix_to_pycolmap_wo_track(
        points_3d,
        points_xyf,
        points_rgb,
        extrinsic,
        intrinsic,
        np.array([VGGT_RESOLUTION, VGGT_RESOLUTION]),
        # Feed-forward prediction gives each frame its own intrinsics; there
        # is no shared-camera mode on this path (demo_colmap.py's own note).
        shared_camera=False,
        camera_type="PINHOLE",
    )
    rescale_cameras_to_original_resolution(reconstruction, frame_names, original_coords)

    model_dir = args.output_dir / "0"
    model_dir.mkdir(parents=True, exist_ok=True)
    reconstruction.write(str(model_dir))

    args.metrics_path.write_text(
        json.dumps(
            {
                "frames": len(frame_paths),
                "registered_images": len(reconstruction.images),
                "points": int(len(points_3d)),
                "mean_depth_confidence": mean_confidence,
                "confident_point_fraction": confident_fraction,
                "conf_threshold": args.conf_threshold,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
