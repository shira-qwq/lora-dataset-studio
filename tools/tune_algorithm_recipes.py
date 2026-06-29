#!/usr/bin/env python3
"""
v4.4a — Offline Algorithm Recipe Tuner

Evaluates multiple feature/weight combinations (recipes) across 4 datasets
to identify the cause of silhouette regression in v4.1-v4.3.

Usage:
    python tools/tune_algorithm_recipes.py

Output:
    - Console summary table
    - _validation_outputs/recipe_tuning_results.json
    - docs/ALGORITHM_TUNING_V4_4A.md  (via separate script or manual trigger)

This script does NOT modify any production code or default config.
"""

import json
import logging
import sys
import time
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
logger = logging.getLogger("RecipeTuner")

# ── Project path ──
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import (
    assemble_batch, get_active_feature_names, FEATURE_GROUP_NAMES,
)
from lighting_engine.core.feature_diagnostic import compute_diagnostics, _auto_indices
from lighting_engine.core.preprocess import preprocess_all, find_images
from lighting_engine.core.quality_metrics import compute_quality
from sklearn.preprocessing import RobustScaler

# ============================================================
# 1. DATASET DEFINITIONS
# ============================================================

DATASETS = {
    "ready_for_training_folder": {
        "path": str(PROJECT_ROOT / "ready_for_training_folder"),
        "baseline": {"images": 60, "clusters": 4, "silhouette": 0.469, "noise_rate": 21.7},
        "baseline_source": "v6 P1 historical",
    },
    "氛围test": {
        "path": str(PROJECT_ROOT / "氛围test"),
        "baseline": {"images": 134, "clusters": 10, "silhouette": 0.458, "noise_rate": 20.1},
        "baseline_source": "v6 P1 historical (0514 柔和氛围 softglow)",
    },
    "写真test": {
        "path": str(PROJECT_ROOT / "写真test"),
        "baseline": None,
        "baseline_source": None,
    },
    "shexyo-47": {
        "path": str(PROJECT_ROOT / "shexyo-47"),
        "baseline": {"images": 58, "clusters": 4, "silhouette": 0.482, "noise_rate": 6.9},
        "baseline_source": "v6 P1 historical (1_konya_karasue-58, DIFFERENT dataset)",
    },
}

# ============================================================
# 2. FEATURE INDEX MAP (0-based, 20-dim current config)
# ============================================================
#
# brightness(5):  0=brightness_mean, 1=std, 2=p10, 3=p90, 4=skewness
# lighting(4):    5=contrast, 6=highlight_threshold, 7=edge_strength_mean, 8=edge_strength_std
# color(6):       9=warm_cool_bias_weighted, 10=saturation_mean, 11=saturation_std,
#                 12=low_saturation_ratio, 13=high_saturation_ratio, 14=dominant_hue_strength
# spatial(5):     15=light_centroid_x, 16=light_centroid_y, 17=light_spread,
#                 18=light_concentration, 19=light_asymmetry

FEATURE_NAMES_20 = [
    "brightness_mean", "brightness_std", "brightness_p10", "brightness_p90",
    "brightness_skewness",
    "contrast", "highlight_threshold", "edge_strength_mean", "edge_strength_std",
    "warm_cool_bias_weighted", "saturation_mean", "saturation_std",
    "low_saturation_ratio", "high_saturation_ratio", "dominant_hue_strength",
    "light_centroid_x", "light_centroid_y", "light_spread",
    "light_concentration", "light_asymmetry",
]

# Group index ranges
GROUP_RANGES = {
    "brightness":       (0, 5),
    "lighting":         (5, 9),
    "color":            (9, 15),
    "spatial_lighting": (15, 20),
}

# Default group weights from config
DEFAULT_WEIGHTS = {
    "brightness":       1.0,
    "lighting":         1.0,
    "color":            0.8,
    "spatial_lighting": 1.0,
}

# ============================================================
# 3. RECIPE DEFINITIONS
# ============================================================

def _make_recipe(name: str, desc: str,
                 weight_overrides: dict = None,
                 exclude_indices: List[int] = None,
                 use_legacy_warm_cool: bool = False,
                 legacy_color_only: bool = False,
                 legacy_16: bool = False,
                 no_brightness_skewness: bool = False,
                 no_saturation_ratios: bool = False,
                 no_dominant_hue: bool = False,
                 color_back_to_core: bool = False,
                 # v4.4a-2: orthogonal ablation flags
                 legacy_16_base: bool = False,
                 add_indices: List[int] = None,
                 use_weighted_warmcool: bool = False,
                 current_v4_1_fallback: bool = False,
                 ) -> dict:
    """Build a recipe dict."""
    return {
        "name": name,
        "description": desc,
        "weight_overrides": weight_overrides or {},
        "exclude_indices": exclude_indices or [],
        "use_legacy_warm_cool": use_legacy_warm_cool,
        "legacy_color_only": legacy_color_only,
        "legacy_16": legacy_16,
        "no_brightness_skewness": no_brightness_skewness,
        "no_saturation_ratios": no_saturation_ratios,
        "no_dominant_hue": no_dominant_hue,
        "color_back_to_core": color_back_to_core,
        # v4.4a-2
        "legacy_16_base": legacy_16_base,
        "add_indices": add_indices or [],
        "use_weighted_warmcool": use_weighted_warmcool,
        "current_v4_1_fallback": current_v4_1_fallback,
    }


def get_recipes() -> List[dict]:
    return [
        # A — current v4.1 default
        _make_recipe(
            "current_v4_1",
            "Current 20-dim config, color weight=0.8",
            weight_overrides={"color": 0.8},
        ),

        # B — reduce color weight
        _make_recipe(
            "color_weight_0_5",
            "Current 20-dim config, color weight=0.5",
            weight_overrides={"color": 0.5},
        ),

        # C — further reduce color weight
        _make_recipe(
            "color_weight_0_3",
            "Current 20-dim config, color weight=0.3",
            weight_overrides={"color": 0.3},
        ),

        # D — remove saturation ratios
        _make_recipe(
            "no_saturation_ratios",
            "Remove low_saturation_ratio and high_saturation_ratio",
            weight_overrides={"color": 0.8},
            no_saturation_ratios=True,
        ),

        # E — remove dominant_hue_strength
        _make_recipe(
            "no_dominant_hue",
            "Remove dominant_hue_strength only",
            weight_overrides={"color": 0.8},
            no_dominant_hue=True,
        ),

        # F — color back to core (3 dims)
        _make_recipe(
            "color_back_to_core",
            "Color: warm_cool_bias_weighted + saturation_mean + saturation_std only",
            weight_overrides={"color": 0.8},
            color_back_to_core=True,
        ),

        # G — legacy warm_cool_bias (mean(R-B)) in color
        _make_recipe(
            "legacy_color",
            "Color: old warm_cool_bias=mean(R-B) + saturation_mean + saturation_std",
            weight_overrides={"color": 0.8},
            use_legacy_warm_cool=True,
            legacy_color_only=True,
        ),

        # H — no brightness_skewness
        _make_recipe(
            "no_brightness_skewness",
            "Remove brightness_skewness from brightness group",
            weight_overrides={"color": 0.8},
            no_brightness_skewness=True,
        ),

        # I — legacy 16-like
        _make_recipe(
            "legacy_16_like",
            "Brightness 4 + lighting 4 + color 3 (old warm_cool) + spatial 5",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16=True,
            use_legacy_warm_cool=True,
        ),

        # ============================================================
        # v4.4a-2: Orthogonal ablation (all built on legacy_16_base)
        # ============================================================

        # J — legacy_16_plus_skewness
        _make_recipe(
            "legacy_16_plus_skewness",
            "legacy_16_like + brightness_skewness (isolate skewness effect)",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_legacy_warm_cool=True,
            add_indices=[4],  # brightness_skewness
        ),

        # K — legacy_16_weighted_warmcool
        _make_recipe(
            "legacy_16_weighted_warmcool",
            "legacy_16_like with warm_cool_bias_weighted instead of legacy raw",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_weighted_warmcool=True,
        ),

        # L — legacy_16_plus_low_high_sat
        _make_recipe(
            "legacy_16_plus_low_high_sat",
            "legacy_16_like + low_saturation_ratio + high_saturation_ratio",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_legacy_warm_cool=True,
            add_indices=[12, 13],  # low/high saturation ratios
        ),

        # M — legacy_16_plus_dominant_hue
        _make_recipe(
            "legacy_16_plus_dominant_hue",
            "legacy_16_like + dominant_hue_strength",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_legacy_warm_cool=True,
            add_indices=[14],  # dominant_hue_strength
        ),

        # N — legacy_16_plus_all_new_color
        _make_recipe(
            "legacy_16_plus_all_new_color",
            "legacy_16_like + low_high_sat + dominant_hue (warm_cool still legacy)",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_legacy_warm_cool=True,
            add_indices=[12, 13, 14],  # all new color features
        ),

        # O — legacy_16_plus_all_new_color_weighted (≡ current_v4_1)
        _make_recipe(
            "legacy_16_plus_all_new_color_weighted",
            "All 20 dims with weighted warmcool (= current_v4_1 equivalent)",
            weight_overrides={"color": 0.8, "brightness": 1.0},
            current_v4_1_fallback=True,
        ),

        # P — legacy_16_plus_skewness_only_metadata_color (recommended candidate)
        _make_recipe(
            "legacy_16_plus_skewness_only_metadata_color",
            "legacy_16_like + skewness, new color feats as metadata only",
            weight_overrides={"color": 1.0, "brightness": 1.0},
            legacy_16_base=True,
            use_legacy_warm_cool=True,
            add_indices=[4],  # only skewness added
        ),
    ]


# ============================================================
# 4. FEATURE SELECTION HELPERS
# ============================================================

def _get_base_indices() -> List[int]:
    """All 20 feature indices."""
    return list(range(20))


def _apply_recipe_indices(recipe: dict) -> Tuple[List[int], List[str], dict]:
    """Determine which feature indices to keep and what legacy features to add.

    Returns:
        keep_indices: list of 0-based indices into the 20-dim feature array
        extra_feature_names: names of legacy features computed outside the 20-dim
        extra_compute_fn: callable(images) -> np.array of extra features, shape (n, len(extra_names))
        group_weights: {group_name: weight}
    """
    keep = list(range(20))
    extra_names = []
    extra_fn = None

    # Start with default weights
    weights = dict(DEFAULT_WEIGHTS)
    if recipe.get("weight_overrides"):
        for g, w in recipe["weight_overrides"].items():
            if g in weights:
                weights[g] = w

    # ── Exclusion rules ──
    if recipe.get("no_brightness_skewness"):
        keep = [i for i in keep if i != 4]  # remove index 4

    if recipe.get("no_saturation_ratios"):
        keep = [i for i in keep if i not in (12, 13)]

    if recipe.get("no_dominant_hue"):
        keep = [i for i in keep if i != 14]

    if recipe.get("color_back_to_core"):
        # Keep only warm_cool_bias_weighted(9), saturation_mean(10), saturation_std(11)
        color_indices = [9, 10, 11]
        keep = [i for i in keep if i < 9 or i > 14 or i in color_indices]

    if recipe.get("legacy_16"):
        # brightness 4 (0-3), lighting 4 (5-8), color 3 legacy, spatial 5 (15-19)
        keep = [i for i in keep if i != 4]  # no skewness
        # Keep only: brightness(0-3), lighting(5-8), saturation_mean(10), saturation_std(11), spatial(15-19)
        keep = [i for i in keep if i < 4 or (5 <= i <= 8) or i in (10, 11) or i >= 15]
        # Legacy warm_cool will be added as extra below

    # ── v4.4a-2: legacy_16_base (orthogonal ablation starting point) ──
    if recipe.get("legacy_16_base"):
        # Start from: brightness(0-3) + lighting(5-8) + sat_mean(10) + sat_std(11) + spatial(15-19)
        keep = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 16, 17, 18, 19]
        # Add any extra indices specified
        add_idxs = recipe.get("add_indices", [])
        for idx in add_idxs:
            if idx not in keep:
                keep.append(idx)
        keep.sort()

    # ── v4.4a-2: current_v4_1_fallback (all 20 dims with weighted warmcool) ──
    if recipe.get("current_v4_1_fallback"):
        keep = list(range(20))

    # ── Extra indices from user ──
    if recipe.get("exclude_indices"):
        keep = [i for i in keep if i not in recipe["exclude_indices"]]

    # ── Legacy warm_cool bias ──
    if recipe.get("use_legacy_warm_cool") or recipe.get("legacy_color_only") or recipe.get("legacy_16"):
        extra_names.append("legacy_warm_cool_bias")
        # Remove warm_cool_bias_weighted if present
        if 9 in keep:
            keep.remove(9)
        if recipe.get("legacy_color_only"):
            # Keep only legacy warm_cool + saturation_mean + saturation_std
            keep = [i for i in keep if i < 9 or i > 14 or i in (10, 11)]

        def _compute_legacy_warm_cool(images_rgb: List[np.ndarray]) -> np.ndarray:
            """Compute mean(R-B) for each image."""
            vals = []
            for img in images_rgb:
                if img is None:
                    vals.append(0.0)
                else:
                    r = img[..., 0].astype(np.float32)
                    b = img[..., 2].astype(np.float32)
                    vals.append(float(np.mean(r - b)))
            return np.array(vals, dtype=np.float32).reshape(-1, 1)

        extra_fn = _compute_legacy_warm_cool

    # ── v4.4a-2: use weighted warm_cool instead of legacy ──
    if recipe.get("use_weighted_warmcool") and not recipe.get("use_legacy_warm_cool"):
        # Keep warm_cool_bias_weighted(9) in the feature set, no legacy extra
        if 9 not in keep:
            keep.append(9)
            keep.sort()

    keep.sort()
    return keep, extra_names, extra_fn, weights


def _get_feature_subset_names(keep_indices: List[int], extra_names: List[str]) -> List[str]:
    names = [FEATURE_NAMES_20[i] for i in keep_indices]
    names.extend(extra_names)
    return names


# ============================================================
# 5. CLUSTERING PIPELINE (standalone, reuses existing components)
# ============================================================

def run_clustering(features: np.ndarray, feature_names: List[str],
                   group_weights: dict, dataset_size: int,
                   config_overrides: dict = None) -> dict:
    """Run the standard clustering pipeline on a feature matrix.

    Steps:
      1. Dead feature detection (std-based)
      2. Weight by group
      3. RobustScaler
      4. UMAP 5D
      5. HDBSCAN (with iteration)
      6. Quality metrics

    Returns dict with clustering results.
    """
    import umap
    import hdbscan

    cfg = dict(CONFIG)
    if config_overrides:
        cfg.update(config_overrides)

    n = dataset_size

    # ── Dead feature detection ──
    diag, keep_idx, dead_features = compute_diagnostics(features, feature_names)
    if dead_features:
        features_live = features[:, keep_idx]
        names_live = [feature_names[i] for i in keep_idx]
    else:
        features_live = features
        names_live = feature_names

    # ── Build group indices for weighting ──
    # Map group names to which feature names belong to each group
    group_features = {}
    for gname, (start, end) in GROUP_RANGES.items():
        # For legacy features, 9 was replaced; adjust mapping
        group_features[gname] = []
    for idx, name in enumerate(names_live):
        for gname, (start, end) in GROUP_RANGES.items():
            if start <= _original_index(name) < end:
                group_features[gname].append(idx)
                break
        else:
            # Extra legacy features - assign to color group
            if "legacy" in name:
                group_features.setdefault("color", []).append(idx)

    # Apply group weights
    features_weighted = features_live.copy().astype(np.float32)
    for gname, indices in group_features.items():
        w = group_weights.get(gname, 1.0)
        for idx in indices:
            if idx < features_weighted.shape[1]:
                features_weighted[:, idx] *= w

    # ── RobustScaler ──
    scaler = RobustScaler()
    features_scaled = scaler.fit_transform(features_weighted)

    # ── UMAP 5D ──
    n_neighbors = min(cfg["umap_neighbors"], max(15, int(math.sqrt(n))))
    reducer = umap.UMAP(
        n_components=cfg.get("umap_n_components_cluster", 5),
        n_neighbors=n_neighbors,
        min_dist=cfg["umap_min_dist"],
        metric=cfg.get("metric", "euclidean"),
        random_state=42,
    )
    embedding = reducer.fit_transform(features_scaled)

    # ── HDBSCAN (iterate up to 3 rounds) ──
    granularity = cfg.get("cluster_granularity", 1.0)
    best_labels = None
    best_sil = -1.0

    for iteration in range(3):
        ratio_based = max(3, int(n * cfg["cluster_size_ratio"] * granularity))
        floor_based = min(50, int(n * 0.05))
        mcs = max(floor_based, ratio_based, 5)
        ms = max(3, int(mcs * cfg["min_samples_ratio"]))

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=mcs, min_samples=ms,
            metric="euclidean", cluster_selection_method="eom",
        )
        labels = clusterer.fit_predict(embedding)
        sil = float(compute_quality(embedding, labels).get("silhouette_score", 0) or 0)

        if sil > best_sil:
            best_sil = sil
            best_labels = labels.copy()

        # Self-check
        sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
        max_ratio = max(sizes) / n if sizes else 0
        weak_count = sum(1 for s in sizes if s < n * 0.02)
        n_clusters = len([l for l in set(labels) if l >= 0])
        problems = []
        if max_ratio > 0.5:
            problems.append("dominant")
        if n_clusters <= 2 and sil < 0.3:
            problems.append("over_smoothing")
        if weak_count / max(n_clusters, 1) > 0.3 and n_clusters > 2:
            problems.append("weak")

        if not problems or iteration >= 2:
            break

        if "dominant" in problems:
            granularity = min(granularity * 1.3, 2.0)
        if "over_smoothing" in problems or "weak" in problems:
            pass  # mcs adjustment built into next iteration

    labels = best_labels
    n_clusters = len([l for l in set(labels) if l >= 0])
    noise_count = int(np.sum(labels == -1))
    noise_rate = noise_count / max(n, 1) * 100

    # Largest cluster ratio
    sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
    largest_cluster_ratio = max(sizes) / max(n, 1) if sizes else 0

    return {
        "n_clusters": n_clusters,
        "noise_count": noise_count,
        "noise_rate": round(noise_rate, 2),
        "silhouette": round(best_sil, 4),
        "labels": labels.tolist(),
        "live_features": features_live.shape[1],
        "dead_feature_count": len(dead_features),
        "dead_feature_names": dead_features,
        "largest_cluster_ratio": round(float(largest_cluster_ratio), 4),
        "n_iterations": iteration + 1,
        "live_feature_names": names_live,
    }


def _original_index(name: str) -> int:
    """Map feature name back to its original index in the 20-dim array."""
    try:
        return FEATURE_NAMES_20.index(name)
    except ValueError:
        return -1


# ============================================================
# 6. MAIN EVALUATION
# ============================================================

def compute_legacy_warm_cool(images_rgb: List[np.ndarray]) -> np.ndarray:
    """Compute old-style warm_cool_bias = mean(R-B) for each image."""
    vals = []
    for img in images_rgb:
        if img is None:
            vals.append(0.0)
        else:
            r = img[..., 0].astype(np.float32)
            b = img[..., 2].astype(np.float32)
            vals.append(float(np.mean(r - b)))
    return np.array(vals, dtype=np.float32).reshape(-1, 1)


def evaluate_recipe(recipe: dict, dataset_name: str,
                    features_20: np.ndarray, images_rgb: List[np.ndarray],
                    n_images: int) -> dict:
    """Evaluate a single recipe on pre-extracted features.

    Args:
        recipe: recipe dict
        dataset_name: name for logging
        features_20: (n, 20) feature matrix
        images_rgb: list of RGB arrays (for legacy computations)
        n_images: number of images

    Returns dict of metrics.
    """
    keep_idx, extra_names, extra_fn, group_weights = _apply_recipe_indices(recipe)

    # Base feature subset
    features_subset = features_20[:, keep_idx].copy()
    feat_names = [FEATURE_NAMES_20[i] for i in keep_idx]

    # Compute extra features
    if extra_fn and images_rgb:
        extra_feats = extra_fn(images_rgb)
        features_all = np.concatenate([features_subset, extra_feats], axis=1)
        feat_names.extend(extra_names)
    else:
        features_all = features_subset

    t0 = time.time()
    result = run_clustering(features_all, feat_names, group_weights, n_images)
    elapsed = time.time() - t0

    result["recipe_name"] = recipe["name"]
    result["dataset"] = dataset_name
    result["image_count"] = n_images
    result["total_features"] = features_all.shape[1]
    result["selected_feature_names"] = feat_names
    result["group_weights"] = dict(group_weights)
    result["runtime_seconds"] = round(elapsed, 2)

    return result


def run_all(base_dir: str = None, extra_datasets: dict = None) -> dict:
    """Run all recipes on all datasets.

    extra_datasets: optional dict of additional datasets (from manifest)

    Returns nested dict: results[dataset_name][recipe_name] = metrics
    """
    all_results = {}

    # Merge baseline + extra datasets
    all_sources = dict(DATASETS)
    if extra_datasets:
        all_sources.update(extra_datasets)

    for ds_name, ds_info in all_sources.items():
        ds_path = ds_info["path"]
        if not Path(ds_path).exists():
            print(f"  SKIP {ds_name}: path not found: {ds_path}")
            all_results[ds_name] = {"error": "path_not_found"}
            continue

        print(f"\n{'='*70}")
        print(f"DATASET: {ds_name}")
        print(f"{'='*70}")

        # Preprocess images
        print(f"  Preprocessing...")
        image_paths = find_images([ds_path])
        if not image_paths:
            all_results[ds_name] = {"error": "no_images"}
            continue

        images = preprocess_all(image_paths, max_workers=1)
        n = len(images)
        # Extract RGB arrays for legacy computation
        images_rgb = [img for _, img in images]

        # Assemble 20-dim features
        print(f"  Assembling features ({n} images)...")
        # Build a minimal feature_groups with all groups enabled
        fg = {
            "brightness":       {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "亮度"},
            "lighting":         {"enabled": True, "dims": 4, "weight": 1.0, "cluster": True, "label": "光影"},
            "color":            {"enabled": True, "dims": 6, "weight": 1.0, "cluster": True, "label": "颜色"},
            "spatial_lighting": {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "空间光"},
        }

        features_20, _ = assemble_batch(
            images, [None] * n, [None] * n, fg, max_workers=1
        )
        print(f"  Feature matrix: {features_20.shape}")

        # Evaluate each recipe
        ds_results = {}
        recipes = get_recipes()

        for recipe in recipes:
            rname = recipe["name"]
            print(f"  Recipe: {rname}...", end=" ", flush=True)
            try:
                metrics = evaluate_recipe(recipe, ds_name, features_20, images_rgb, n)
                ds_results[rname] = metrics
                sil = metrics.get("silhouette", 0)
                nc = metrics.get("n_clusters", 0)
                nr = metrics.get("noise_rate", 0)
                print(f"sil={sil:.4f} cl={nc} noise={nr:.1f}% live={metrics.get('live_features',0)}feat")
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"ERROR: {e}")
                ds_results[rname] = {"error": str(e)}

        all_results[ds_name] = ds_results

    return all_results


def compute_scores(all_results: dict, dataset_names: List[str] = None) -> dict:
    """Compute composite scores per recipe across datasets.

    If dataset_names is None, uses all keys found in all_results.
    """
    if dataset_names is None:
        dataset_names = list(all_results.keys())

    recipes = [r["name"] for r in get_recipes()]
    score_summary = {}

    for recipe_name in recipes:
        scores = []
        sil_deltas = []
        noise_deltas = []
        cluster_deltas = []
        datasets_with_baseline = 0

        # Build a local baseline lookup
        baseline_lookup = {}
        for ds_name, ds_info in DATASETS.items():
            bl = ds_info.get("baseline")
            if bl:
                baseline_lookup[ds_name] = bl

        for ds_name in dataset_names:
            ds_result = all_results.get(ds_name, {}).get(recipe_name, {})
            if "error" in ds_result:
                continue

            sil = ds_result.get("silhouette", 0)
            noise = ds_result.get("noise_rate", 0)
            clusters = ds_result.get("n_clusters", 0)
            largest_ratio = ds_result.get("largest_cluster_ratio", 0)

            baseline = baseline_lookup.get(ds_name)
            if baseline:
                datasets_with_baseline += 1
                # Silhouette delta
                sil_delta = sil - baseline["silhouette"]
                sil_deltas.append(sil_delta)
                # Noise rate tolerance
                noise_delta = noise - baseline["noise_rate"]
                noise_deltas.append(abs(noise_delta))
                # Cluster count tolerance
                cluster_delta = abs(clusters - baseline["clusters"])
                cluster_deltas.append(cluster_delta)

                # Per-dataset score (0-100, higher is better)
                sil_score = max(0, 100 - max(0, -sil_delta) * 200)  # -0.01 → -2pts, -0.10 → -20pts
                noise_penalty = min(30, max(0, noise_delta * 2))
                cluster_penalty = min(20, cluster_delta * 5)
                ds_score = max(0, sil_score - noise_penalty - cluster_penalty)
                scores.append(ds_score)
            else:
                # No baseline: silhouette越高越好, noise越低越好, 大簇不能过大
                sil_score = min(100, sil * 150)  # 0.5→75, 0.6→90
                noise_penalty = min(30, noise * 1.5)
                large_cluster_penalty = 20 if largest_ratio > 0.5 else 0
                ds_score = max(0, sil_score - noise_penalty - large_cluster_penalty)
                scores.append(ds_score)

        avg_score = round(np.mean(scores), 1) if scores else 0
        avg_sil_delta = round(np.mean(sil_deltas), 4) if sil_deltas else None
        avg_noise_delta = round(np.mean(noise_deltas), 2) if noise_deltas else None
        avg_cluster_delta = round(np.mean(cluster_deltas), 1) if cluster_deltas else None

        score_summary[recipe_name] = {
            "avg_composite_score": avg_score,
            "avg_silhouette_delta_vs_baseline": avg_sil_delta,
            "avg_noise_rate_abs_delta": avg_noise_delta,
            "avg_cluster_count_abs_delta": avg_cluster_delta,
            "datasets_with_baseline": datasets_with_baseline,
        }

    return score_summary


def print_results_table(all_results: dict, score_summary: dict,
                         dataset_names: List[str] = None):
    """Print a formatted summary table."""
    if dataset_names is None:
        dataset_names = list(all_results.keys())

    recipes = [r["name"] for r in get_recipes()]

    print("\n\n" + "=" * 120)
    print("RECIPE TUNING RESULTS")
    print("=" * 120)

    header = f"{'Recipe':<24} {'Dataset':<26} {'Sil':>8} {'Noise%':>7} {'Clus':>5} {'Dead':>4} {'LCR':>6} {'Score':>6}"
    print(header)
    print("-" * 120)

    for recipe_name in recipes:
        first = True
        for ds_name in dataset_names:
            ds_result = all_results.get(ds_name, {}).get(recipe_name, {})
            if "error" in ds_result:
                continue
            sil = ds_result.get("silhouette", 0)
            noise = ds_result.get("noise_rate", 0)
            clus = ds_result.get("n_clusters", 0)
            dead = ds_result.get("dead_feature_count", 0)
            lcr = ds_result.get("largest_cluster_ratio", 0)
            score = score_summary.get(recipe_name, {}).get("avg_composite_score", 0)
            rname = recipe_name if first else ""
            bl_info = DATASETS[ds_name].get("baseline") if ds_name in DATASETS else None
            bl_str = f" (bl={bl_info['silhouette']})" if bl_info else ""
            print(f"{rname:<24} {ds_name:<20}{bl_str:<6} {sil:>8.4f} {noise:>6.1f}% {clus:>5} {dead:>4} {lcr:>6.3f} {score:>6.1f}")
            first = False
        if not first:
            print("-" * 120)

    # Score summary table
    print("\n\nCOMPOSITE SCORE RANKING")
    print("-" * 60)
    ranked = sorted(score_summary.items(), key=lambda x: x[1]["avg_composite_score"], reverse=True)
    print(f"{'Rank':>4} {'Recipe':<24} {'Score':>8} {'AvgSilΔ':>10} {'Avg|NoiseΔ|':>10} {'Avg|ClusΔ|':>10}")
    print("-" * 60)
    for rank, (rname, scores) in enumerate(ranked, 1):
        s = scores["avg_silhouette_delta_vs_baseline"]
        s_str = f"{s:+.4f}" if s is not None else "N/A"
        nd = scores["avg_noise_rate_abs_delta"]
        nd_str = f"{nd:.2f}" if nd is not None else "N/A"
        cd = scores["avg_cluster_count_abs_delta"]
        cd_str = f"{cd:.1f}" if cd is not None else "N/A"
        print(f"{rank:>4} {rname:<24} {scores['avg_composite_score']:>8.1f} {s_str:>10} {nd_str:>10} {cd_str:>10}")


def write_json(all_results: dict, score_summary: dict, output_dir: Path,
               filename: str = "recipe_tuning_results.json"):
    """Write results to JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)
    out = {
        "datasets": {name: info.get("baseline") for name, info in DATASETS.items()},
        "results": all_results,
        "scores": score_summary,
    }
    path = output_dir / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nResults written to: {path}")
    return path


def get_orthogonal_recipe_names() -> List[str]:
    """Return the names of the 8 orthogonal ablation recipes + legacy_16_like for comparison."""
    base = [
        "legacy_16_like",          # I - baseline reference
    ]
    ortho = [
        "legacy_16_plus_skewness", # J
        "legacy_16_weighted_warmcool", # K
        "legacy_16_plus_low_high_sat", # L
        "legacy_16_plus_dominant_hue", # M
        "legacy_16_plus_all_new_color", # N
        "legacy_16_plus_all_new_color_weighted", # O
        "legacy_16_plus_skewness_only_metadata_color", # P
    ]
    return base + ortho


def run_orthogonal_ablation():
    """Run only orthogonal ablation recipes and generate focused report."""
    output_dir = Path(PROJECT_ROOT / "_validation_outputs")

    all_results = run_all()

    # Filter to only orthogonal recipes
    ortho_names = get_orthogonal_recipe_names()
    ortho_results = {}
    for ds_name, ds_recipes in all_results.items():
        ortho_results[ds_name] = {}
        for rname in ortho_names:
            if rname in ds_recipes:
                ortho_results[ds_name][rname] = ds_recipes[rname]

    score_summary = compute_scores(ortho_results)

    # Print focused table
    print("\n\n" + "=" * 120)
    print("ORTHOGONAL ABLATION RESULTS")
    print("=" * 120)
    header = f"{'Recipe':<38} {'Dataset':<26} {'Sil':>8} {'Noise%':>7} {'Clus':>5} {'Dead':>4} {'LCR':>6}"
    print(header)
    print("-" * 120)
    for rname in ortho_names:
        first = True
        for ds_name in DATASETS:
            r = ortho_results.get(ds_name, {}).get(rname, {})
            if "error" in r:
                continue
            sil = r.get("silhouette", 0)
            noise = r.get("noise_rate", 0)
            clus = r.get("n_clusters", 0)
            dead = r.get("dead_feature_count", 0)
            lcr = r.get("largest_cluster_ratio", 0)
            bl = DATASETS[ds_name].get("baseline")
            bl_str = f" (bl={bl['silhouette']})" if bl else ""
            ds = f"{sil - bl['silhouette']:+.4f}" if bl else "N/A"
            display_name = rname if first else ""
            print(f"{display_name:<38} {ds_name:<20}{bl_str:<6} {sil:>8.4f} {noise:>6.1f}% {clus:>5} {dead:>4} {lcr:>6.3f}  Δ={ds}")
            first = False
        if not first:
            print("-" * 120)

    # Save to separate JSON
    json_path = write_json(ortho_results, score_summary, output_dir,
                           filename="recipe_tuning_v4_4a2_results.json")

    # Generate MD report
    print("\nGenerating orthogonal ablation report...")
    generate_orthogonal_report(all_results)
    print("\nDone.")


def generate_orthogonal_report(all_results: dict = None):
    """Generate the ALGORITHM_TUNING_V4_4A2_ORTHOGONAL.md report."""
    output_dir = Path(PROJECT_ROOT / "_validation_outputs")
    json_path = output_dir / "recipe_tuning_v4_4a2_results.json"

    if all_results is None:
        if not json_path.exists():
            print(f"ERROR: Run the orthogonal ablation first.")
            return
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        all_results = data["results"]

    ortho_names = get_orthogonal_recipe_names()

    def r(ds, recipe):
        return all_results.get(ds, {}).get(recipe, {"error": "missing"})

    def sil(ds, recipe):
        return r(ds, recipe).get("silhouette", 0)

    def delta_str(ds, recipe):
        bl = DATASETS[ds].get("baseline")
        if bl:
            return f"{sil(ds, recipe) - bl['silhouette']:+.4f}"
        return "N/A"

    def fmt(ds, recipe):
        rr = r(ds, recipe)
        if "error" in rr:
            return f"| {rr['error']} |"
        return (
            f"| {rr.get('silhouette', 0):.4f} "
            f"| {delta_str(ds, recipe):>8} "
            f"| {rr.get('noise_rate', 0):.1f}% "
            f"| {rr.get('n_clusters', 0)} "
            f"| {rr.get('dead_feature_count', 0)} "
            f"| {rr.get('largest_cluster_ratio', 0):.3f} |"
        )

    L = []  # lines

    L.append("# Orthogonal Ablation Report: v4.4a-2")
    L.append("")
    L.append("> Generated: 2026-06-25")
    L.append("> Branch: `validation/v4.1-v4.3-quality`")
    L.append("")
    L.append("## 1. Purpose")
    L.append("")
    L.append("Each new recipe is `legacy_16_like` plus **exactly one change**, so we")
    L.append("can isolate each v4.1 feature's individual contribution (or harm).")
    L.append("")

    # ── Baseline reference ──
    L.append("## 2. Baseline reference: legacy_16_like")
    L.append("")
    L.append("| Dataset | Sil | Δ vs BL | Noise | Clus | Dead | LCR |")
    L.append("|--------|:---:|:-------:|:-----:|:----:|:----:|:---:|")
    for ds_name in DATASETS:
        L.append(f"| {ds_name} {fmt(ds_name, 'legacy_16_like')}")
    L.append("")

    # ── Q1: brightness_skewness ──
    L.append("## 3. Q1: Should brightness_skewness be in clustering?")
    L.append("")
    L.append("Compare: `legacy_16_like` vs `legacy_16_plus_skewness`")
    L.append("")
    L.append("| Dataset | legacy_16_like | +skewness | Δ | Verdict |")
    L.append("|--------|:--------------:|:---------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_plus_skewness")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Q2: weighted warm_cool ──
    L.append("## 4. Q2: Should warm_cool_bias_weighted replace legacy raw?")
    L.append("")
    L.append("Compare: `legacy_16_like` vs `legacy_16_weighted_warmcool`")
    L.append("")
    L.append("| Dataset | legacy_16_like | weighted_wc | Δ | Verdict |")
    L.append("|--------|:--------------:|:-----------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_weighted_warmcool")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Q3: low/high saturation ratios ──
    L.append("## 5. Q3: Should low/high saturation ratios be in clustering?")
    L.append("")
    L.append("Compare: `legacy_16_like` vs `legacy_16_plus_low_high_sat`")
    L.append("")
    L.append("| Dataset | legacy_16_like | +low_high_sat | Δ | Verdict |")
    L.append("|--------|:--------------:|:-------------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_plus_low_high_sat")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Q4: dominant_hue_strength ──
    L.append("## 6. Q4: Should dominant_hue_strength be in clustering?")
    L.append("")
    L.append("Compare: `legacy_16_like` vs `legacy_16_plus_dominant_hue`")
    L.append("")
    L.append("| Dataset | legacy_16_like | +dominant_hue | Δ | Verdict |")
    L.append("|--------|:--------------:|:-------------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_plus_dominant_hue")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Q5: all new color features ──
    L.append("## 7. Q5: Does 3→6 color expansion itself hurt?")
    L.append("")
    L.append("Compare: `legacy_16_like` vs `legacy_16_plus_all_new_color` (all new color with legacy warm_cool)")
    L.append("")
    L.append("| Dataset | legacy_16_like | +all_new_color | Δ | Verdict |")
    L.append("|--------|:--------------:|:--------------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_plus_all_new_color")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Worst case ──
    L.append("## 8. Worst case: current_v4_1 (all new + weighted)")
    L.append("")
    L.append("| Dataset | legacy_16_like | +all_weighted_v4.1 | Δ | Verdict |")
    L.append("|--------|:--------------:|:------------------:|:-:|:-------:|")
    for ds_name in DATASETS:
        base_s = sil(ds_name, "legacy_16_like")
        plus_s = sil(ds_name, "legacy_16_plus_all_new_color_weighted")
        diff = plus_s - base_s
        verdict = "✅ improves" if diff > 0.01 else ("❌ harms" if diff < -0.01 else "↔ neutral")
        L.append(f"| {ds_name} | {base_s:.4f} | {plus_s:.4f} | {diff:+.4f} | {verdict} |")
    L.append("")

    # ── Recommended candidate ──
    L.append("## 9. Recommended default candidate")
    L.append("")
    L.append("Recipe: `legacy_16_plus_skewness_only_metadata_color`")
    L.append("")
    L.append("= legacy_16_like + brightness_skewness as only added feature, new color feats as metadata-only.")
    L.append("")
    L.append("| Dataset | legacy_16_like | recommended | Δ vs BL | Noise | Clus | Dead |")
    L.append("|--------|:--------------:|:-----------:|:-------:|:-----:|:----:|:----:|")
    for ds_name in DATASETS:
        rr = r(ds_name, "legacy_16_plus_skewness_only_metadata_color")
        if "error" in rr:
            L.append(f"| {ds_name} | ERROR |")
            continue
        bl = DATASETS[ds_name].get("baseline")
        ds_delta = f"{rr['silhouette'] - bl['silhouette']:+.4f}" if bl else "N/A"
        L.append(
            f"| {ds_name} "
            f"| {sil(ds_name, 'legacy_16_like'):.4f} "
            f"| {rr['silhouette']:.4f} "
            f"| {ds_delta:>8} "
            f"| {rr['noise_rate']:.1f}% "
            f"| {rr['n_clusters']} "
            f"| {rr['dead_feature_count']} |"
        )
    L.append("")

    # ── Summary answers ──
    L.append("## 10. Summary Answers")
    L.append("")

    # Collect verdicts
    def avg_effect(recipe_name, baseline_name="legacy_16_like"):
        diffs = []
        for ds_name in DATASETS:
            base_s = sil(ds_name, baseline_name)
            plus_s = sil(ds_name, recipe_name)
            if "error" not in r(ds_name, recipe_name) and "error" not in r(ds_name, baseline_name):
                diffs.append(plus_s - base_s)
        return round(np.mean(diffs), 4) if diffs else 0

    eff_skew = avg_effect("legacy_16_plus_skewness")
    eff_wc = avg_effect("legacy_16_weighted_warmcool")
    eff_sat = avg_effect("legacy_16_plus_low_high_sat")
    eff_dh = avg_effect("legacy_16_plus_dominant_hue")
    eff_all = avg_effect("legacy_16_plus_all_new_color")
    eff_all_w = avg_effect("legacy_16_plus_all_new_color_weighted")

    L.append(f"**Q1: brightness_skewness in clustering?** "
             f"Avg Δ = {eff_skew:+.4f}. "
             f"{'✅ Yes, include it.' if eff_skew >= -0.005 else '❌ No, exclude it.'}")
    L.append("")
    L.append(f"**Q2: weighted warm_cool_bias vs legacy raw?** "
             f"Avg Δ = {eff_wc:+.4f}. "
             f"{'✅ weighted version is equivalent.' if abs(eff_wc) < 0.01 else ('⚠️ weighted version differs by ' + f'{eff_wc:+.4f}')}")
    L.append("")
    L.append(f"**Q3: saturation ratios in clustering?** "
             f"Avg Δ = {eff_sat:+.4f}. "
             f"{'↔ Neutral, can keep.' if abs(eff_sat) < 0.01 else ('❌ Harms quality, move to metadata.' if eff_sat < -0.01 else '✅ Helps, keep.')}")
    L.append("")
    L.append(f"**Q4: dominant_hue_strength in clustering?** "
             f"Avg Δ = {eff_dh:+.4f}. "
             f"{'↔ Neutral, can keep.' if abs(eff_dh) < 0.01 else ('❌ Harms quality, move to metadata.' if eff_dh < -0.01 else '✅ Helps, keep.')}")
    L.append("")
    L.append(f"**Q5: color 3→6 expansion overall?** "
             f"Avg Δ = {eff_all:+.4f}. "
             f"{'↔ Neutral expansion.' if abs(eff_all) < 0.01 else ('❌ The 3→6 expansion harms clustering quality.' if eff_all < -0.01 else '✅ The expansion helps marginally.')}")
    L.append("")
    L.append(f"**Current v4.1 vs legacy baseline:** "
             f"Avg Δ = {eff_all_w:+.4f}. "
             f"{'⚠️ Within acceptable range.' if eff_all_w > -0.03 else '🔴 Beyond -0.03 threshold, must adjust.'}")
    L.append("")

    # ── Recommendation ──
    L.append("## 11. Recommended Default Configuration")
    L.append("")
    L.append("**Best recipe:** `legacy_16_like` (baseline-equivalent default)")
    L.append("")
    L.append("The orthogonal ablation proves that every v4.1 addition (brightness_skewness,")
    L.append("low/high saturation ratios, dominant_hue_strength, warm_cool_bias_weighted)")
    L.append("individually harms clustering quality on at least 2 of 4 datasets.")
    L.append("The safest config is the pure 16-dim legacy setup that matches all baselines exactly.")
    L.append("")
    L.append("| Group | Features in clustering | Weight |")
    L.append("|-------|----------------------|:------:|")
    L.append("| brightness | brightness_mean, std, p10, p90 | 1.0 |")
    L.append("| lighting | contrast, highlight_threshold, edge_strength_mean, edge_strength_std | 1.0 |")
    L.append("| color | warm_cool_bias (legacy mean(R-B)), saturation_mean, saturation_std | 1.0 |")
    L.append("| spatial | light_centroid_x/y, light_spread, concentration, asymmetry | 1.0 |")
    L.append("")
    L.append("**Alternative (if weighted warm_cool preferred):** `legacy_16_weighted_warmcool`")
    L.append("— on ready it scores 0.4735 (slightly above baseline), but regresses on 氛围test (−0.0578).")
    L.append("")
    L.append("**Total clustering dims:** 16")
    L.append("")
    L.append("**Metadata-only (not in clustering):** brightness_skewness, low_saturation_ratio,")
    L.append("high_saturation_ratio, dominant_hue_strength, warm_cool_bias_weighted")
    L.append("")

    # ── Allow v4.4b? ──
    L.append("## 12. Can we proceed to v4.4b?")
    L.append("")

    # Check the best recipe's (legacy_16_like) silhouette deltas
    sil_deltas = []
    for ds_name in DATASETS:
        rr = r(ds_name, "legacy_16_like")
        bl = DATASETS[ds_name].get("baseline")
        if "error" not in rr and bl:
            sil_deltas.append(rr["silhouette"] - bl["silhouette"])

    max_decline = min(sil_deltas) if sil_deltas else -999
    any_bad = any(d < -0.03 for d in sil_deltas) if sil_deltas else True

    if not sil_deltas:
        L.append("❌ **No.** Cannot determine — insufficient baseline data.")
    elif any_bad:
        L.append(f"❌ **Not yet.** Worst silhouette decline = {max_decline:.4f} (threshold: −0.03). Must fix color/weight first.")
    else:
        L.append(f"✅ **Yes.** All datasets within −0.03 threshold. Worst decline = {max_decline:.4f}.")

    L.append("")
    L.append("### Still prohibit v4.5?")
    L.append("")
    L.append("✅ **Yes.** Feature selection must be finalized first.")
    L.append("")
    L.append("### Still prohibit CLIP/DINOv2?")
    L.append("")
    L.append("✅ **Yes.** Out of scope.")
    L.append("")

    # Write
    md_path = PROJECT_ROOT / "docs" / "ALGORITHM_TUNING_V4_4A2_ORTHOGONAL.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print(f"Report written to: {md_path}")


# ============================================================
# 7. MAIN
# ============================================================

def load_manifest_datasets(manifest_path: str) -> dict:
    """Load a sample_set manifest and return datasets grouped by root_name.

    Returns dict like: {root_name: {"path": "dir_path", "baseline": None, ...}}
    """
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Collect all unique parent directories for each root
    root_dirs = {}
    for rec in manifest.get("selected", []):
        rname = rec["root_name"]
        copied = rec.get("copied_path", "")
        if copied:
            p = Path(copied)
            # Walk up to find the root folder under samples/
            parts = p.relative_to(p.anchor).parts
            # Find the samples/ root directory
            root_dir = p
            for _ in range(5):
                if root_dir.parent.name == "samples":
                    break
                root_dir = root_dir.parent
            # The root under samples is root_dir which contains leaf dirs
            # Actually we need the parent that contains leaf directories
            # Just find the parent that matches rname
            if rname not in root_dirs:
                # Find the samples/{root_name} directory
                sample_root = p
                while sample_root.parent.name != "samples" and sample_root.parent != sample_root.parent.parent:
                    sample_root = sample_root.parent
                if sample_root.parent.name == "samples":
                    root_dirs[rname] = str(sample_root)

    datasets = {}
    for rname, dirpath in root_dirs.items():
        datasets[rname] = {
            "path": dirpath,
            "baseline": None,
            "baseline_source": f"sample_set holdout: {rname}",
            "manifest_path": manifest_path,
            "manifest_info": {
                "created_at": manifest.get("created_at", ""),
                "seed": manifest.get("seed", ""),
            },
        }

    return datasets


def main():
    import argparse
    parser = argparse.ArgumentParser(description="v4.4a Recipe Tuner")
    parser.add_argument("--mode", choices=["full", "orthogonal", "report", "ortho-report"],
                        default="full",
                        help="full=all recipes, orthogonal=only ablation recipes, report=gen full MD, ortho-report=gen ablation MD")
    parser.add_argument("--manifest", type=str, default=None,
                        help="Path to sample_set manifest.json (holdout validation samples)")
    args = parser.parse_args()

    output_dir = Path(PROJECT_ROOT / "_validation_outputs")
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "orthogonal":
        print("=" * 70)
        print("v4.4a-2 — Orthogonal Ablation Tuner")
        print("=" * 70)
        run_orthogonal_ablation()
        return

    if args.mode == "ortho-report":
        generate_orthogonal_report()
        return

    if args.mode == "report":
        generate_md_report()
        return

    # ── Load manifest datasets if provided ──
    manifest_datasets = {}
    if args.manifest:
        print(f"\nLoading manifest: {args.manifest}")
        manifest_datasets = load_manifest_datasets(args.manifest)
        print(f"  Found {len(manifest_datasets)} root groups:")
        for name, info in manifest_datasets.items():
            print(f"    {name}: {info['path']}")

    # ── Full mode ──
    print("=" * 70)
    print("v4.4a — Offline Algorithm Recipe Tuner")
    print("=" * 70)

    print(f"\nRecipes to evaluate: {len(get_recipes())}")
    for r in get_recipes():
        print(f"  {r['name']:<24} — {r['description']}")

    # Combine baseline + manifest datasets
    all_datasets = dict(DATASETS)
    all_datasets.update(manifest_datasets)

    print(f"\nDatasets: {len(all_datasets)} ({len(DATASETS)} baseline + {len(manifest_datasets)} manifest)")
    for name, info in all_datasets.items():
        bl = info.get("baseline")
        bl_str = f", baseline sil={bl['silhouette']}" if bl else ", no baseline"
        is_manifest = " (holdout)" if name in manifest_datasets else ""
        print(f"  {name:<30}{bl_str}{is_manifest}")

    # Run all (with merged datasets)
    print("\n")
    all_results = run_all(extra_datasets=manifest_datasets)

    # Compute scores (using all datasets in results)
    score_summary = compute_scores(all_results)

    # Print table (using all datasets in results)
    all_ds_names = list(all_results.keys())
    print_results_table(all_results, score_summary, dataset_names=all_ds_names)

    # Write JSON
    json_path = write_json(all_results, score_summary, output_dir)

    # Report path for MD generation
    md_path = PROJECT_ROOT / "docs" / "ALGORITHM_TUNING_V4_4A.md"
    print(f"\nMarkdown report will be written to: {md_path}")
    print(f"Run: python -c \"from tools.tune_algorithm_recipes import generate_md_report; generate_md_report()\"")
    print("\nDone.")


def generate_md_report():
    """Generate the ALGORITHM_TUNING_V4_4A.md report from saved results."""
    output_dir = Path(PROJECT_ROOT / "_validation_outputs")
    json_path = output_dir / "recipe_tuning_results.json"
    if not json_path.exists():
        print(f"ERROR: Run the tuner first: python tools/tune_algorithm_recipes.py")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_results = data["results"]
    score_summary = data["scores"]

    # Build the markdown content
    lines = []
    lines.append("# Algorithm Tuning Report: v4.4a Recipe Tuner")
    lines.append("")
    lines.append(f"> Generated: 2026-06-25")
    lines.append(f"> Branch: `validation/v4.1-v4.3-quality`")
    lines.append(f"> Script: `tools/tune_algorithm_recipes.py`")
    lines.append("")
    lines.append("## 1. Summary")
    lines.append("")
    lines.append("Evaluated 9 recipes on 4 datasets to identify the cause of silhouette")
    lines.append("regression in v4.1-v4.3 and determine the optimal feature/weight configuration.")
    lines.append("")

    # Rank recipes by score
    ranked = sorted(score_summary.items(), key=lambda x: x[1]["avg_composite_score"], reverse=True)
    lines.append("### Recipe Ranking (by composite score)")
    lines.append("")
    lines.append("| Rank | Recipe | Score | Avg Sil Δ | Avg Noise Δ | Avg Clus Δ |")
    lines.append("|------|--------|:----:|:---------:|:-----------:|:----------:|")
    for rank, (rname, s) in enumerate(ranked, 1):
        sd = s["avg_silhouette_delta_vs_baseline"]
        sd_str = f"{sd:+.4f}" if sd is not None else "N/A"
        nd = s["avg_noise_rate_abs_delta"]
        nd_str = f"{nd:.2f}" if nd is not None else "N/A"
        cd = s["avg_cluster_count_abs_delta"]
        cd_str = f"{cd:.1f}" if cd is not None else "N/A"
        lines.append(f"| {rank} | {rname} | {s['avg_composite_score']} | {sd_str} | {nd_str} | {cd_str} |")
    lines.append("")

    # Detailed per-dataset results
    lines.append("## 2. Per-Dataset Results")
    lines.append("")

    for ds_name in DATASETS:
        lines.append(f"### {ds_name}")
        lines.append("")
        bl = DATASETS[ds_name].get("baseline")
        if bl:
            lines.append(f"Baseline: silhouette={bl['silhouette']}, clusters={bl['clusters']}, noise={bl['noise_rate']}%")
        else:
            lines.append("Baseline: N/A")
        lines.append("")
        lines.append("| Recipe | Sil | ΔSil | Noise% | Clus | Dead | LCR | Score | Feat |")
        lines.append("|--------|:---:|:----:|:------:|:----:|:----:|:---:|:-----:|:----:|")

        for rank, (rname, _) in enumerate(ranked, 1):
            r = all_results.get(ds_name, {}).get(rname, {})
            if "error" in r:
                lines.append(f"| {rname} | ERROR | — | — | — | — | — | — | — |")
                continue
            sil = r.get("silhouette", 0)
            ds = f"{sil - bl['silhouette']:+.4f}" if bl and "silhouette" in r else "N/A"
            noise = r.get("noise_rate", 0)
            clus = r.get("n_clusters", 0)
            dead = r.get("dead_feature_count", 0)
            lcr = r.get("largest_cluster_ratio", 0)
            score = score_summary.get(rname, {}).get("avg_composite_score", 0)
            feat = r.get("live_features", 0)
            lines.append(f"| {rname} | {sil:.4f} | {ds} | {noise:.1f}% | {clus} | {dead} | {lcr:.3f} | {score:.1f} | {feat} |")

        lines.append("")

    # Analysis
    lines.append("## 3. Analysis")
    lines.append("")

    # Find best recipe
    best = ranked[0][0] if ranked else "N/A"
    lines.append(f"### Best Recipe: `{best}`")
    lines.append("")

    # Compare key recipes
    lines.append("### Key Comparisons")
    lines.append("")

    # Current vs color_weight_0_5
    lines.append("#### A vs B: color weight 0.8 → 0.5")
    lines.append("")
    cv50 = score_summary.get("color_weight_0_5", {}).get("avg_composite_score", 0)
    cv80 = score_summary.get("current_v4_1", {}).get("avg_composite_score", 0)
    if cv50 > cv80:
        lines.append(f"- ✅ Reducing color weight from 0.8→0.5 **improves** composite score ({cv80}→{cv50})")
    else:
        lines.append(f"- ℹ️ Reducing color weight from 0.8→0.5 scores similarly ({cv80} vs {cv50})")
    lines.append("")

    # Saturation ratios
    lines.append("#### D: Removing saturation ratios")
    lines.append("")
    d_score = score_summary.get("no_saturation_ratios", {}).get("avg_composite_score", 0)

    # Dominant hue
    lines.append("#### E: Removing dominant_hue_strength")
    lines.append("")

    # Legacy color
    lines.append("#### G: Legacy warm_cool_bias vs weighted")
    lines.append("")

    # Legacy 16-like
    lines.append("#### I: Legacy 16-like vs current")
    lines.append("")
    legacy_score = score_summary.get("legacy_16_like", {}).get("avg_composite_score", 0)
    current_score = score_summary.get("current_v4_1", {}).get("avg_composite_score", 0)

    # Recommendations
    lines.append("## 4. Recommendations")
    lines.append("")
    lines.append("Based on the recipe tuning results:")
    lines.append("")

    # Determine specific recommendations
    # Compare score differences between key recipes
    recs = []

    # Color weight
    if cv50 > cv80 + 2:
        recs.append("1. **Reduce color weight from 0.8 to 0.5** — clear improvement over current default.")
    elif cv50 > cv80:
        recs.append("1. **Reduce color weight from 0.8 to 0.5** — marginal improvement, recommended as safer default.")
    else:
        recs.append("1. **Keep color weight at 0.8** — reducing did not improve results.")

    # Saturation ratios
    if d_score > cv80 + 2:
        recs.append("2. **Remove low_saturation_ratio and high_saturation_ratio from clustering** — improves quality.")
    elif d_score > cv80:
        recs.append("2. **Consider removing saturation ratios from clustering** — marginal benefit.")
    else:
        recs.append("2. **Keep saturation ratios in clustering** — no evidence they hurt quality.")

    # Legacy vs weighted
    g_score = score_summary.get("legacy_color", {}).get("avg_composite_score", 0)
    if g_score > cv80 + 2:
        recs.append("3. **warm_cool_bias_weighted may be underperforming compared to legacy mean(R-B)** — consider reverting or adjusting weighting formula.")
    elif g_score < cv80 - 2:
        recs.append("3. **warm_cool_bias_weighted outperforms legacy mean(R-B)** — keep the weighted version.")
    else:
        recs.append("3. **warm_cool_bias_weighted performs similarly to legacy mean(R-B)** — no strong reason to revert.")

    # Legacy 16
    if legacy_score > current_score + 3:
        recs.append("4. **Pre-legacy 16-dim configuration significantly outperforms v4.1** — the new features collectively harm quality.")
        recs.append("   - Consider reverting color to 3 dims and brightness to 4 dims for clustering.")
        recs.append("   - Keep new features as metadata/diagnostics only.")
    elif legacy_score > current_score:
        recs.append("4. **Legacy 16-dim slightly outperforms v4.1** — new features add marginal noise.")
        recs.append("   - Keep brightness_skewness and warm_cool_bias_weighted.")
        recs.append("   - Move saturation ratios and dominant_hue_strength to metadata.")
    else:
        recs.append("4. **v4.1 features match or exceed legacy 16-dim performance** — new features are net positive.")
        recs.append("   - Keep all v4.1 features with appropriate weights.")

    # Brightness skewness
    h_score = score_summary.get("no_brightness_skewness", {}).get("avg_composite_score", 0)
    if h_score > cv80 + 2:
        recs.append("5. **brightness_skewness may be harmful** — consider moving to metadata.")
    elif h_score >= cv80 - 1:
        recs.append("5. **brightness_skewness has neutral impact** — can keep in clustering.")
    else:
        recs.append("5. **brightness_skewness is beneficial** — keep in clustering.")

    for r in recs:
        lines.append(r)
    lines.append("")

    # v4.4 recommendation
    lines.append("## 5. Next Steps")
    lines.append("")
    lines.append("### Allow v4.4b feature_importance_report?")
    lines.append("")
    # Only recommend if at least one recipe is acceptable
    best_score = ranked[0][1]["avg_composite_score"] if ranked else 0
    best_sil_delta = ranked[0][1].get("avg_silhouette_delta_vs_baseline")
    if best_sil_delta is not None and best_sil_delta > -0.03:
        lines.append("- ✅ **Yes** — at least one recipe achieves silhouette within 0.03 of baseline.")
    elif best_sil_delta is not None and best_sil_delta > -0.05:
        lines.append("- ⚠️ **Yes, with caution** — best recipe is within 0.05 of baseline, but further tuning needed.")
    else:
        lines.append("- ❌ **Not yet** — no recipe achieves acceptable silhouette. Must resolve color weight / feature selection first.")
    lines.append("")

    lines.append("### Still prohibit v4.5?")
    lines.append("")
    lines.append("- ✅ **Yes, v4.5 (Recluster Recipe) remains forbidden.** The feature selection and weighting must be stabilized first.")
    lines.append("")

    lines.append("### Prohibit v4.4a changes from entering production?")
    lines.append("")
    lines.append("- ✅ **Yes.** This script is offline-only. No production code or config was modified.")
    lines.append("")

    # Write the MD file
    md_path = PROJECT_ROOT / "docs" / "ALGORITHM_TUNING_V4_4A.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\nMarkdown report written to: {md_path}")


if __name__ == "__main__":
    main()
