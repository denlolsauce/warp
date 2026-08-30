from pathlib import Path

import cv2
import numpy as np
import pytest

from splat_pipeline.errors import PipelineError
from splat_pipeline.extract import blur_drop_mask, blur_filter, run_extract


def _write_frame(path: Path, image: np.ndarray) -> None:
    cv2.imwrite(str(path), image)


def test_blur_filter_drops_frames_far_below_their_neighbours(tmp_path: Path):
    sharp = (np.indices((200, 200)).sum(axis=0) % 2 * 255).astype(np.uint8)
    flat = np.full((200, 200), 128, dtype=np.uint8)

    for i in range(8):
        _write_frame(tmp_path / f"sharp_{i}.jpg", sharp)
    for i in range(2):
        _write_frame(tmp_path / f"flat_{i}.jpg", flat)

    kept, dropped = blur_filter(tmp_path)

    assert (kept, dropped) == (8, 2)
    remaining = {p.name for p in tmp_path.glob("*.jpg")}
    assert remaining == {f"sharp_{i}.jpg" for i in range(8)}


def test_blur_filter_empty_dir_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        blur_filter(tmp_path)
    assert excinfo.value.stage == "extract:blur_filter"


def test_blur_filter_unreadable_frame_raises(tmp_path: Path):
    (tmp_path / "00001.jpg").write_bytes(b"not a real image")
    with pytest.raises(PipelineError) as excinfo:
        blur_filter(tmp_path)
    assert excinfo.value.stage == "extract:blur_filter"


def test_run_extract_missing_video_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        run_extract(tmp_path / "missing.mp4", tmp_path / "frames")
    assert excinfo.value.stage == "extract"


def test_blur_drop_mask_keeps_a_uniformly_sharp_run_intact():
    # The whole point of comparing against neighbours rather than a global
    # percentile: a stretch where every frame is equally good loses nothing.
    scores = np.full(60, 500.0)
    assert not blur_drop_mask(scores).any()


def test_blur_drop_mask_keeps_sharp_low_texture_frames():
    # The confound a global percentile gets wrong. Frames 0-29 are a sharp but
    # plain background (low Laplacian variance because there is little in
    # view, not because they are blurred); frames 30-59 are a sharp, heavily
    # textured region. Nothing here is blurred, so nothing should be dropped.
    rng = np.random.default_rng(0)
    scores = np.concatenate([rng.normal(40, 6, 30), rng.normal(900, 100, 30)])

    drop = blur_drop_mask(scores, window=5)
    assert not drop.any()

    # The old global-percentile rule deleted 12 of these frames, and every one
    # of them came out of the plain-background run — the footage sfm.py's
    # verify_reconstruction message says is already the hardest to register.
    would_drop = scores < np.percentile(scores, 20)
    assert would_drop.sum() == 12
    assert would_drop[:30].sum() == 12


def test_blur_drop_mask_drops_motion_blur_inside_a_textured_run():
    scores = np.full(60, 900.0)
    scores[[10, 11, 40]] = 200.0  # a brief fast pan

    drop = blur_drop_mask(scores, window=5)

    assert sorted(np.flatnonzero(drop)) == [10, 11, 40]


def test_blur_drop_mask_never_drops_more_than_the_cap():
    # Pathological input: every other frame is blurred (judder), so the ratio
    # rule on its own wants to delete half the video. The cap holds it to 40%
    # rather than leaving the capture too sparsely observed to reconstruct.
    scores = np.empty(100)
    scores[0::2] = 1000.0
    scores[1::2] = 100.0

    drop = blur_drop_mask(scores)

    assert drop.sum() == 40
    # Everything dropped came out of the blurred half; no sharp frame is lost.
    assert not drop[0::2].any()


def test_blur_drop_mask_handles_a_single_frame():
    assert not blur_drop_mask(np.array([123.0])).any()


def test_blur_drop_mask_handles_an_all_black_run():
    # medians of 0 must mean "drop nothing", not "drop everything".
    assert not blur_drop_mask(np.zeros(20)).any()
