#!/usr/bin/env python3
"""Build Quality + Edge Analysis Channel.

Usage:
    python tools/build_quality_edge_channel.py --job-output <job_output>
    python tools/build_quality_edge_channel.py --image-root <dir> --output <out>
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.quality_edge import (
    build_quality_edge_matrix, VALID_EXTENSIONS,
)


def find_images(root: Path) -> list:
    images = []
    for ext in VALID_EXTENSIONS:
        images.extend(root.rglob(f"*{ext}"))
    images.sort(key=str)
    return images


def parse_args():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--job-output", help="Job output directory")
    g.add_argument("--image-root", help="Image directory")
    parser.add_argument("--output", help="Output dir (required for --image-root)")
    parser.add_argument("--max-side", type=int, default=512)
    return parser.parse_args()


def main():
    args = parse_args()

    if args.job_output:
        job_dir = Path(args.job_output)
        output_dir = job_dir / "analysis_channels"
        # Try to find image paths
        image_paths = []
        atlas = job_dir / "atlas_points.csv"
        if atlas.exists():
            df = pd.read_csv(atlas)
            if "image_path" in df.columns:
                image_paths = [Path(p) for p in df["image_path"].tolist()]
        if not image_paths:
            print("ERROR: Cannot find image paths from job output. Use --image-root.")
            sys.exit(1)
    else:
        root = Path(args.image_root)
        if not args.output:
            print("ERROR: --output required with --image-root")
            sys.exit(1)
        output_dir = Path(args.output) / "analysis_channels"
        image_paths = find_images(root)

    if not image_paths:
        print("ERROR: No images found")
        sys.exit(1)

    # Load histogram summary if available
    hist_path = output_dir / "histogram_summary.csv"
    hist_summary = None
    if hist_path.exists():
        hist_summary = pd.read_csv(hist_path)
        print(f"  Found histogram_summary.csv ({len(hist_summary)} rows) — merging fields")

    print(f"Processing {len(image_paths)} images (max_side={args.max_side})...")
    iids, vpaths, skipped, df, manifest_data = build_quality_edge_matrix(
        image_paths, max_side=args.max_side, histogram_summary=hist_summary,
    )
    print(f"  Valid: {len(vpaths)}, Skipped: {len(skipped)}")

    if df.empty:
        print("ERROR: No valid images")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    # CSV
    csv_path = output_dir / "quality_edge_summary.csv"
    df.to_csv(csv_path, index=False)
    print(f"  CSV: {csv_path} ({len(df)} rows)")

    # Manifest
    manifest = {
        "created_at": datetime.now().isoformat(),
        "image_count": len(df),
        "skipped_count": len(skipped),
        "max_side": args.max_side,
        "histogram_merged": hist_summary is not None,
        "output_files": {"quality_edge_summary_csv": "quality_edge_summary.csv"},
        "default_clustering_unchanged": True,
    }
    with open(output_dir / "quality_edge_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"  Manifest: {output_dir / 'quality_edge_manifest.json'}")

    # Skipped
    if skipped:
        with open(output_dir / "skipped_quality_edge.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["image_path", "reason"])
            w.writeheader()
            w.writerows(skipped)
        print(f"  Skipped: {len(skipped)} files")

    print("\nDone. Default clustering unchanged.")


if __name__ == "__main__":
    main()
