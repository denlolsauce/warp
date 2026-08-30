from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .cleanup import Sam2SegmentationBackend, run_cleanup
from .compress import run_compress
from .errors import PipelineError
from .extract import run_extract
from .ingest import run_ingest
from .sfm import run_sfm
from .train import TrainConfig, run_train

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="splat-pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="Validate a product video with ffprobe")
    ingest_parser.add_argument("video_path", type=Path, help="Path to the product video")

    extract_parser = subparsers.add_parser(
        "extract", help="Extract and blur-filter frames from the product video"
    )
    extract_parser.add_argument("video_path", type=Path, help="Path to the product video")
    extract_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; frames are written to <workdir>/frames",
    )

    sfm_parser = subparsers.add_parser(
        "sfm", help="Run COLMAP feature extraction/matching and GLOMAP mapping"
    )
    sfm_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads <workdir>/frames, writes db.db and sparse/",
    )
    sfm_parser.add_argument(
        "--vocab-tree",
        type=Path,
        required=True,
        help="Path to a COLMAP vocabulary tree file",
    )

    train_parser = subparsers.add_parser(
        "train", help="Train a gsplat MCMC model on the joint reconstruction"
    )
    train_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads sparse/ and frames/, writes out/",
    )
    train_parser.add_argument("--method", type=str, default=None, help="Override: gsplat_trainer mode (default 'mcmc')")
    train_parser.add_argument("--cap-max", type=int, default=None, help="Override: Gaussian cap")
    train_parser.add_argument("--max-steps", type=int, default=None, help="Override: training steps")
    train_parser.add_argument("--sh-degree", type=int, default=None, help="Override: SH degree")

    cleanup_parser = subparsers.add_parser(
        "cleanup", help="Segment, remove the support surface, prune floaters, recentre/align/scale"
    )
    cleanup_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads out/ and frames/, writes cleaned.ply",
    )
    cleanup_parser.add_argument(
        "--sam2-checkpoint",
        type=Path,
        default=None,
        help="SAM 2 checkpoint path; background pruning is skipped if omitted",
    )

    compress_parser = subparsers.add_parser("compress", help="Convert cleaned.ply to SOG")
    compress_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads cleaned.ply, writes compressed/model.sog",
    )

    return parser


def _train_config_override(args: argparse.Namespace) -> TrainConfig | None:
    overrides = (args.method, args.cap_max, args.max_steps, args.sh_degree)
    if all(value is None for value in overrides):
        return None
    base = TrainConfig()
    return TrainConfig(
        method=args.method if args.method is not None else base.method,
        cap_max=args.cap_max if args.cap_max is not None else base.cap_max,
        max_steps=args.max_steps if args.max_steps is not None else base.max_steps,
        sh_degree=args.sh_degree if args.sh_degree is not None else base.sh_degree,
    )


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args(argv)

    try:
        if args.command == "ingest":
            run_ingest(args.video_path)
        elif args.command == "extract":
            run_extract(args.video_path, args.workdir / "frames")
        elif args.command == "sfm":
            run_sfm(args.workdir, args.vocab_tree)
        elif args.command == "train":
            run_train(args.workdir, _train_config_override(args))
        elif args.command == "cleanup":
            backend = Sam2SegmentationBackend(checkpoint_path=args.sam2_checkpoint) if args.sam2_checkpoint else None
            run_cleanup(args.workdir, backend)
        elif args.command == "compress":
            run_compress(args.workdir)
    except PipelineError as error:
        logger.error(str(error))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
