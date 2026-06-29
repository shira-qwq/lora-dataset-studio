#!/usr/bin/env python3
"""Histogram label auto-calibration CLI (v4.4h-4).

Reads histogram_summary.csv files, calibrates thresholds,
outputs suggested config + report. Does NOT modify clustering.
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

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_label_config import (
    HistogramLabelConfig, DEFAULT_LABEL_CONFIG,
)
from lighting_engine.core.analysis_channels.histogram_label_calibrator import (
    OPTUNA_AVAILABLE,
    coarse_calibrate_thresholds,
    coarse_calibrate_high_contrast,
    optuna_calibrate,
    score_config,
    compute_label_rates,
    compute_per_dataset_rates,
    TARGET_RANGES_PROFILES,
    SKIP_PARAMETERS,
    SINGLE_FIELD_RULES,
)
from lighting_engine.core.analysis_channels.histogram_residual import (
    compute_label_masks, compute_labels_from_masks,
)


def find_summary_csvs(acceptance_dir: str) -> List[str]:
    """Recursively find histogram_summary.csv under an acceptance directory."""
    base = Path(acceptance_dir)
    results = []
    for p in base.rglob("histogram_summary.csv"):
        results.append(str(p))
    if not results:
        # Try acceptance subdirectories
        for p in base.rglob("acceptance_summary.json"):
            d = p.parent.parent / "analysis_channels"
            if (d / "histogram_summary.csv").exists():
                results.append(str(d / "histogram_summary.csv"))
    return results


def parse_args():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--summary-csv", nargs="+", help="One or more histogram_summary.csv paths")
    group.add_argument("--analysis-channels-dir", action="append", default=[], help="Analysis channels dir(s)")
    group.add_argument("--acceptance-dir", help="Acceptance output dir (recursive)")
    parser.add_argument("--output", default="_histogram_label_calibration", help="Output dir")
    parser.add_argument("--use-optuna", action="store_true", default=None, help="Enable Optuna")
    parser.add_argument("--no-optuna", action="store_true", default=None, help="Disable Optuna")
    parser.add_argument("--n-trials", type=int, default=80)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--target-profile", choices=["default", "conservative", "broad"], default="default")
    parser.add_argument("--write-suggested-config", action="store_true", help="Write suggested config JSON")
    parser.add_argument("--top-k", type=int, default=20)
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect summary CSV paths
    csv_paths = []
    if args.summary_csv:
        csv_paths = args.summary_csv
    elif args.analysis_channels_dir:
        for d in args.analysis_channels_dir:
            p = Path(d) / "histogram_summary.csv"
            if p.exists():
                csv_paths.append(str(p))
    elif args.acceptance_dir:
        csv_paths = find_summary_csvs(args.acceptance_dir)

    if not csv_paths:
        print("ERROR: No histogram_summary.csv files found.")
        sys.exit(1)

    # Load dataframes
    df_list = []
    print(f"Loading {len(csv_paths)} summary files...")
    for path in csv_paths:
        df = pd.read_csv(path)
        df_list.append(df)
        print(f"  {path}: {len(df)} rows")

    df_all = pd.concat(df_list, ignore_index=True)
    print(f"Total images: {len(df_all)}")

    # Determine optuna
    use_optuna = args.use_optuna
    if use_optuna is None:
        use_optuna = OPTUNA_AVAILABLE and not args.no_optuna

    target_ranges = TARGET_RANGES_PROFILES.get(args.target_profile, TARGET_RANGES_PROFILES["default"])

    base_config = DEFAULT_LABEL_CONFIG

    # Baseline rates
    baseline_rates = compute_label_rates(df_all, base_config)
    baseline_per_ds = compute_per_dataset_rates(df_list, base_config)

    print(f"\nBaseline rates:")
    for label, rate in sorted(baseline_rates.items()):
        tmin, tmax = target_ranges.get(label, (0, 1))
        flag = " ✓" if tmin <= rate <= tmax else " ✗"
        print(f"  {label:<20} {rate:.1%} (target {tmin:.0%}-{tmax:.0%}){flag}")

    # Stage 1: Coarse calibration
    print(f"\n--- Coarse calibration ---")
    coarse_config, coarse_steps = coarse_calibrate_thresholds(df_list, base_config, target_ranges)

    # High contrast grid
    hc_dark, hc_bright, hc_steps = coarse_calibrate_high_contrast(df_list, coarse_config, target_ranges)
    coarse_config.high_contrast_dark_ratio = hc_dark
    coarse_config.high_contrast_bright_ratio = hc_bright

    coarse_rates = compute_label_rates(df_all, coarse_config)
    print(f"Coarse rates:")
    for label, rate in sorted(coarse_rates.items()):
        tmin, tmax = target_ranges.get(label, (0, 1))
        flag = " ✓" if tmin <= rate <= tmax else " ✗"
        print(f"  {label:<20} {rate:.1%} (target {tmin:.0%}-{tmax:.0%}){flag}")

    # Stage 2: Optuna
    optuna_config = None
    optuna_steps = []
    optuna_best = None
    if use_optuna:
        print(f"\n--- Optuna fine-tuning (n_trials={args.n_trials}) ---")
        optuna_config, optuna_steps, optuna_best = optuna_calibrate(
            df_list, coarse_config, target_ranges, base_config,
            n_trials=args.n_trials, seed=args.seed,
        )
        if optuna_config:
            optuna_rates = compute_label_rates(df_all, optuna_config)
            print(f"Optuna rates:")
            for label, rate in sorted(optuna_rates.items()):
                tmin, tmax = target_ranges.get(label, (0, 1))
                flag = " ✓" if tmin <= rate <= tmax else " ✗"
                print(f"  {label:<20} {rate:.1%} (target {tmin:.0%}-{tmax:.0%}){flag}")
    else:
        print(f"\n  Optuna not available or disabled.")
        optuna_config = None

    # Final suggested
    final_config = optuna_config if optuna_config else coarse_config
    final_rates = compute_label_rates(df_all, final_config)

    # Warnings
    warnings = []
    hidden_labels = []
    for label, rate in final_rates.items():
        tmin, tmax = target_ranges.get(label, (None, None))
        if tmax and rate > 0.70:
            warnings.append(f"Label '{label}' hit rate {rate:.1%} > 70% — may be too loose.")
        if tmin and rate < 0.01 and tmin >= 0.02:
            warnings.append(f"Label '{label}' hit rate {rate:.1%} < 1% — may be too tight.")

    # Labels to hide
    for label in ["lineart_like_candidate", "mixed_color", "high_contrast"]:
        rate = final_rates.get(label, 0)
        if rate < 0.03:
            hidden_labels.append({
                "label": label,
                "reason": f"Hit rate {rate:.1%} too low for reliable sorting/filtering.",
                "suggest_action": "hide_from_default_filter",
            })

    # Build output
    suggested_config_dict = {}
    for fname in HistogramLabelConfig.__dataclass_fields__:
        val = getattr(final_config, fname)
        if isinstance(val, float):
            suggested_config_dict[fname] = round(val, 4)
        else:
            suggested_config_dict[fname] = val

    # Write histogram_label_config_suggested.json
    suggested = {
        "version": "v1",
        "source": "auto_calibration",
        "method": "coarse_then_optuna" if optuna_config else "coarse_only",
        "config": suggested_config_dict,
        "do_not_auto_apply": True,
    }
    suggested_path = output_dir / "histogram_label_config_suggested.json"
    with open(suggested_path, "w", encoding="utf-8") as f:
        json.dump(suggested, f, indent=2, ensure_ascii=False)
    print(f"\nSuggested config: {suggested_path}")

    # Write calibration_report.json
    report = {
        "input_files": csv_paths,
        "dataset_count": len(df_list),
        "total_images": len(df_all),
        "method": suggested["method"],
        "optuna_available": OPTUNA_AVAILABLE,
        "optuna_used": optuna_config is not None,
        "target_profile": args.target_profile,
        "baseline_config": {f: round(getattr(base_config, f), 4) for f in HistogramLabelConfig.__dataclass_fields__},
        "coarse_config": {f: round(getattr(coarse_config, f), 4) for f in HistogramLabelConfig.__dataclass_fields__},
        "final_suggested_config": suggested_config_dict,
        "before_label_rates": {k: round(v, 4) for k, v in baseline_rates.items()},
        "after_label_rates": {k: round(v, 4) for k, v in final_rates.items()},
        "warnings": warnings,
        "hidden_label_recommendations": hidden_labels,
        "default_clustering_unchanged": True,
    }
    if optuna_best is not None:
        report["optuna_best_score"] = optuna_best
    report_path = output_dir / "calibration_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Report: {report_path}")

    # Write calibration_steps.csv
    all_steps = coarse_steps + hc_steps + optuna_steps
    if all_steps:
        import csv
        steps_path = output_dir / "calibration_steps.csv"
        # Collect all keys from all steps
        all_keys = set()
        for s in all_steps:
            all_keys.update(s.keys())
        all_keys = sorted(all_keys)
        with open(steps_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
            w.writeheader()
            w.writerows(all_steps)
        print(f"Steps: {steps_path}")

    # Write calibration_report.md
    md_lines = []
    md_lines.append("# Histogram Label Calibration Report")
    md_lines.append("")
    md_lines.append(f"> Generated: {datetime.now().isoformat()}")
    md_lines.append(f"> Input files: {len(csv_paths)}")
    md_lines.append(f"> Total images: {len(df_all)}")
    md_lines.append(f"> Method: {suggested['method']}")
    md_lines.append(f"> Optuna available: {OPTUNA_AVAILABLE}")
    md_lines.append("")
    md_lines.append("## Baseline vs Suggested")
    md_lines.append("")
    md_lines.append("| Label | Baseline Config | Suggested Config | Before Rate | After Rate | Target Range |")
    md_lines.append("|-------|:--------------:|:----------------:|:-----------:|:----------:|:------------:|")
    for label in sorted(target_ranges.keys()):
        param = None
        for lb, pm, _, _ in SINGLE_FIELD_RULES:
            if lb == label:
                param = pm; break
        if label == "high_contrast":
            param = "high_contrast_dark_ratio"
        if param is None:
            continue
        tmin, tmax = target_ranges.get(label, (0, 1))
        bv = round(getattr(base_config, param, 0), 3)
        fv = round(suggested_config_dict.get(param, bv), 3)
        br = round(baseline_rates.get(label, 0), 3)
        fr = round(final_rates.get(label, 0), 3)
        md_lines.append(f"| {label} | {bv} | {fv} | {br:.1%} | {fr:.1%} | {tmin:.0%}-{tmax:.0%} |")
    md_lines.append("")

    md_lines.append("## Threshold Changes")
    md_lines.append("")
    changed = 0
    for param in HistogramLabelConfig.__dataclass_fields__:
        if param in SKIP_PARAMETERS:
            continue
        old_val = getattr(base_config, param)
        new_val = suggested_config_dict.get(param, old_val)
        if abs(old_val - new_val) > 0.001:
            md_lines.append(f"- `{param}`: {old_val} → {new_val}")
            changed += 1
    if changed == 0:
        md_lines.append("- No thresholds changed.")
    md_lines.append("")

    md_lines.append("## Hidden Label Recommendations")
    md_lines.append("")
    for h in hidden_labels:
        md_lines.append(f"- {h['label']}: {h['reason']} → {h['suggest_action']}")
    if not hidden_labels:
        md_lines.append("- None.")
    md_lines.append("")

    md_lines.append("## Warnings")
    md_lines.append("")
    for w in warnings:
        md_lines.append(f"- ⚠️ {w}")
    if not warnings:
        md_lines.append("- None.")
    md_lines.append("")

    md_lines.append("## Important Notes")
    md_lines.append("")
    md_lines.append(f"- **Default clustering unchanged:** {report['default_clustering_unchanged']}")
    md_lines.append("- This tool only suggests HistogramLabelConfig thresholds.")
    md_lines.append("- It does not modify clustering features, UMAP, HDBSCAN, or saved cluster assignments.")
    md_lines.append("- The suggested config is NOT auto-applied. Review manually first.")
    md_lines.append("- To apply: update `HistogramLabelConfig` defaults in `histogram_label_config.py`.")

    md_path = output_dir / "calibration_report.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines) + "\n")
    print(f"Report MD: {md_path}")

    print("\nDone. Default clustering unchanged.")


if __name__ == "__main__":
    main()
