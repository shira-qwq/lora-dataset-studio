#!/usr/bin/env python3
"""Build histogram residual channel for a job output or image directory.

Usage:
    python tools/build_histogram_channel.py --job-output <job_output>
    python tools/build_histogram_channel.py --image-root <dir> --output <out>
    python tools/build_histogram_channel.py --job-output <job_output> --max-side 512
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_residual import (
    build_histogram_matrix,
    compute_histogram_residuals,
    compute_histogram_summary,
    compute_image_histograms,
    VALID_EXTENSIONS,
)


def find_images(root: Path) -> List[Path]:
    """Recursively find images, sorted for reproducibility."""
    images = []
    for ext in VALID_EXTENSIONS:
        images.extend(root.rglob(f"*{ext}"))
    images.sort(key=str)
    return images


def parse_args():
    parser = argparse.ArgumentParser(description="Build histogram residual channel")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--job-output", type=str, help="Path to job output directory")
    group.add_argument("--image-root", type=str, help="Path to image directory")
    parser.add_argument("--output", type=str, help="Output directory (required for --image-root)")
    parser.add_argument("--max-side", type=int, default=512, help="Max side in pixels")
    return parser.parse_args()


def main():
    args = parse_args()

    if args.job_output:
        job_dir = Path(args.job_output)
        if not job_dir.exists():
            print(f"ERROR: Job output not found: {job_dir}")
            sys.exit(1)
        # Try to find image paths from atlas_points.csv or features.csv
        image_paths = []
        atlas_path = job_dir / "atlas_points.csv"
        if atlas_path.exists():
            import pandas as pd
            df = pd.read_csv(atlas_path)
            if "image_path" in df.columns:
                image_paths = [Path(p) for p in df["image_path"].tolist()]
        if not image_paths:
            csv_path = job_dir / "features.csv"
            if csv_path.exists():
                import pandas as pd
                df = pd.read_csv(csv_path)
                if "filename" in df.columns:
                    # Filenames are relative; try to find parent
                    image_paths = [job_dir.parent / f for f in df["filename"].tolist()]

        if not image_paths:
            print("ERROR: Could not find image paths from job output. Use --image-root instead.")
            sys.exit(1)

        output_dir = job_dir / "analysis_channels"
        max_side = args.max_side

    else:  # --image-root
        image_root = Path(args.image_root)
        if not image_root.exists():
            print(f"ERROR: Image root not found: {image_root}")
            sys.exit(1)
        if not args.output:
            print("ERROR: --output required when using --image-root")
            sys.exit(1)
        output_dir = Path(args.output) / "analysis_channels"
        max_side = args.max_side
        image_paths = find_images(image_root)

    if not image_paths:
        print("ERROR: No images found")
        sys.exit(1)

    print(f"Processing {len(image_paths)} images (max_side={max_side})...")
    print(f"Output: {output_dir}")

    # Build histogram matrices (streaming reads)
    image_ids, valid_paths, skipped, b_mat, s_mat, h_mat, info_list = \
        build_histogram_matrix(image_paths, max_side=max_side)

    print(f"  Valid: {b_mat.shape[0]}, Skipped: {len(skipped)}")

    if b_mat.shape[0] == 0:
        print("ERROR: No valid images processed")
        sys.exit(1)

    # Compute residuals
    b_res = compute_histogram_residuals(b_mat)
    s_res = compute_histogram_residuals(s_mat)
    h_res = compute_histogram_residuals(h_mat)

    # Compute summary
    summary_df = compute_histogram_summary(
        image_ids, valid_paths, b_mat, s_mat, h_mat, info_list,
        b_res, s_res, h_res,
    )

    # Write output
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. histogram_bank.npz
    npz_path = output_dir / "histogram_bank.npz"
    np.savez_compressed(
        npz_path,
        image_ids=image_ids,
        image_paths=[str(p) for p in valid_paths],
        brightness_hist_16=b_mat,
        saturation_hist_16=s_mat,
        hue_hist_24=h_mat,
        brightness_residual_16=b_res["residual"],
        saturation_residual_16=s_res["residual"],
        hue_residual_24=h_res["residual"],
        brightness_z_residual_16=b_res["z_residual"],
        saturation_z_residual_16=s_res["z_residual"],
        hue_z_residual_24=h_res["z_residual"],
        brightness_mean_16=b_res["mean"],
        saturation_mean_16=s_res["mean"],
        hue_mean_24=h_res["mean"],
        brightness_std_16=b_res["std"],
        saturation_std_16=s_res["std"],
        hue_std_24=h_res["std"],
    )
    print(f"  NPZ: {npz_path} ({npz_path.stat().st_size / 1024:.1f} KB)")

    # 2. histogram_summary.csv
    csv_path = output_dir / "histogram_summary.csv"
    summary_df.to_csv(csv_path, index=False)
    print(f"  CSV: {csv_path} ({len(summary_df)} rows)")

    # 3. histogram_labels.json
    labels_dict = {}
    for _, row in summary_df.iterrows():
        labels_dict[row["image_id"]] = {
            "labels": row["labels"].split(";") if row["labels"] else [],
            "histogram_outlier_score": row["histogram_outlier_score"],
        }
    labels_path = output_dir / "histogram_labels.json"
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(labels_dict, f, indent=2, ensure_ascii=False)
    print(f"  Labels: {labels_path}")

    # 4. histogram_manifest.json
    manifest = {
        "created_at": datetime.now().isoformat(),
        "image_count": b_mat.shape[0],
        "input_image_count": len(image_paths),
        "skipped_count": len(skipped),
        "max_side": max_side,
        "brightness_bins": 16,
        "saturation_bins": 16,
        "hue_bins": 24,
        "dtype": "float32",
        "output_files": {
            "histogram_bank_npz": "histogram_bank.npz",
            "histogram_summary_csv": "histogram_summary.csv",
            "histogram_labels_json": "histogram_labels.json",
            "histogram_manifest_json": "histogram_manifest.json",
        },
        "default_clustering_unchanged": True,
    }
    manifest_path = output_dir / "histogram_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"  Manifest: {manifest_path}")

    # 5. skipped_images.csv
    if skipped:
        skip_path = output_dir / "skipped_images.csv"
        with open(skip_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["image_path", "reason"])
            w.writeheader()
            w.writerows(skipped)
        print(f"  Skipped: {skip_path} ({len(skipped)} records)")

    print("\nDone. Default clustering UNCHANGED.")


if __name__ == "__main__":
    main()
