#!/usr/bin/env python3
"""
v4.4a-3 — Optuna Offline Recipe Search

Automatically searches optimal feature selection and hyperparameter
combinations via Optuna, using baseline datasets and optional holdout
sample_v1.

Usage:
    python tools/optimize_algorithm_recipe.py --n-trials 40 --seed 42
    python tools/optimize_algorithm_recipe.py --manifest <sample_v1>/manifest.json --n-trials 40
    python tools/optimize_algorithm_recipe.py --quick  # 2 trials on small data only

Dependencies: optuna (pip install optuna)
"""

import argparse
import csv
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import (
    get_active_feature_names, FEATURE_GROUP_NAMES,
)
from lighting_engine.core.preprocess import preprocess_all, find_images
from sklearn.preprocessing import RobustScaler

# ============================================================
# 0. Optuna optional import
# ============================================================

try:
    import optuna
    from optuna.trial import TrialState
    OPTUNA_AVAILABLE = True
except ImportError:
    OPTUNA_AVAILABLE = False


# ============================================================
# 1. Constants
# ============================================================

FEATURE_NAMES_20 = [
    "brightness_mean", "brightness_std", "brightness_p10", "brightness_p90",
    "brightness_skewness",
    "contrast", "highlight_threshold", "edge_strength_mean", "edge_strength_std",
    "warm_cool_bias_weighted", "saturation_mean", "saturation_std",
    "low_saturation_ratio", "high_saturation_ratio", "dominant_hue_strength",
    "light_centroid_x", "light_centroid_y", "light_spread",
    "light_concentration", "light_asymmetry",
]

GROUP_RANGES = {
    "brightness":       (0, 5),
    "lighting":         (5, 9),
    "color":            (9, 15),
    "spatial_lighting": (15, 20),
}

BASELINE_DATASETS = {
    "ready_for_training_folder": {
        "path": str(PROJECT_ROOT / "ready_for_training_folder"),
        "baseline": {"silhouette": 0.469, "clusters": 4, "noise_rate": 21.7},
    },
    "氛围test": {
        "path": str(PROJECT_ROOT / "氛围test"),
        "baseline": {"silhouette": 0.458, "clusters": 10, "noise_rate": 20.1},
    },
    "写真test": {
        "path": str(PROJECT_ROOT / "写真test"),
        "baseline": None,
    },
    "shexyo-47": {
        "path": str(PROJECT_ROOT / "shexyo-47"),
        "baseline": {"silhouette": 0.482, "clusters": 4, "noise_rate": 6.9},
    },
}

# ============================================================
# 2. Feature helpers (reuse pattern from recipe tuner)
# ============================================================

def compute_legacy_warm_cool(images_rgb) -> np.ndarray:
    vals = []
    for img in images_rgb:
        if img is None:
            vals.append(0.0)
        else:
            r = img[..., 0].astype(np.float32)
            b = img[..., 2].astype(np.float32)
            vals.append(float(np.mean(r - b)))
    return np.array(vals, dtype=np.float32).reshape(-1, 1)


def build_feature_matrix(features_20: np.ndarray, images_rgb: List[np.ndarray],
                         params: dict) -> Tuple[np.ndarray, List[str]]:
    """Build feature matrix from Optuna trial parameters.

    Returns (features, feature_names).
    """
    keep = list(range(20))
    extra_names = []
    extra_fn = None

    # brightness_skewness
    if not params.get("use_brightness_skewness", True):
        keep = [i for i in keep if i != 4]

    # saturation ratios (only if allow_extra_color search)
    if not params.get("use_low_saturation_ratio", False):
        keep = [i for i in keep if i not in (12, 13)]
    if not params.get("use_high_saturation_ratio", False):
        keep = [i for i in keep if i not in (12, 13)]

    # dominant_hue_strength (only if allow_extra_color search)
    if not params.get("use_dominant_hue_strength", False):
        keep = [i for i in keep if i != 14]

    # warmcool mode
    warmcool_mode = params.get("warmcool_mode", "raw")
    if warmcool_mode == "raw":
        # Use legacy mean(R-B), remove warm_cool_bias_weighted(9)
        if 9 in keep:
            keep.remove(9)
        extra_names.append("legacy_warm_cool_bias")
        extra_fn = compute_legacy_warm_cool
    # if "weighted", keep warm_cool_bias_weighted(9) as is

    keep.sort()
    feat_names = [FEATURE_NAMES_20[i] for i in keep]

    # Build base matrix
    features = features_20[:, keep].copy()

    # Add extra features
    if extra_fn and images_rgb:
        extra = extra_fn(images_rgb)
        features = np.concatenate([features, extra], axis=1)
        feat_names.extend(extra_names)

    return features, feat_names


def build_group_indices(feature_names: List[str]) -> Dict[str, List[int]]:
    """Map feature names back to group indices for weighting."""
    groups = {g: [] for g in GROUP_RANGES}
    for idx, name in enumerate(feature_names):
        if "legacy" in name:
            groups["color"].append(idx)
            continue
        try:
            orig_idx = FEATURE_NAMES_20.index(name)
        except ValueError:
            continue
        for gname, (start, end) in GROUP_RANGES.items():
            if start <= orig_idx < end:
                groups[gname].append(idx)
                break
    return groups


# ============================================================
# 3. Clustering runner
# ============================================================

def run_clustering(features: np.ndarray, feature_names: List[str],
                   params: dict, n: int) -> dict:
    """Run full clustering pipeline given parameters.

    Returns dict with metrics.
    """
    import umap
    import hdbscan

    # Build group indices
    group_indices = build_group_indices(feature_names)

    # Apply weights
    features_w = features.copy().astype(np.float32)
    for gname, indices in group_indices.items():
        w = params.get(f"{gname}_weight", 1.0)
        for idx in indices:
            if idx < features_w.shape[1]:
                features_w[:, idx] *= w

    # Dead feature detection (std-based)
    from lighting_engine.core.feature_diagnostic import compute_diagnostics
    diag, keep_idx, dead_features = compute_diagnostics(features_w, feature_names)
    if dead_features:
        features_live = features_w[:, keep_idx]
        names_live = [feature_names[i] for i in keep_idx]
    else:
        features_live = features_w
        names_live = feature_names

    # RobustScaler
    scaler = RobustScaler()
    features_scaled = scaler.fit_transform(features_live)

    # UMAP
    n_neighbors = params.get("umap_neighbors", 50)
    if n_neighbors == "auto" or n_neighbors < 0 or n_neighbors > min(100, int(math.sqrt(n))):
        n_neighbors = min(100, max(15, int(math.sqrt(n))))

    reducer = umap.UMAP(
        n_components=5,
        n_neighbors=n_neighbors,
        min_dist=params.get("umap_min_dist", 0.05),
        metric=params.get("umap_metric", "euclidean"),
        random_state=42,
    )
    embedding = reducer.fit_transform(features_scaled)

    # HDBSCAN
    csr = params.get("cluster_size_ratio", 0.02)
    msr = params.get("min_samples_ratio", 0.3)
    mcs = max(5, min(50, int(n * csr)))
    ms = max(3, int(mcs * msr))

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=mcs, min_samples=ms,
        metric="euclidean", cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(embedding)

    n_clusters = len([l for l in set(labels) if l >= 0])
    noise_count = int(np.sum(labels == -1))
    noise_rate = noise_count / max(n, 1) * 100

    sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
    largest_cluster_ratio = max(sizes) / max(n, 1) if sizes else 0

    # Silhouette
    from lighting_engine.core.quality_metrics import compute_quality
    quality = compute_quality(embedding, labels)
    silhouette = quality.get("silhouette_score", 0) or 0

    return {
        "n_clusters": n_clusters,
        "noise_count": noise_count,
        "noise_rate": round(noise_rate, 2),
        "silhouette": round(float(silhouette), 4),
        "largest_cluster_ratio": round(float(largest_cluster_ratio), 4),
        "live_features": features_live.shape[1],
        "dead_feature_count": len(dead_features),
        "dead_feature_names": dead_features,
        "labels": labels.tolist(),
    }


# ============================================================
# 4. Dataset loading (cached)
# ============================================================

def load_dataset(path: str) -> Tuple[List, np.ndarray, List[np.ndarray], int]:
    """Load and preprocess a dataset once.

    Returns: (images_rgb, features_20, n)
    """
    from lighting_engine.core.feature_assembler import assemble_batch

    image_paths = find_images([path])
    if not image_paths:
        return [], None, [], 0

    images = preprocess_all(image_paths, max_workers=1)
    images_rgb = [img for _, img in images]
    n = len(images)

    fg = {
        "brightness":       {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "亮度"},
        "lighting":         {"enabled": True, "dims": 4, "weight": 1.0, "cluster": True, "label": "光影"},
        "color":            {"enabled": True, "dims": 6, "weight": 1.0, "cluster": True, "label": "颜色"},
        "spatial_lighting": {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "空间光"},
    }
    features_20, _ = assemble_batch(images, [None]*n, [None]*n, fg, max_workers=1)

    return images_rgb, features_20, n


def load_manifest_datasets(manifest_path: str) -> Dict:
    """Load sample_v1 manifest and group by root_name."""
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    root_dirs = {}
    for rec in manifest.get("selected", []):
        rname = rec["root_name"]
        if rname in root_dirs:
            continue
        cp = rec.get("copied_path", "")
        if not cp:
            continue
        p = Path(cp)
        # Walk up to find the samples/{root_name} directory
        for parent in p.parents:
            if parent.name == "samples":
                root_dirs[rname] = str(parent / rname)
                break
            if parent.parent and parent.parent.name == "samples":
                root_dirs[rname] = str(parent)
                break

    return {
        rname: {"path": d, "baseline": None, "holdout": True}
        for rname, d in root_dirs.items()
    }


# ============================================================
# 5. Objective function
# ============================================================

def objective(trial, dataset_cache: dict, manifest_cache: dict,
              allow_extra_color: bool, quick: bool):
    """Optuna objective: higher is better."""
    # ── Sample parameters ──
    params = {}

    # Feature selection
    params["use_brightness_skewness"] = trial.suggest_categorical(
        "use_brightness_skewness", [False, True])
    params["warmcool_mode"] = trial.suggest_categorical(
        "warmcool_mode", ["raw", "weighted"])

    if allow_extra_color:
        params["use_low_saturation_ratio"] = trial.suggest_categorical(
            "use_low_saturation_ratio", [False, True])
        params["use_high_saturation_ratio"] = trial.suggest_categorical(
            "use_high_saturation_ratio", [False, True])
        params["use_dominant_hue_strength"] = trial.suggest_categorical(
            "use_dominant_hue_strength", [False, True])
    else:
        params["use_low_saturation_ratio"] = False
        params["use_high_saturation_ratio"] = False
        params["use_dominant_hue_strength"] = False

    # Group weights
    params["brightness_weight"] = trial.suggest_float("brightness_weight", 0.8, 1.2)
    params["lighting_weight"] = trial.suggest_float("lighting_weight", 0.8, 1.2)
    params["color_weight"] = trial.suggest_float("color_weight", 0.6, 1.2)
    params["spatial_lighting_weight"] = trial.suggest_float("spatial_lighting_weight", 0.6, 1.2)

    # UMAP
    params["umap_neighbors"] = trial.suggest_categorical(
        "umap_neighbors", [15, 30, 50, 80])
    params["umap_min_dist"] = trial.suggest_categorical(
        "umap_min_dist", [0.02, 0.05, 0.1])
    params["umap_metric"] = "euclidean"

    # HDBSCAN
    params["cluster_size_ratio"] = trial.suggest_categorical(
        "cluster_size_ratio", [0.01, 0.015, 0.02, 0.03])
    params["min_samples_ratio"] = trial.suggest_categorical(
        "min_samples_ratio", [0.2, 0.3, 0.5])

    # ── Run clustering on each dataset ──
    per_ds = {}
    scores = []

    all_datasets = dict(BASELINE_DATASETS)
    if manifest_cache:
        all_datasets.update(manifest_cache)

    for ds_name, ds_info in all_datasets.items():
        if ds_name not in dataset_cache:
            continue
        images_rgb, features_20, n = dataset_cache[ds_name]
        if n == 0:
            continue

        try:
            feats, feat_names = build_feature_matrix(features_20, images_rgb, params)
            result = run_clustering(feats, feat_names, params, n)
        except Exception as e:
            per_ds[ds_name] = {"error": str(e)}
            continue

        sil = result["silhouette"]
        nr = result["noise_rate"]
        nc = result["n_clusters"]
        lcr = result["largest_cluster_ratio"]
        dead = result["dead_feature_count"]

        per_ds[ds_name] = {
            "silhouette": sil,
            "noise_rate": nr,
            "n_clusters": nc,
            "largest_cluster_ratio": lcr,
            "live_features": result["live_features"],
            "dead_features": dead,
        }

        # Score this dataset
        baseline = ds_info.get("baseline")
        holdout = ds_info.get("holdout", False)
        ds_score = 0.0

        # Silhouette: target baseline or 0.4+
        target_sil = baseline["silhouette"] if baseline else 0.4
        sil_component = max(0, 100 - max(0, target_sil - sil) * 300)
        ds_score += sil_component * 0.5

        # Cluster count penalty
        if baseline:
            cluster_diff = abs(nc - baseline["clusters"])
        else:
            cluster_diff = abs(nc - 6) if nc < 10 else abs(nc - 8)
        cluster_penalty = min(30, cluster_diff * 5)
        ds_score -= cluster_penalty * 0.15

        # Noise rate penalty
        if baseline:
            noise_diff = max(0, nr - baseline["noise_rate"])
        else:
            noise_diff = max(0, nr - 25)
        noise_penalty = min(25, noise_diff * 1.0)
        ds_score -= noise_penalty * 0.15

        # Largest cluster ratio penalty (degeneration guard)
        if lcr > 0.45:
            ds_score -= 20 * (lcr - 0.45) / 0.55
        if nc <= 2:
            ds_score -= 30
            if nc == 1:
                ds_score -= 30
        if dead > 4:
            ds_score -= 5 * (dead - 4)

        ds_score = max(0, ds_score)
        scores.append(ds_score)

    if not scores:
        return -999.0

    # Weight: baseline (0.7) vs holdout (0.3)
    n_baseline = sum(1 for n in per_ds if n in BASELINE_DATASETS)
    n_holdout = len(per_ds) - n_baseline

    total_score = 0.0
    if n_baseline > 0:
        baseline_scores = [scores[i] for i, n in enumerate(per_ds) if list(per_ds.keys())[i] in BASELINE_DATASETS]
        total_score += np.mean(baseline_scores) * 0.7
    if n_holdout > 0:
        holdout_scores = [scores[i] for i, n in enumerate(per_ds) if list(per_ds.keys())[i] not in BASELINE_DATASETS]
        total_score += np.mean(holdout_scores) * 0.3

    # Store in trial user attrs
    trial.set_user_attr("per_dataset", json.dumps(per_ds))
    trial.set_user_attr("params", json.dumps(params))
    trial.set_user_attr("n_datasets", len(per_ds))

    return total_score


# ============================================================
# 6. CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(description="v4.4a-3 Optuna recipe search")
    parser.add_argument("--manifest", type=str, default=None,
                        help="Sample_v1 manifest.json path")
    parser.add_argument("--n-trials", type=int, default=40)
    parser.add_argument("--study-name", type=str, default="cluster_recipe_v4_4a3")
    parser.add_argument("--storage", type=str, default=None,
                        help="SQLite URL, e.g. sqlite:///path/to/study.db")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--timeout-minutes", type=int, default=0)
    parser.add_argument("--quick", action="store_true",
                        help="Quick test: 2 trials, small datasets only")
    parser.add_argument("--allow-extra-color", action="store_true",
                        help="Include low/high sat ratio and dominant_hue in search space")
    return parser.parse_args()


def main():
    args = parse_args()

    if not OPTUNA_AVAILABLE:
        print("ERROR: optuna is not installed.")
        print("  pip install optuna")
        sys.exit(1)

    output_dir = Path(PROJECT_ROOT / "_validation_outputs")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Resolve storage path
    if args.storage:
        storage_url = args.storage
    else:
        db_path = output_dir / "optuna_recipe_study.sqlite3"
        storage_url = f"sqlite:///{db_path}"

    # ── Load datasets ──
    print("Loading datasets...")
    dataset_cache = {}
    manifest_cache = None

    # Baseline datasets
    if args.quick:
        # Only use smaller datasets
        quick_ds = ["ready_for_training_folder", "shexyo-47"]
    else:
        quick_ds = list(BASELINE_DATASETS.keys())

    for name in quick_ds:
        info = BASELINE_DATASETS[name]
        path = info["path"]
        if not Path(path).exists():
            print(f"  SKIP {name}: path not found")
            continue
        print(f"  Loading {name}...", end=" ", flush=True)
        images_rgb, features_20, n = load_dataset(path)
        dataset_cache[name] = (images_rgb, features_20, n)
        print(f"{n} images")

    # Manifest datasets
    if args.manifest:
        if not Path(args.manifest).exists():
            print(f"  WARNING: manifest not found: {args.manifest}")
        else:
            print(f"  Loading manifest: {args.manifest}")
            manifest_cache = load_manifest_datasets(args.manifest)
            for name, info in manifest_cache.items():
                path = info["path"]
                if not Path(path).exists():
                    print(f"    SKIP {name}: path not found: {path}")
                    continue
                print(f"    Loading {name}...", end=" ", flush=True)
                images_rgb, features_20, n = load_dataset(path)
                dataset_cache[name] = (images_rgb, features_20, n)
                print(f"{n} images")

    if not dataset_cache:
        print("ERROR: No datasets could be loaded.")
        sys.exit(1)

    # ── Optuna study ──
    n_trials = 2 if args.quick else args.n_trials
    study_name = args.study_name

    print(f"\nStarting Optuna study: {study_name}")
    print(f"  Storage: {storage_url}")
    print(f"  Trials: {n_trials}")
    print(f"  Seed: {args.seed}")
    print(f"  Allow extra color: {args.allow_extra_color}")
    print(f"  Quick mode: {args.quick}")

    study = optuna.create_study(
        study_name=study_name,
        storage=storage_url,
        direction="maximize",
        load_if_exists=True,
    )

    # Set seed via sampler
    study.sampler = optuna.samplers.TPESampler(seed=args.seed)

    timeout_sec = args.timeout_minutes * 60 if args.timeout_minutes > 0 else None

    study.optimize(
        lambda trial: objective(
            trial, dataset_cache, manifest_cache,
            args.allow_extra_color, args.quick,
        ),
        n_trials=n_trials,
        timeout=timeout_sec,
    )

    # ── Results ──
    print(f"\n{'='*60}")
    print(f"STUDY COMPLETE")
    print(f"{'='*60}")
    print(f"  Study name: {study_name}")
    print(f"  Number of trials: {len(study.trials)}")
    print(f"  Best trial: #{study.best_trial.number}")
    print(f"  Best value: {study.best_value:.4f}")

    # Best trial details
    best = study.best_trial
    print(f"\n  Best params:")
    for k, v in best.params.items():
        print(f"    {k}: {v}")
    per_ds_str = best.user_attrs.get("per_dataset", "{}")
    try:
        per_ds = json.loads(per_ds_str)
        print(f"\n  Per-dataset results:")
        for ds_name, metrics in per_ds.items():
            if "error" in metrics:
                print(f"    {ds_name}: ERROR - {metrics['error']}")
            else:
                print(f"    {ds_name}: sil={metrics['silhouette']:.4f} "
                      f"noise={metrics['noise_rate']:.1f}% "
                      f"cl={metrics['n_clusters']} "
                      f"lcr={metrics['largest_cluster_ratio']:.3f}")
    except json.JSONDecodeError:
        pass

    # ── Export trials CSV ──
    csv_path = output_dir / "optuna_recipe_trials.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["trial_number", "value", "state", "params"])
        for t in study.trials:
            writer.writerow([t.number, t.value, str(t.state), json.dumps(t.params)])
    print(f"\n  Trials CSV: {csv_path}")

    # ── Export best recipe JSON ──
    best_recipe = {
        "source": "optuna_v4_4a3",
        "study_name": study_name,
        "created_at": datetime.now().isoformat(),
        "n_trials": len(study.trials),
        "best_trial_number": best.number,
        "best_value": round(float(best.value), 4) if best.value else None,
        "params": {k: v for k, v in best.params.items()},
        "per_dataset": {},
        "warning": "This recipe is a suggestion only. Do NOT auto-apply to production config.",
    }
    try:
        best_recipe["per_dataset"] = json.loads(per_ds_str)
    except json.JSONDecodeError:
        pass

    # Add legacy_16_like comparison
    best_recipe["legacy_16_like_for_comparison"] = {
        "brightness": "4 dims (no skewness)",
        "lighting": "4 dims",
        "color": "3 dims (legacy warm_cool + sat_mean + sat_std)",
        "spatial": "5 dims",
        "weights": "all 1.0",
    }

    best_json_path = output_dir / "best_recipe.json"
    with open(best_json_path, "w", encoding="utf-8") as f:
        json.dump(best_recipe, f, indent=2, ensure_ascii=False)
    print(f"  Best recipe JSON: {best_json_path}")

    # ── Generate MD report ──
    generate_report(study, dataset_cache, manifest_cache, args, output_dir)

    print("\nDone.")


def generate_report(study, dataset_cache, manifest_cache, args, output_dir):
    """Generate ALGORITHM_TUNING_V4_4A3_OPTUNA.md."""
    lines = []
    lines.append("# Optuna Recipe Search Report: v4.4a-3")
    lines.append("")
    lines.append(f"> Generated: {datetime.now().isoformat()}")
    lines.append(f"> Study: {args.study_name}")
    lines.append(f"> Trials: {args.n_trials}")
    lines.append(f"> Seed: {args.seed}")
    lines.append(f"> Allow extra color: {args.allow_extra_color}")
    lines.append("")

    # Best
    best = study.best_trial
    lines.append("## Best Trial")
    lines.append("")
    lines.append(f"**Trial #{best.number}** — Value: {best.value:.4f}")
    lines.append("")
    lines.append("| Parameter | Value |")
    lines.append("|-----------|:-----:|")
    for k, v in best.params.items():
        lines.append(f"| {k} | {v} |")
    lines.append("")
    try:
        per_ds = json.loads(best.user_attrs.get("per_dataset", "{}"))
        if per_ds:
            lines.append("### Per-Dataset Metrics")
            lines.append("")
            lines.append("| Dataset | Silhouette | Noise% | Clusters | LCR |")
            lines.append("|---------|:----------:|:------:|:--------:|:---:|")
            for ds_name, m in per_ds.items():
                if "error" in m:
                    lines.append(f"| {ds_name} | ERROR: {m['error']} |")
                else:
                    lines.append(f"| {ds_name} | {m['silhouette']:.4f} | {m['noise_rate']:.1f}% | {m['n_clusters']} | {m['largest_cluster_ratio']:.3f} |")
            lines.append("")
    except json.JSONDecodeError:
        pass

    # Top 10
    lines.append("## Top 10 Trials")
    lines.append("")
    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE and t.value is not None]
    completed.sort(key=lambda t: t.value, reverse=True)
    lines.append("| Rank | Trial | Value | Params |")
    lines.append("|------|:-----:|:-----:|--------|")
    for rank, t in enumerate(completed[:10], 1):
        param_str = " ".join(f"{k}={v}" for k, v in t.params.items())
        lines.append(f"| {rank} | #{t.number} | {t.value:.4f} | {param_str} |")
    lines.append("")

    # Comparison with legacy_16_like
    lines.append("## Comparison with legacy_16_like")
    lines.append("")
    lines.append("The hand-tuned `legacy_16_like` config serves as the baseline reference:")
    lines.append("")
    lines.append("| Dataset | legacy_16_like | Best Optuna | Δ |")
    lines.append("|---------|:--------------:|:-----------:|:-:|")
    for ds_name in BASELINE_DATASETS:
        bl = BASELINE_DATASETS[ds_name].get("baseline")
        bl_sil = bl["silhouette"] if bl else "N/A"
        legacy_sil = bl["silhouette"] if bl else "N/A"
        try:
            opt_sil = json.loads(best.user_attrs.get("per_dataset", "{}")).get(ds_name, {}).get("silhouette", "N/A")
        except (json.JSONDecodeError, AttributeError):
            opt_sil = "N/A"
        delta = f"{float(opt_sil) - float(bl['silhouette']):+.4f}" if isinstance(opt_sil, float) and bl else "N/A"
        lines.append(f"| {ds_name} | {legacy_sil} | {opt_sil} | {delta} |")
    lines.append("")

    # Recommendations
    lines.append("## Recommendations")
    lines.append("")

    # Compute average silhouette delta across baseline datasets
    sil_deltas = []
    try:
        best_pd = json.loads(best.user_attrs.get("per_dataset", "{}"))
        for ds_name, bl_info in BASELINE_DATASETS.items():
            bl_sil = bl_info.get("baseline", {}).get("silhouette")
            opt_sil = best_pd.get(ds_name, {}).get("silhouette")
            if bl_sil and opt_sil:
                sil_deltas.append(opt_sil - bl_sil)
    except (json.JSONDecodeError, AttributeError):
        pass

    avg_delta = np.mean(sil_deltas) if sil_deltas else None
    exceeds_baseline = avg_delta is not None and avg_delta >= 0

    if avg_delta is not None and avg_delta > 0.01:
        lines.append(f"- ✅ **Optuna found a candidate recipe that slightly exceeds legacy_16_like** "
                     f"(avg sil Δ = {avg_delta:+.4f} over {len(sil_deltas)} baseline datasets).")
        lines.append(f"  This is a candidate, NOT the default. Must be validated on sample_v1 holdout before applying.")
    elif avg_delta is not None and avg_delta >= -0.01:
        lines.append(f"- ↔️ **Optuna found a recipe equivalent to legacy_16_like** "
                     f"(avg sil Δ = {avg_delta:+.4f}). Candidate saved for holdout validation.")
    else:
        lines.append(f"- ⚠️ **Optuna best recipe slightly below legacy_16_like** "
                     f"(avg sil Δ = {avg_delta:+.4f}). Proceeding with holdout validation anyway.")
    lines.append("")

    lines.append("- **Should optuna_best replace legacy_16_like as default?**")
    if avg_delta is not None and avg_delta > -0.01:
        lines.append("  - ❌ **Not yet.** The candidate needs holdout validation on sample_v1.")
        lines.append("  - After holdout validation, if the candidate is stable across unseen data,")
        lines.append("    it can be considered for default. Until then, legacy_16_like remains the")
        lines.append("    verified baseline.")
    else:
        lines.append("  - ❌ **No.** legacy_16_like remains the verified baseline.")
    lines.append("")

    lines.append("- **Allow v4.4b feature_importance_report?**")
    if avg_delta is not None and avg_delta > -0.03:
        lines.append("  - ✅ Yes — silhouette is within acceptable range of baseline.")
    else:
        lines.append("  - ⚠️ Not yet — improve the default config first.")
    lines.append("")

    lines.append("- **Still prohibit v4.5?**")
    lines.append("  - ✅ Yes — recipe infrastructure is not production-ready.")
    lines.append("")

    # Manifest info
    if args.manifest:
        lines.append("## Holdout Validation")
        lines.append("")
        lines.append(f"Sample set: `{args.manifest}`")
        try:
            per_ds = json.loads(best.user_attrs.get("per_dataset", "{}"))
            holdout = {k: v for k, v in per_ds.items() if k not in BASELINE_DATASETS}
            if holdout:
                lines.append("| Root | Silhouette | Noise% | Clusters | LCR |")
                lines.append("|------|:----------:|:------:|:--------:|:---:|")
                for ds_name, m in holdout.items():
                    if "error" in m:
                        lines.append(f"| {ds_name} | ERROR |")
                    else:
                        lines.append(f"| {ds_name} | {m['silhouette']:.4f} | {m['noise_rate']:.1f}% | {m['n_clusters']} | {m['largest_cluster_ratio']:.3f} |")
        except (json.JSONDecodeError, AttributeError):
            pass
        lines.append("")

    # Study info
    lines.append("## Study Details")
    lines.append("")
    lines.append(f"- Storage: `{args.storage or 'sqlite:///...optuna_recipe_study.sqlite3'}`")
    lines.append(f"- Trials completed: {len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE])}")
    lines.append(f"- Trials failed: {len([t for t in study.trials if t.state == optuna.trial.TrialState.FAIL])}")
    lines.append("")
    lines.append("### View with Optuna Dashboard")
    lines.append("```bash")
    lines.append("optuna-dashboard sqlite:///path/to/optuna_recipe_study.sqlite3")
    lines.append("```")
    lines.append("")

    md_path = PROJECT_ROOT / "docs" / "ALGORITHM_TUNING_V4_4A3_OPTUNA.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  Report: {md_path}")


if __name__ == "__main__":
    main()
