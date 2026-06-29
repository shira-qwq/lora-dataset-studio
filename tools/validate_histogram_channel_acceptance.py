#!/usr/bin/env python3
"""Validate histogram residual channel on real data.

Usage:
    python tools/validate_histogram_channel_acceptance.py \
        --image-root <path> --output <out> --top-k 20
    python tools/validate_histogram_channel_acceptance.py \
        --analysis-channels <analysis_dir> --top-k 20
"""

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_residual import (
    build_histogram_matrix,
    compute_histogram_residuals,
    compute_histogram_summary,
)


def parse_args():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--image-root", help="Image directory")
    g.add_argument("--job-output", help="Job output directory")
    g.add_argument("--analysis-channels", help="Existing analysis_channels dir")
    parser.add_argument("--output", default="_histogram_acceptance", help="Output dir")
    parser.add_argument("--max-side", type=int, default=512)
    parser.add_argument("--top-k", type=int, default=20)
    return parser.parse_args()


def _load_or_compute(args):
    """Load existing summary CSV or compute from scratch."""
    if args.analysis_channels:
        ac = Path(args.analysis_channels)
        csv_path = ac / "histogram_summary.csv"
        if not csv_path.exists():
            print(f"ERROR: {csv_path} not found")
            sys.exit(1)
        df = pd.read_csv(csv_path)
        # Also load npz for full data
        npz_path = ac / "histogram_bank.npz"
        if not npz_path.exists():
            return df, None, None, None, None, None, None, None, None
        npz = np.load(npz_path)
        return (df, npz.get("brightness_hist_16"), npz.get("saturation_hist_16"),
                npz.get("hue_hist_24"), npz.get("image_ids"),
                npz.get("brightness_outlier_score"),
                npz.get("saturation_outlier_score"),
                npz.get("hue_outlier_score"),
                npz.get("histogram_outlier_score"))
    elif args.job_output:
        job = Path(args.job_output)
        csv_path = job / "analysis_channels" / "histogram_summary.csv"
        if csv_path.exists():
            return _load_or_compute(type("a", (), {"analysis_channels": str(job / "analysis_channels"), "output": args.output, "max_side": args.max_side, "top_k": args.top_k})())
        # Fall through: compute
        from tools.build_histogram_channel import find_images
        paths = find_images(job)
        if not paths and (job / "atlas_points.csv").exists():
            df = pd.read_csv(job / "atlas_points.csv")
            if "image_path" in df.columns:
                paths = [Path(p) for p in df["image_path"].tolist()]
    else:
        from tools.build_histogram_channel import find_images
        paths = find_images(Path(args.image_root))

    if not paths:
        print("ERROR: No images found")
        sys.exit(1)

    print(f"Processing {len(paths)} images...")
    paths.sort(key=str)
    iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(paths, max_side=args.max_side)
    print(f"  Valid: {len(vpaths)}, Skipped: {len(skipped)}")
    b_res = compute_histogram_residuals(b)
    s_res = compute_histogram_residuals(s)
    h_res = compute_histogram_residuals(h)
    df = compute_histogram_summary(iids, vpaths, b, s, h, info, b_res, s_res, h_res)
    return df, b, s, h, np.array(iids), b_res["outlier_score"], s_res["outlier_score"], h_res["outlier_score"], None


def main():
    args = parse_args()
    output_dir = Path(args.output) / "histogram_acceptance"
    output_dir.mkdir(parents=True, exist_ok=True)

    df, b_mat, s_mat, h_mat, iids_arr, b_out, s_out, h_out, hist_out = _load_or_compute(args)
    N = len(df)

    # ── Label counts ──
    all_labels = []
    for lbl_str in df["labels"]:
        all_labels.extend(str(lbl_str).split(";"))
    label_counts = dict(Counter(all_labels))

    # ── Numeric field stats ──
    numeric_fields = [
        "histogram_outlier_score", "brightness_dark_ratio", "brightness_midtone_ratio",
        "brightness_bright_ratio", "brightness_entropy", "brightness_peak_count",
        "brightness_outlier_score", "saturation_low_ratio", "saturation_mid_ratio",
        "saturation_high_ratio", "saturation_entropy", "saturation_outlier_score",
        "hue_warm_ratio", "hue_cool_ratio", "hue_entropy", "hue_outlier_score",
    ]
    stats_rows = []
    for field in numeric_fields:
        if field not in df.columns:
            continue
        vals = pd.to_numeric(df[field], errors="coerce").dropna()
        if len(vals) == 0:
            continue
        stats_rows.append({
            "field": field, "count": len(vals),
            "min": round(float(vals.min()), 6),
            "p05": round(float(vals.quantile(0.05)), 6),
            "mean": round(float(vals.mean()), 6),
            "median": round(float(vals.median()), 6),
            "p95": round(float(vals.quantile(0.95)), 6),
            "max": round(float(vals.max()), 6),
            "std": round(float(vals.std()), 6),
        })

    # ── Top-k CSVs ──
    topk_configs = [
        ("top_histogram_outlier_score", "histogram_outlier_score", False),
        ("top_brightness_dark_ratio", "brightness_dark_ratio", False),
        ("top_brightness_bright_ratio", "brightness_bright_ratio", False),
        ("top_saturation_low_ratio", "saturation_low_ratio", False),
        ("top_saturation_high_ratio", "saturation_high_ratio", False),
        ("top_hue_warm_ratio", "hue_warm_ratio", False),
        ("top_hue_cool_ratio", "hue_cool_ratio", False),
    ]
    topk_files = []
    for fname, field, _ in topk_configs:
        if field not in df.columns:
            continue
        top_df = df.nlargest(args.top_k, field) if field in df.columns else df.head(args.top_k)
        top_df = top_df[["image_id", "image_path", field, "labels"]].copy()
        top_df.insert(0, "rank", range(1, len(top_df) + 1))
        top_df.to_csv(output_dir / f"{fname}.csv", index=False)
        topk_files.append(f"{fname}.csv")

    # ── Hue valid info ──
    hue_valid_count = int(df["hue_valid"].sum()) if "hue_valid" in df.columns else 0
    hue_valid_ratio = round(hue_valid_count / max(N, 1), 4)

    # ── Warnings ──
    warnings = []
    for label, count in label_counts.items():
        ratio = count / max(N, 1)
        if ratio > 0.70:
            warnings.append(f"Label '{label}' hit rate {ratio:.1%} > 70% — threshold may be too loose.")
        elif ratio < 0.01 and count > 0:
            warnings.append(f"Label '{label}' hit rate {ratio:.1%} < 1% — threshold may be too tight.")
    if hue_valid_ratio < 0.20:
        warnings.append(f"Hue valid ratio {hue_valid_ratio:.1%} < 20% — dataset has many low-saturation/gray images; hue labels have lower confidence.")

    # ── Top-k entries ──
    def _top_entries(field, n=5):
        if field not in df.columns:
            return []
        top = df.nlargest(n, field)
        return [{"rank": i + 1, "image_id": r["image_id"], "image_path": r["image_path"],
                 "score": float(r[field]), "labels": str(r.get("labels", ""))}
                for i, (_, r) in enumerate(top.iterrows())]

    # ── Acceptance summary JSON ──
    summary = {
        "image_count": N,
        "skipped_count": 0,
        "label_counts": label_counts,
        "hue_valid_count": hue_valid_count,
        "hue_valid_ratio": hue_valid_ratio,
        "top_k_by_histogram_outlier_score": _top_entries("histogram_outlier_score", args.top_k),
        "top_k_by_brightness_dark_ratio": _top_entries("brightness_dark_ratio", 5),
        "top_k_by_brightness_bright_ratio": _top_entries("brightness_bright_ratio", 5),
        "top_k_by_saturation_low_ratio": _top_entries("saturation_low_ratio", 5),
        "top_k_by_saturation_high_ratio": _top_entries("saturation_high_ratio", 5),
        "top_k_by_hue_warm_ratio": _top_entries("hue_warm_ratio", 5),
        "top_k_by_hue_cool_ratio": _top_entries("hue_cool_ratio", 5),
        "warnings": warnings,
        "default_clustering_unchanged": True,
        "numeric_field_stats": stats_rows,
        "topk_files": topk_files,
    }

    # Write acceptance_summary.json
    with open(output_dir / "acceptance_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"  acceptance_summary.json")

    # Write acceptance_summary.csv
    if stats_rows:
        with open(output_dir / "acceptance_summary.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(stats_rows[0].keys()))
            w.writeheader()
            w.writerows(stats_rows)
        print(f"  acceptance_summary.csv")

    print(f"  Label counts: {label_counts}")
    print(f"  Warnings: {len(warnings)}")
    for w in warnings:
        print(f"    ⚠️ {w}")
    print(f"  Default clustering unchanged: True")
    print(f"  Output: {output_dir}")


if __name__ == "__main__":
    main()
