from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .compress import run_compress
from .errors import PipelineError
from .extract import run_extract
from .nav import run_nav
from .sfm import run_sfm
from .train import TrainConfig, run_train

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="portal-pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser(
        "extract", help="Extract and blur-filter frames from capture videos"
    )
    extract_parser.add_argument(
        "videos_dir", type=Path, help="Directory of <role>_<areaName>.mp4 videos"
    )
    extract_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; frames are written to <workdir>/frames",
    )

    sfm_parser = subparsers.add_parser(
        "sfm", help="Run joint COLMAP feature extraction/matching and GLOMAP mapping"
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
        "train", help="Split sparse/0 per area and train each with gsplat MCMC, concurrently"
    )
    train_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads sparse/ and frames/, writes sub/ and out/",
    )
    train_parser.add_argument("--method", type=str, default=None, help="Override: gsplat_trainer mode (default per-role, normally 'mcmc')")
    train_parser.add_argument("--cap-max", type=int, default=None, help="Override: Gaussian cap for every area trained this run")
    train_parser.add_argument("--max-steps", type=int, default=None, help="Override: training steps for every area trained this run")
    train_parser.add_argument("--sh-degree", type=int, default=None, help="Override: SH degree for every area trained this run")

    compress_parser = subparsers.add_parser(
        "compress", help="Compute area bboxes and convert trained PLYs to SOG"
    )
    compress_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads sub/ and out/, writes compressed/",
    )

    nav_parser = subparsers.add_parser(
        "nav", help="Build the nav graph and emit + validate the SceneManifest"
    )
    nav_parser.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="Job working directory; reads sparse/, frames/, compressed/, writes manifest.json",
    )
    nav_parser.add_argument("--tour-id", type=str, required=True, help="Tour ID to embed in the manifest")
    nav_parser.add_argument(
        "--repo-root",
        type=Path,
        default=REPO_ROOT,
        help="Monorepo root containing packages/schema (for Zod validation)",
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
        if args.command == "extract":
            run_extract(args.videos_dir, args.workdir / "frames")
        elif args.command == "sfm":
            run_sfm(args.workdir, args.vocab_tree)
        elif args.command == "train":
            run_train(args.workdir, _train_config_override(args))
        elif args.command == "compress":
            run_compress(args.workdir)
        elif args.command == "nav":
            run_nav(args.workdir, args.tour_id, args.repo_root)
    except PipelineError as error:
        logger.error(str(error))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
