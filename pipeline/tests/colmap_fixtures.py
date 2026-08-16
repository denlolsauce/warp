import numpy as np
import pycolmap


MAX_POINT_OBSERVATIONS_PER_IMAGE = 4


def build_synthetic_reconstruction(
    images: list[tuple[int, str, tuple[float, float, float]]],
    points: list[tuple[float, float, float]] | None = None,
) -> pycolmap.Reconstruction:
    """Build a minimal reconstruction with one shared camera and the given images,
    each registered at the given world-space camera centre (identity rotation).

    Each image gets MAX_POINT_OBSERVATIONS_PER_IMAGE keypoints so that `points`
    (each observed by two round-robin-adjacent images) can be attached without two
    tracks ever claiming the same (image_id, point2D_idx) slot.
    """
    reconstruction = pycolmap.Reconstruction()
    camera = pycolmap.Camera(
        model="SIMPLE_PINHOLE", width=100, height=100, params=[50.0, 50.0, 50.0], camera_id=1
    )
    reconstruction.add_camera_with_trivial_rig(camera)

    keypoints = np.array([[10.0 * i, 10.0 * i] for i in range(MAX_POINT_OBSERVATIONS_PER_IMAGE)])
    for image_id, name, center in images:
        image = pycolmap.Image(name=name, keypoints=keypoints, camera_id=1, image_id=image_id)
        # cam_from_world.translation = -R @ center; with identity rotation that's -center.
        pose = pycolmap.Rigid3d(pycolmap.Rotation3d(), -np.array(center, dtype=np.float64))
        reconstruction.add_image_with_trivial_frame(image, pose)

    if points:
        ids = [image_id for image_id, _, _ in images]
        next_free_idx = {image_id: 0 for image_id in ids}
        for i, point in enumerate(points):
            a, b = ids[i % len(ids)], ids[(i + 1) % len(ids)]
            track = pycolmap.Track(
                [
                    pycolmap.TrackElement(a, next_free_idx[a]),
                    pycolmap.TrackElement(b, next_free_idx[b]),
                ]
            )
            next_free_idx[a] += 1
            next_free_idx[b] += 1
            reconstruction.add_point3D(np.array(point, dtype=np.float64), track)

    return reconstruction
