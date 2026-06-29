#!/usr/bin/env python3
"""A/B compare histogram label configs (v4.4h-5).

Compares default HistogramLabelConfig vs a suggested config.

Usage:
    python tools/compare_histogram_label_configs.py \
        --summary-csv "path/to/histogram_summary.csv" \
        --suggested-config "_calib/v1/histogram_label_config_suggested.json" \
        --output "_ab_compare/result"
"""

import argparse
import copy
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_label_config import (
    HistogramLabelConfig, DEFAULT_LABEL_CONFIG,
)
from lighting_engine.core.analysis_channels.histogram_residual import (
    compute_label_masks, compute_labels_from_masks,
)


def load_suggested_config(path: str) -> HistogramLabelConfig:
    """Load suggested config JSON and return HistogramLabelConfig."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    cfg_dict = data.get("config", data)
    # Filter to only valid HistogramLabelConfig fields
    valid_fields = set(HistogramLabelConfig.__dataclass_fields__.keys())
    filtered = {k: v for k, v in cfg_dict.items() if k in valid_fields}
    return HistogramLabelConfig(**filtered)


def compute_labels(df: pd.DataFrame, config: HistogramLabelConfig) -> pd.Series:
    """Compute semicolon-joined labels for given config."""
    masks = compute_label_masks(df, config)
    return compute_labels_from_masks(masks, df)


def find_summary_csvs(paths_or_dirs: List[str]) -> List[str]:
    """Find histogram_summary.csv files from paths or directories."""
    results = []
    for p in paths_or_dirs:
        pp = Path(p)
        if pp.is_file() and pp.name == "histogram_summary.csv":
            results.append(str(pp))
        elif pp.is_dir():
            candidate = pp / "histogram_summary.csv"
            if candidate.exists():
                results.append(str(candidate))
    return results


def parse_args():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--summary-csv", nargs="+", help="One or more histogram_summary.csv paths")
    group.add_argument("--analysis-channels-dir", action="append", default=[])
    parser.add_argument("--suggested-config", required=True, help="Path to suggested config JSON")
    parser.add_argument("--output", required=True, help="Output directory")
    return parser.parse_args()


def main():
    args = parse_args()

    # Collect CSVs
    csv_paths = []
    if args.summary_csv:
        csv_paths = args.summary_csv
    elif args.analysis_channels_dir:
        for d in args.analysis_channels_dir:
            p = Path(d) / "histogram_summary.csv"
            if p.exists():
                csv_paths.append(str(p))

    if not csv_paths:
        print("ERROR: No histogram_summary.csv files found.")
        sys.exit(1)

    # Load suggested config
    suggested_config = load_suggested_config(args.suggested_config)
    default_config = DEFAULT_LABEL_CONFIG

    # Load data
    df_list = []
    print(f"Loading {len(csv_paths)} summary files...")
    for path in csv_paths:
        df = pd.read_csv(path)
        df["_source"] = Path(path).parent.parent.name  # dataset name from dir structure
        df_list.append(df)
        print(f"  {path}: {len(df)} rows")

    df_all = pd.concat(df_list, ignore_index=True)
    N = len(df_all)
    print(f"Total images: {N}")

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    top_dir = output_dir / "label_ab_top_changes"
    top_dir.mkdir(parents=True, exist_ok=True)

    # Compute labels for both configs
    labels_default = compute_labels(df_all, default_config)
    labels_suggested = compute_labels(df_all, suggested_config)

    # Parse label sets
    def parse_lbl(s):
        return set(s.split(";")) if s != "unclassified" else set()

    default_sets = [parse_lbl(s) for s in labels_default]
    suggested_sets = [parse_lbl(s) for s in labels_suggested]

    # Per-label counts
    all_labels = set()
    for s in default_sets: all_labels.update(s)
    for s in suggested_sets: all_labels.update(s)

    label_counts_default = {}
    label_counts_suggested = {}
    label_added = defaultdict(int)
    label_removed = defaultdict(int)

    for label in sorted(all_labels):
        if label == "unclassified" or label == "":
            continue
        label_counts_default[label] = sum(1 for s in default_sets if label in s)
        label_counts_suggested[label] = sum(1 for s in suggested_sets if label in s)
        for i in range(N):
            if label not in default_sets[i] and label in suggested_sets[i]:
                label_added[label] += 1
            if label in default_sets[i] and label not in suggested_sets[i]:
                label_removed[label] += 1

    # Changed images
    changed_idx = [i for i in range(N) if default_sets[i] != suggested_sets[i]]
    changed_image_ratio = len(changed_idx) / max(N, 1)

    # Unclassified
    uc_default = sum(1 for s in default_sets if not s)
    uc_suggested = sum(1 for s in suggested_sets if not s)

    # Per-image diff
    diff_rows = []
    for i in changed_idx:
        added = suggested_sets[i] - default_sets[i]
        removed = default_sets[i] - suggested_sets[i]
        row = {
            "dataset": df_all.iloc[i].get("_source", ""),
            "image_id": df_all.iloc[i].get("image_id", ""),
            "image_path": df_all.iloc[i].get("image_path", ""),
            "labels_default": ";".join(sorted(default_sets[i])) if default_sets[i] else "unclassified",
            "labels_suggested": ";".join(sorted(suggested_sets[i])) if suggested_sets[i] else "unclassified",
            "added_labels": ";".join(sorted(added)),
            "removed_labels": ";".join(sorted(removed)),
            "changed_label_count": len(added) + len(removed),
        }
        for field in ["histogram_outlier_score", "brightness_dark_ratio",
                       "brightness_bright_ratio", "saturation_low_ratio",
                       "saturation_high_ratio", "hue_warm_ratio",
                       "hue_cool_ratio", "hue_entropy"]:
            if field in df_all.columns:
                row[field] = df_all.iloc[i][field]
        diff_rows.append(row)

    diff_df = pd.DataFrame(diff_rows) if diff_rows else pd.DataFrame()

    # Write diff CSV
    diff_path = output_dir / "label_ab_diff.csv"
    diff_df.to_csv(diff_path, index=False)
    print(f"Diff CSV: {diff_path} ({len(diff_df)} rows)")

    # Write top changes CSVs
    focus_fields = [
        ("added_high_contrast", "added_labels", "high_contrast"),
        ("added_mixed_color", "added_labels", "mixed_color"),
        ("added_muted", "added_labels", "muted"),
        ("added_low_key", "added_labels", "low_key"),
        ("added_high_key", "added_labels", "high_key"),
        ("changed_warm_cool", "added_labels", None),  # any warm/cool change
        ("became_classified", "labels_default", "unclassified"),
        ("became_unclassified", "labels_suggested", "unclassified"),
    ]

    for fname, field, value in focus_fields:
        if diff_df.empty:
            pd.DataFrame().to_csv(top_dir / f"{fname}.csv", index=False)
            continue
        if value:
            subset = diff_df[diff_df[field].str.contains(value, na=False)]
        elif fname == "changed_warm_cool":
            subset = diff_df[diff_df["added_labels"].str.contains("warm|cool", na=False, regex=True)]
        else:
            subset = diff_df
        subset = subset.head(100)
        subset.to_csv(top_dir / f"{fname}.csv", index=False)

    # Most changed
    if not diff_df.empty and "changed_label_count" in diff_df.columns:
        most_changed = diff_df.nlargest(100, "changed_label_count")
    else:
        most_changed = diff_df.head(100)
    most_changed.to_csv(top_dir / "most_changed.csv", index=False)

    # Warnings
    warnings = []
    for label, rate in sorted(label_counts_suggested.items()):
        r = rate / N
        if r > 0.70:
            warnings.append(f"Suggested '{label}' hit rate {r:.1%} > 70% — possibly too loose.")
        if r < 0.01 and rate > 0:
            warnings.append(f"Suggested '{label}' hit rate {r:.1%} < 1% — possibly too tight.")

    # Recommendation logic
    uc_suggested_rate = uc_suggested / max(N, 1)
    uc_default_rate = uc_default / max(N, 1)
    muted_rate = label_counts_suggested.get("muted", 0) / max(N, 1)
    mc_rate = label_counts_suggested.get("mixed_color", 0) / max(N, 1)
    hc_rate = label_counts_suggested.get("high_contrast", 0) / max(N, 1)

    safe = True
    reasons = []
    if changed_image_ratio >= 0.35:
        safe = False; reasons.append(f"changed_image_ratio {changed_image_ratio:.1%} >= 35%")
    if uc_suggested_rate > uc_default_rate + 0.05:
        safe = False; reasons.append(f"unclassified increased {uc_default_rate:.1%}→{uc_suggested_rate:.1%}")
    if muted_rate > 0.40:
        safe = False; reasons.append(f"muted rate {muted_rate:.1%} > 40%")
    if mc_rate < 0.03 or mc_rate > 0.15:
        safe = False; reasons.append(f"mixed_color rate {mc_rate:.1%} outside 3-15%")
    if hc_rate < 0.02 or hc_rate > 0.15:
        safe = False; reasons.append(f"high_contrast rate {hc_rate:.1%} outside 2-15%")

    # Warm/cool overlap
    masks_suggested = compute_label_masks(df_all, suggested_config)
    overlap = float(np.mean(masks_suggested.get("warm", pd.Series([False]*N)) &
                             masks_suggested.get("cool", pd.Series([False]*N))))
    if overlap > 0.10:
        safe = False; reasons.append(f"warm/cool overlap {overlap:.1%} > 10%")

    recommendation = {
        "safe_to_apply_suggested_config": safe,
        "reasons": reasons if not safe else ["All checks passed"],
    }

    # Build summary JSON
    summary = {
        "input_files": csv_paths,
        "image_count": N,
        "default_config": {k: round(float(getattr(default_config, k)), 4)
                           for k in HistogramLabelConfig.__dataclass_fields__},
        "suggested_config": {k: round(float(getattr(suggested_config, k)), 4)
                             for k in HistogramLabelConfig.__dataclass_fields__},
        "label_counts_default": dict(sorted(label_counts_default.items())),
        "label_counts_suggested": dict(sorted(label_counts_suggested.items())),
        "label_rate_default": {k: round(v / N, 4) for k, v in sorted(label_counts_default.items())},
        "label_rate_suggested": {k: round(v / N, 4) for k, v in sorted(label_counts_suggested.items())},
        "label_added_counts": dict(label_added),
        "label_removed_counts": dict(label_removed),
        "changed_image_count": len(changed_idx),
        "changed_image_ratio": round(changed_image_ratio, 4),
        "unclassified_default": int(uc_default),
        "unclassified_suggested": int(uc_suggested),
        "unclassified_rate_default": round(uc_default_rate, 4),
        "unclassified_rate_suggested": round(uc_suggested_rate, 4),
        "warnings": warnings,
        "recommendation": recommendation,
        "default_clustering_unchanged": True,
    }

    summary_path = output_dir / "label_ab_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Summary: {summary_path}")

    # Print summary
    print(f"\n  Changed images: {len(changed_idx)}/{N} ({changed_image_ratio:.1%})")
    print(f"  Unclassified: {uc_default} → {uc_suggested}")
    print(f"\n  Label rates (default → suggested):")
    for label in sorted(all_labels):
        if label == "":
            continue
        dr = label_counts_default.get(label, 0) / N * 100
        sr = label_counts_suggested.get(label, 0) / N * 100
        added = label_added.get(label, 0)
        removed = label_removed.get(label, 0)
        print(f"    {label:<20} {dr:5.1f}% → {sr:5.1f}%  (+{added}/-{removed})")

    print(f"\n  Recommendation: {'SAFE ✅' if safe else 'NOT SAFE ❌'}")
    if not safe:
        for r in reasons:
            print(f"    - {r}")

    print(f"\n  Default clustering unchanged: True")
    print(f"  Output: {output_dir}")


if __name__ == "__main__":
    main()
