#!/usr/bin/env python3
"""Build basic metadata channel for a job output or image directory.

Usage:
    python tools/build_basic_metadata_channel.py --job-output <job_output>
    python tools/build_basic_metadata_channel.py --image-root <dir> --output <out>
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.basic_metadata import (
    analyze_single_image,
    build_metadata_summary,
    find_images,
    write_csv,
    VALID_EXTENSIONS,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Build basic metadata channel")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--job-output", type=str, help="Path to job output directory")
    group.add_argument("--image-root", type=str, help="Path to image directory")
    parser.add_argument("--output", type=str, help="Output directory (required for --image-root)")
    parser.add_argument("--max-workers", type=int, default=4, help="Max worker threads")
    return parser.parse_args()


def main():
    args = parse_args()
    t0 = datetime.now()

    if args.job_output:
        job_dir = Path(args.job_output)
        if not job_dir.is_dir():
            print(f"Error: job-output directory not found: {job_dir}")
            sys.exit(1)

        # Find image root from job state
        image_root_candidates = [
            job_dir,
            job_dir.parent,
        ]
        # Try to find features.csv with image paths
        features_csv = job_dir / "features.csv"
        if features_csv.exists():
            import pandas as pd
            df = pd.read_csv(features_csv)
            if "filename" in df.columns and len(df) > 0:
                # Use the first image's directory as root
                first_img = str(df["filename"].iloc[0])
                if first_img.startswith("..") or "/" in first_img or "\\" in first_img:
                    # Try to resolve relative to job dir
                    candidate = job_dir / first_img
                    if candidate.exists():
                        image_root = candidate.parent
                        while not image_root.exists() and image_root != image_root.parent:
                            image_root = image_root.parent
                    else:
                        image_root = find_image_root_from_paths(df["filename"].tolist(), job_dir)
                else:
                    # Filenames only, use job_dir as root
                    image_root = job_dir
            else:
                image_root = job_dir
        else:
            image_root = job_dir

        output_dir = job_dir / "analysis_channels"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "basic_metadata_summary.csv"

        print(f"Image root: {image_root}")
        images = find_images(image_root)
        print(f"Found {len(images)} images")

    elif args.image_root:
        image_root = Path(args.image_root)
        if not image_root.is_dir():
            print(f"Error: image-root directory not found: {image_root}")
            sys.exit(1)
        if not args.output:
            print("Error: --output is required with --image-root")
            sys.exit(1)
        output_path = Path(args.output) / "basic_metadata_summary.csv"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        images = find_images(image_root)
        print(f"Found {len(images)} images in {image_root}")

    if not images:
        print("No images found. Writing empty CSV.")
        write_csv([], output_path)
        print(f"Output: {output_path}")
        return

    print(f"Analyzing with {args.max_workers} workers...")
    results = build_metadata_summary(images, image_root, max_workers=args.max_workers)

    write_csv(results, output_path)
    elapsed = (datetime.now() - t0).total_seconds()
    print(f"Done. {len(results)} images analyzed in {elapsed:.1f}s")
    print(f"Output: {output_path}")

    # Quick summary
    with_orientation = sum(1 for r in results if r.get("orientation"))
    with_overexposed = sum(1 for r in results if r.get("overexposed_ratio") is not None)
    print(f"  Orientation: {with_orientation}/{len(results)}")
    print(f"  Exposure data: {with_overexposed}/{len(results)}")


def find_image_root_from_paths(paths, job_dir):
    """Try to find a common image root from a list of paths."""
    import os
    abs_paths = []
    for p in paths:
        candidate = job_dir / p
        if candidate.exists():
            abs_paths.append(candidate.resolve())
    if abs_paths:
        # Find common parent
        common = os.path.commonpath([str(a) for a in abs_paths])
        return Path(common)
    return job_dir


if __name__ == "__main__":
    main()
