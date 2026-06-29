#!/usr/bin/env python3
"""
v4.4c-2 Reproducibility Audit.

Compares the actual CONFIG defaults vs the legacy_16_like recipe
to find the root cause of the reproducibility discrepancy.

Usage:
    python tools/audit_reproducibility.py
"""

import hashlib, json, math, sys, time
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import (
    assemble_batch, get_active_feature_names, FEATURE_GROUP_NAMES
)
from lighting_engine.core.preprocess import preprocess_all, find_images
from lighting_engine.core.feature_diagnostic import compute_diagnostics
from lighting_engine.core.quality_metrics import compute_quality
from sklearn.preprocessing import RobustScaler
import umap, hdbscan

SEED = 42

DATASETS = OrderedDict([
    ("ready_for_training_folder", str(PROJECT_ROOT / "ready_for_training_folder")),
    ("氛围test", str(PROJECT_ROOT / "氛围test")),
    ("写真test", str(PROJECT_ROOT / "写真test")),
    ("shexyo-47", str(PROJECT_ROOT / "shexyo-47")),
])

HOLDOUT_BASE = PROJECT_ROOT / "validation_samples" / "samples"
if not HOLDOUT_BASE.exists():
    HOLDOUT_BASE = PROJECT_ROOT.parent / "validation_samples" / "samples"
for name in ["images1", "画风"]:
    p = HOLDOUT_BASE / name
    if p.exists():
        DATASETS[f"holdout_{name}"] = str(p)

FEATURE_NAMES_20 = [
    "brightness_mean","brightness_std","brightness_p10","brightness_p90","brightness_skewness",
    "contrast","highlight_threshold","edge_strength_mean","edge_strength_std",
    "warm_cool_bias_weighted","saturation_mean","saturation_std",
    "low_saturation_ratio","high_saturation_ratio","dominant_hue_strength",
    "light_centroid_x","light_centroid_y","light_spread","light_concentration","light_asymmetry",
]


def checksum(arr):
    return hashlib.md5(arr.tobytes()).hexdigest()[:12]


def list_checksum(paths):
    data = "\n".join(sorted(str(p) for p in paths)).encode("utf-8")
    return hashlib.md5(data).hexdigest()[:12]


# ── Recipe A: CONFIG defaults (what pipeline actually uses) ──
def run_config_default(ds_path):
    """Run using actual config.py defaults."""
    paths = find_images([ds_path])
    paths.sort(key=str)  # FIX: force stable sort
    n = len(paths)
    path_hash = list_checksum(paths)
    images = preprocess_all(paths, max_workers=1)
    images.sort(key=lambda x: x[0])  # stable sort by filename
    images_rgb = [img for _, img in images]
    fg = CONFIG["feature_groups"]
    features, _ = assemble_batch(images, [None]*n, [None]*n, fg, max_workers=1)
    feature_names = get_active_feature_names(fg)
    feat_hash = checksum(features)
    return _cluster(features, feature_names, n, f"config_default", path_hash, feat_hash, n)


# ── Recipe B: legacy_16_like (what the validation REPORT claimed) ──
def run_legacy_16_like(ds_path):
    """legacy_16_like: brightness(4) + lighting(4) + legacy_wc + sat(2) + spatial(5)."""
    paths = find_images([ds_path])
    paths.sort(key=str)
    n = len(paths)
    path_hash = list_checksum(paths)
    images = preprocess_all(paths, max_workers=1)
    images.sort(key=lambda x: x[0])
    images_rgb = [img for _, img in images]

    # Build full 20-dim features (all groups with max dims)
    fg_full = {
        "brightness":       {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "亮度"},
        "lighting":         {"enabled": True, "dims": 4, "weight": 1.0, "cluster": True, "label": "光影"},
        "color":            {"enabled": True, "dims": 6, "weight": 1.0, "cluster": True, "label": "颜色"},
        "spatial_lighting": {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "空间光"},
    }
    features_20, _ = assemble_batch(images, [None]*n, [None]*n, fg_full, max_workers=1)

    # Select legacy_16_like columns
    keep = [0,1,2,3, 5,6,7,8, 10,11, 15,16,17,18,19]
    feat = features_20[:, keep].copy()
    names = [FEATURE_NAMES_20[i] for i in keep]
    # Add legacy warm_cool
    wc = np.array([float(np.mean(img[...,0]-img[...,2])) for img in images_rgb], dtype=np.float32).reshape(-1,1)
    feat = np.concatenate([feat, wc], axis=1)
    names.append("legacy_warm_cool_bias")
    feat_hash = checksum(feat)
    return _cluster(feat, names, n, "legacy_16_like", path_hash, feat_hash, n)


# ── Shared clustering ──
def _cluster(features, feature_names, n, recipe_label, path_hash, feat_hash, n_images):
    fw = features.copy().astype(np.float32)
    fw_hash = checksum(fw)
    diag, keep_idx, dead = compute_diagnostics(fw, feature_names)
    if dead:
        fw = fw[:, keep_idx]
        names_alive = [feature_names[i] for i in keep_idx]
    else:
        names_alive = feature_names
    live_hash = checksum(fw)
    scaler = RobustScaler()
    fs = scaler.fit_transform(fw)
    scaled_hash = checksum(fs)

    n_neigh = min(50, max(15, int(math.sqrt(n))))
    reducer = umap.UMAP(n_components=5, n_neighbors=n_neigh,
                        min_dist=0.05, metric="euclidean", random_state=SEED)
    emb = reducer.fit_transform(fs)
    emb_hash = checksum(emb)

    # Use CONFIG defaults for HDBSCAN parameters
    csr = CONFIG.get("cluster_size_ratio", 0.02)
    msr = CONFIG.get("min_samples_ratio", 0.3)
    mcs = max(5, min(50, int(n * csr)))
    ms = max(3, int(mcs * msr))
    cl = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=ms,
                          metric="euclidean", cluster_selection_method="eom")
    labels = cl.fit_predict(emb)
    labels_hash = checksum(labels.astype(np.int32))

    n_clusters = len([l for l in set(labels) if l >= 0])
    noise_count = int(np.sum(labels == -1))
    noise_rate = noise_count / max(n, 1) * 100
    sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
    lcr = max(sizes) / max(n, 1) if sizes else 0
    sil = compute_quality(emb, labels).get("silhouette_score", 0) or 0

    return {
        "recipe": recipe_label,
        "image_count": n_images,
        "path_checksum": path_hash,
        "feature_shape": list(features.shape),
        "feature_checksum": feat_hash,
        "weighted_checksum": fw_hash,
        "scaled_checksum": scaled_hash,
        "embedding_checksum": emb_hash,
        "labels_checksum": labels_hash,
        "silhouette": round(float(sil), 4),
        "noise_rate": round(noise_rate, 2),
        "n_clusters": n_clusters,
        "largest_cluster_ratio": round(float(lcr), 4),
        "live_features": fw.shape[1],
        "dead_features": dead,
        "selected_features": names_alive,
        "selected_n": len(names_alive),
    }


def main():
    print("=" * 70)
    print("REPRODUCIBILITY AUDIT")
    print("=" * 70)

    # First: compare recipe definitions
    print("\n--- RECIPE COMPARISON ---")
    fg = CONFIG["feature_groups"]
    config_names = get_active_feature_names(fg)
    print(f"Config defaults: {len(config_names)} dims")
    for n in config_names:
        print(f"  {n}")
    print(f"  warm_cool = warm_cool_bias_weighted (index 9, HSV S/V weighted)")

    print(f"\nlegacy_16_like recipe: 16 dims")
    legacy_names = ["brightness_mean","brightness_std","brightness_p10","brightness_p90",
                    "contrast","highlight_threshold","edge_strength_mean","edge_strength_std",
                    "saturation_mean","saturation_std",
                    "light_centroid_x","light_centroid_y","light_spread","light_concentration","light_asymmetry",
                    "legacy_warm_cool_bias"]
    for n in legacy_names:
        print(f"  {n}")
    print(f"  warm_cool = legacy_warm_cool_bias (mean(R-B), unweighted)")

    # Both are 16 dims but use DIFFERENT warm_cool features!
    common = set(config_names) & set(legacy_names)
    only_config = set(config_names) - set(legacy_names)
    only_legacy = set(legacy_names) - set(config_names)
    print(f"\nCommon features: {len(common)}")
    print(f"Only in config: {only_config}")
    print(f"Only in legacy: {only_legacy}")
    print(f"\nKEY FINDING: These ARE different recipes!")
    print(f"  Config uses: warm_cool_bias_weighted")
    print(f"  Legacy uses: legacy_warm_cool_bias (mean(R-B))")
    print(f"  => The validation report RESULTS are from legacy_16_like but")
    print(f"     the CONFIG defaults use warm_cool_bias_weighted")

    # Now run both recipes on each dataset
    print(f"\n{'='*70}")
    print("RUNNING BOTH RECIPES ON EACH DATASET")
    print(f"{'='*70}")

    results = {"comparison": {
        "config_features": config_names,
        "legacy_features": legacy_names,
        "config_warm_cool": "warm_cool_bias_weighted",
        "legacy_warm_cool": "legacy_warm_cool_bias (mean(R-B))",
    }}

    for ds_name, ds_path in DATASETS.items():
        if not Path(ds_path).exists():
            print(f"\n  SKIP {ds_name}: path not found")
            continue
        print(f"\n  {ds_name} ({ds_path})")

        # Run both recipes
        for run_label, run_fn in [("config_default", run_config_default),
                                    ("legacy_16_like", run_legacy_16_like)]:
            for run_i in range(3):
                r = run_fn(ds_path)
                r["recipe"] = f"{run_label}_run{run_i+1}"
                results.setdefault(ds_name, {})[f"{run_label}_run{run_i+1}"] = r
                print(f"    {run_label}_run{run_i+1}: "
                      f"sil={r['silhouette']:.4f} feat_ck={r['feature_checksum']} "
                      f"emb_ck={r['embedding_checksum']} lbl_ck={r['labels_checksum']}")

    # Summary table
    print(f"\n\n{'='*70}")
    print("SUMMARY COMPARISON")
    print(f"{'='*70}")
    print(f"{'Dataset':<25} {'Recipe':<20} {'Sil':>8} {'Cl':>4} {'Noise%':>7} {'LCR':>6} {'FeatCk':>12} {'EmbCk':>12}")
    print(f"{'-'*25} {'-'*20} {'-'*8} {'-'*4} {'-'*7} {'-'*6} {'-'*12} {'-'*12}")

    for ds_name in DATASETS:
        ds_results = results.get(ds_name, {})
        for rname in sorted(ds_results.keys()):
            r = ds_results[rname]
            print(f"{ds_name:<25} {rname:<20} {r['silhouette']:>8.4f} {r['n_clusters']:>4} "
                  f"{r['noise_rate']:>6.1f}% {r['largest_cluster_ratio']:>6.3f} "
                  f"{r['feature_checksum']:>12} {r['embedding_checksum']:>12}")

    # Write results
    out_path = PROJECT_ROOT / "_validation_outputs" / "reproducibility_audit.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nFull results: {out_path}")
    print("Done.")


if __name__ == "__main__":
    main()
