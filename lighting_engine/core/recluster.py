"""Recluster preview runner (v4.5).

Reads cached features from a completed job, runs a new clustering
using a specified recipe, and writes preview outputs WITHOUT
overwriting the active clustering state.

Preview outputs go to: <job_output>/recluster_previews/<preview_id>/
"""

import json
import math
import os
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler

from .recipe import (
    get_builtin_recipe, get_selected_feature_names, validate_recipe,
    FEATURE_NAMES_20,
)

# ============================================================
# Feature loading
# ============================================================

def load_features_from_job(job_dir: str) -> Tuple[np.ndarray, List[str], List[str]]:
    """Load features.csv from a completed job.

    Returns:
        features: (n, d) numpy array of feature values (float32)
        feature_names: list of feature column names
        filenames: list of image filenames
    """
    job_path = Path(job_dir)
    csv_path = job_path / "features.csv"
    if not csv_path.exists():
        # Try parent
        csv_path = job_path.parent / "features.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"features.csv not found in {job_dir}")

    df = pd.read_csv(csv_path)
    filenames = df["filename"].tolist() if "filename" in df.columns else []

    # Feature columns: all columns except filename and cluster_id
    feature_cols = [c for c in df.columns if c not in ("filename", "cluster_id")]
    if not feature_cols:
        raise ValueError("No feature columns found in features.csv")

    features = df[feature_cols].values.astype(np.float32)
    return features, feature_cols, filenames


def build_recipe_features(
    features_20: np.ndarray,
    orig_feature_names: List[str],
    recipe: dict,
) -> Tuple[np.ndarray, List[str]]:
    """Select and order features from the 20-dim matrix according to recipe.

    The recipe's selected_feature_indices refer to positions in FEATURE_NAMES_20.
    If the original features.csv doesn't match FEATURE_NAMES_20 ordering,
    we do a name-based remapping.
    """
    indices = recipe.get("selected_feature_indices", [])
    extra = recipe.get("extra_features", [])

    # Build a name→index map for the loaded features
    name_to_col = {n: i for i, n in enumerate(orig_feature_names)}

    # Map requested indices to actual columns
    selected_cols = []
    selected_names = []

    for idx in indices:
        req_name = FEATURE_NAMES_20[idx]
        if req_name in name_to_col:
            selected_cols.append(name_to_col[req_name])
            selected_names.append(req_name)
        else:
            # Feature might not exist in this features.csv (e.g., old version)
            # Fill with zeros
            pass

    if not selected_cols:
        raise ValueError("No matching features found in features.csv")

    feat = features_20[:, selected_cols].copy()

    # Add extra features (e.g., legacy_warm_cool_bias)
    for extra_name in extra:
        if extra_name == "legacy_warm_cool_bias":
            # Compute from warm_cool_bias_weighted if available
            if "warm_cool_bias_weighted" in name_to_col:
                # legacy warm_cool = mean(R-B) is NOT in features.csv directly
                # We approximate by using warm_cool_bias_weighted if raw is unavailable
                pass
            # If warm_cool_bias is in the features (from new config), use it directly
            if "warm_cool_bias" in name_to_col:
                wc_col = name_to_col["warm_cool_bias"]
                # Already included via index 9 mapping... but wait,
                # FEATURE_NAMES_20 index 9 is warm_cool_bias_weighted, not raw.
                # The legacy recipe uses raw warm_cool which is now at index 9
                # in the new ordering but was at a different position before.
                # With the new config, warm_cool_bias (raw) is at index 9 in FEATURE_NAMES_20.
                # We just need to ensure it's included.
                pass

    return feat, selected_names


def _compute_legacy_warm_cool_from_csv(csv_path: str) -> Optional[np.ndarray]:
    """Attempt to compute legacy warm_cool from features.csv.
    This only works if the features.csv contains warm_cool_bias or
    warm_cool_bias_weighted which can approximate it.
    Returns None if not available.
    """
    # For now, this is a placeholder. In practice, the features.csv
    # from the new config will have warm_cool_bias (raw) directly.
    return None


# ============================================================
# Clustering
# ============================================================

def run_recluster(
    features: np.ndarray,
    feature_names: List[str],
    recipe: dict,
    n_images: int,
) -> dict:
    """Run clustering according to recipe.

    Returns dict with clustering results.
    """
    import umap
    import hdbscan
    from .feature_diagnostic import compute_diagnostics
    from .quality_metrics import compute_quality

    # Dead feature detection (always applied regardless of recipe)
    diag, keep_idx, dead_features = compute_diagnostics(features, feature_names)
    if dead_features:
        features = features[:, keep_idx]
        feature_names = [feature_names[i] for i in keep_idx]

    # Apply group weights
    weights = recipe.get("group_weights", {})
    GROUP_RANGES = {"brightness": (0, 5), "lighting": (5, 9), "color": (9, 15), "spatial_lighting": (15, 20)}
    groups = {g: [] for g in GROUP_RANGES}
    for idx, name in enumerate(feature_names):
        if "legacy" in name:
            groups["color"].append(idx)
            continue
        try:
            oi = FEATURE_NAMES_20.index(name)
        except ValueError:
            continue
        for g, (s, e) in GROUP_RANGES.items():
            if s <= oi < e:
                groups[g].append(idx)
                break

    features_w = features.copy().astype(np.float32)
    for g_name, indices in groups.items():
        w = weights.get(g_name, 1.0)
        for idx in indices:
            if idx < features_w.shape[1]:
                features_w[:, idx] *= w

    # Scale
    scaler = RobustScaler()
    features_scaled = scaler.fit_transform(features_w)

    # UMAP
    umap_cfg = recipe.get("umap", {})
    n_neighbors = umap_cfg.get("n_neighbors", 50)
    n_components = umap_cfg.get("n_components", 5)
    n_neighbors = min(n_neighbors, max(15, int(math.sqrt(n_images))))

    reducer = umap.UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=umap_cfg.get("min_dist", 0.05),
        metric=umap_cfg.get("metric", "euclidean"),
        random_state=umap_cfg.get("random_state", 42),
    )
    embedding = reducer.fit_transform(features_scaled)

    # HDBSCAN
    hdbscan_cfg = recipe.get("hdbscan", {})
    csr = hdbscan_cfg.get("cluster_size_ratio", 0.015)
    msr = hdbscan_cfg.get("min_samples_ratio", 0.3)
    mcs = max(5, min(50, int(n_images * csr)))
    ms = max(3, int(mcs * msr))

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=mcs,
        min_samples=ms,
        metric=hdbscan_cfg.get("metric", "euclidean"),
        cluster_selection_method=hdbscan_cfg.get("cluster_selection_method", "eom"),
    )
    labels = clusterer.fit_predict(embedding)

    n_clusters = len([l for l in set(labels) if l >= 0])
    noise_count = int(np.sum(labels == -1))
    noise_rate = noise_count / max(n_images, 1) * 100
    sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
    largest_ratio = max(sizes) / max(n_images, 1) if sizes else 0

    sil = compute_quality(embedding, labels).get("silhouette_score", 0) or 0

    return {
        "labels": labels.tolist(),
        "n_clusters": n_clusters,
        "noise_count": noise_count,
        "noise_rate": round(noise_rate, 2),
        "largest_cluster_ratio": round(float(largest_ratio), 4),
        "silhouette": round(float(sil), 4),
        "embedding": embedding.tolist(),
        "dead_features": dead_features,
        "live_features": features_w.shape[1],
        "alive_feature_names": feature_names,
    }


# ============================================================
# Preview output
# ============================================================

def generate_preview_id() -> str:
    """Generate a unique preview ID."""
    return f"preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


def compute_diff(
    old_labels: List[int],
    new_labels: List[int],
    filenames: List[str],
) -> dict:
    """Compute diff between old and new clustering."""
    old_labels_arr = np.array(old_labels)
    new_labels_arr = np.array(new_labels)
    n = len(filenames)

    changed = old_labels_arr != new_labels_arr
    changed_count = int(np.sum(changed))
    changed_ratio = round(changed_count / max(n, 1), 4)

    old_n_clusters = len([l for l in set(old_labels_arr) if l >= 0])
    new_n_clusters = len([l for l in set(new_labels_arr) if l >= 0])
    old_noise = int(np.sum(old_labels_arr == -1))
    new_noise = int(np.sum(new_labels_arr == -1))
    old_sizes = [int(np.sum(old_labels_arr == l)) for l in set(old_labels_arr) if l >= 0]
    new_sizes = [int(np.sum(new_labels_arr == l)) for l in set(new_labels_arr) if l >= 0]
    old_lcr = max(old_sizes) / max(n, 1) if old_sizes else 0
    new_lcr = max(new_sizes) / max(n, 1) if new_sizes else 0

    per_image = []
    for i in range(min(n, 1000)):  # Limit to first 1000 for manageability
        if changed[i]:
            per_image.append({
                "filename": filenames[i] if i < len(filenames) else f"img_{i}",
                "old_cluster": int(old_labels_arr[i]),
                "new_cluster": int(new_labels_arr[i]),
            })

    return {
        "total_images": n,
        "changed_cluster_count": changed_count,
        "changed_cluster_ratio": changed_ratio,
        "old_cluster_count": old_n_clusters,
        "new_cluster_count": new_n_clusters,
        "old_noise_count": int(old_noise),
        "new_noise_count": int(new_noise),
        "old_noise_rate": round(old_noise / max(n, 1) * 100, 2),
        "new_noise_rate": round(new_noise / max(n, 1) * 100, 2),
        "old_largest_cluster_ratio": round(float(old_lcr), 4),
        "new_largest_cluster_ratio": round(float(new_lcr), 4),
        "per_image_changes": per_image[:100],
        "per_image_truncated": len(per_image) > 100,
    }


def write_preview_output(
    output_dir: Path,
    filenames: List[str],
    labels: List[int],
    recipe: dict,
    result: dict,
    diff: dict,
):
    """Write preview outputs to output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # atlas_points.csv
    labels_arr = np.array(labels)
    atlas_df = pd.DataFrame({
        "image_path": filenames,
        "cluster_id": labels,
        "umap_x": [r[0] for r in result.get("embedding", [[0, 0]] * len(filenames))],
        "umap_y": [r[1] for r in result.get("embedding", [[0, 0]] * len(filenames))],
    })
    atlas_df.to_csv(output_dir / "atlas_points.csv", index=False)

    # cluster_summary.json
    unique_labels = sorted(set(l for l in labels if l >= 0))
    summary = {}
    for label in unique_labels:
        mask = labels_arr == label
        summary[f"cluster_{label}"] = {
            "count": int(np.sum(mask)),
            "ratio": round(float(np.sum(mask) / max(len(labels), 1)), 4),
        }
    with open(output_dir / "cluster_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    # cluster_names.json
    names = {str(k): f"cluster_{k:03d}" for k in unique_labels}
    with open(output_dir / "cluster_names.json", "w", encoding="utf-8") as f:
        json.dump(names, f, indent=2, ensure_ascii=False)

    # recipe.json
    recipe_copy = {k: v for k, v in recipe.items() if k != "embedding"}
    with open(output_dir / "recipe.json", "w", encoding="utf-8") as f:
        json.dump(recipe_copy, f, indent=2, ensure_ascii=False)

    # preview_metrics.json
    metrics = {
        "preview_id": output_dir.name,
        "created_at": datetime.now().isoformat(),
        "silhouette": result["silhouette"],
        "n_clusters": result["n_clusters"],
        "noise_rate": result["noise_rate"],
        "largest_cluster_ratio": result["largest_cluster_ratio"],
        "live_features": result["live_features"],
        "dead_features": result["dead_features"],
        "alive_feature_names": result["alive_feature_names"],
    }
    with open(output_dir / "preview_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    # diff_vs_current.json
    with open(output_dir / "diff_vs_current.json", "w", encoding="utf-8") as f:
        json.dump(diff, f, indent=2, ensure_ascii=False)

    print(f"  Preview written to: {output_dir}")


# ============================================================
# Main entry point
# ============================================================

def create_preview(
    job_dir: str,
    recipe: dict,
    current_labels: Optional[List[int]] = None,
    current_filenames: Optional[List[str]] = None,
) -> dict:
    """Create a recluster preview for a given job.

    Args:
        job_dir: Path to job output directory
        recipe: Recipe dict
        current_labels: Current cluster labels (for diff)
        current_filenames: Current filenames (for diff)

    Returns:
        dict with preview_id, metrics, diff, output_path
    """
    # Load features
    features, orig_names, filenames = load_features_from_job(job_dir)

    # Build recipe features
    feat, selected_names = build_recipe_features(features, orig_names, recipe)

    # Run clustering
    n = len(filenames) if filenames else features.shape[0]
    result = run_recluster(feat, selected_names, recipe, n)

    # Compute diff
    if current_labels is not None:
        diff = compute_diff(current_labels, result["labels"], current_filenames or filenames)
    else:
        diff = {"total_images": n, "note": "No current labels provided for diff"}

    # Write output
    preview_id = generate_preview_id()
    output_dir = Path(job_dir) / "recluster_previews" / preview_id
    write_preview_output(output_dir, filenames, result["labels"], recipe, result, diff)

    return {
        "preview_id": preview_id,
        "output_path": str(output_dir),
        "metrics": {
            "silhouette": result["silhouette"],
            "n_clusters": result["n_clusters"],
            "noise_rate": result["noise_rate"],
            "largest_cluster_ratio": result["largest_cluster_ratio"],
        },
        "diff_summary": {
            k: v for k, v in diff.items() if k != "per_image_changes"
        },
        "alive_feature_names": result["alive_feature_names"],
        "dead_features": result["dead_features"],
    }
