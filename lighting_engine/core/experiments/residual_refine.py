"""Residual refine experiment: A/B/C comparison.

Reads cached histogram_bank.npz, histogram_summary.csv, quality_edge_summary.csv,
and default clustering outputs. Does NOT read source images.
"""

import hashlib
import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler
from sklearn.metrics import silhouette_score

from lighting_engine.core.feature_diagnostic import compute_diagnostics

# ============================================================
# Constants
# ============================================================

SCALAR_FIELDS_HIST = [
    "histogram_outlier_score", "brightness_dark_ratio", "brightness_bright_ratio",
    "brightness_entropy", "brightness_peak_count", "saturation_low_ratio",
    "saturation_high_ratio", "saturation_entropy", "hue_warm_ratio",
    "hue_cool_ratio", "hue_entropy",
]

SCALAR_FIELDS_QUALITY = [
    "sharpness_score", "edge_density", "edge_strength_p95",
    "local_contrast_p95", "hue_coverage", "grayscale_coverage",
    "lineart_score_v2", "high_contrast_score_v2", "flat_color_score",
]

Z_CLIP = 5.0
EPS = 1e-8


# ============================================================
# Recipe definitions
# ============================================================

RECIPES = {
    "B1": {"mode": "global", "umap_n_neighbors": 30, "umap_min_dist": 0.05,
           "csr": 0.015, "msr": 0.3, "n_components": 5},
    "B2": {"mode": "global", "umap_n_neighbors": 50, "umap_min_dist": 0.05,
           "csr": 0.02, "msr": 0.3, "n_components": 5},
    "B3": {"mode": "global", "umap_n_neighbors": 30, "umap_min_dist": 0.10,
           "csr": 0.02, "msr": 0.5, "n_components": 5},
    "C1": {"mode": "two_stage", "min_refine_size": 30, "max_splits": 4,
           "umap_n_neighbors": 15, "umap_min_dist": 0.05,
           "csr": 0.15, "msr": 0.3},
    "C2": {"mode": "two_stage", "min_refine_size": 40, "max_splits": 4,
           "umap_n_neighbors": 15, "umap_min_dist": 0.05,
           "csr": 0.20, "msr": 0.3},
    "C3": {"mode": "two_stage", "min_refine_size": 30, "max_splits": 4,
           "umap_n_neighbors": 15, "umap_min_dist": 0.05,
           "csr": 0.10, "msr": 0.3, "stricter": True},
    "C_adaptive": {"mode": "adaptive", "adaptive": True},
}


def recipe_hash(name: str, params: dict, matrix_checksum: str) -> str:
    h = hashlib.md5()
    h.update(name.encode())
    h.update(json.dumps(params, sort_keys=True).encode())
    h.update(matrix_checksum.encode())
    return h.hexdigest()[:16]


# ============================================================
# Residual matrix builder
# ============================================================

def load_residual_matrix(job_dir: str) -> Tuple[np.ndarray, List[str], dict, dict]:
    """Load cached files and build residual matrix.

    Returns:
        matrix: (N, D) float32
        col_names: list of column names
        meta: dict with counts
        image_map: dict mapping image_path -> row_index
    """
    job = Path(job_dir)
    ac = job / "analysis_channels"

    # Check required files
    npz_path = ac / "histogram_bank.npz"
    hist_csv = ac / "histogram_summary.csv"
    qe_csv = ac / "quality_edge_summary.csv"

    if not npz_path.exists():
        raise FileNotFoundError(f"Missing: {npz_path}. Run build_histogram_channel.py first.")
    if not hist_csv.exists():
        raise FileNotFoundError(f"Missing: {hist_csv}.")
    if not qe_csv.exists():
        raise FileNotFoundError(f"Missing: {qe_csv}. Run build_quality_edge_channel.py first.")

    # Load NPZ
    npz = np.load(npz_path)
    b_z = npz["brightness_z_residual_16"]
    s_z = npz["saturation_z_residual_16"]
    h_z = npz["hue_z_residual_24"]

    # Clip
    b_z = np.clip(b_z, -Z_CLIP, Z_CLIP)
    s_z = np.clip(s_z, -Z_CLIP, Z_CLIP)
    h_z = np.clip(h_z, -Z_CLIP, Z_CLIP)

    # Load scalar CSVs
    hist_df = pd.read_csv(hist_csv)
    qe_df = pd.read_csv(qe_csv)

    # Build image_path -> row map
    image_paths = list(npz.get("image_paths", [str(p) for p in hist_df.get("image_path", [])]))
    image_map = {p: i for i, p in enumerate(image_paths)}

    # Build column names
    col_names = (
        [f"bz_{i}" for i in range(16)] +
        [f"sz_{i}" for i in range(16)] +
        [f"hz_{i}" for i in range(24)] +
        SCALAR_FIELDS_HIST +
        SCALAR_FIELDS_QUALITY
    )

    # Build matrix
    n = len(image_paths)
    z_dims = 16 + 16 + 24
    scalar_dims = len(SCALAR_FIELDS_HIST) + len(SCALAR_FIELDS_QUALITY)
    matrix = np.zeros((n, z_dims + scalar_dims), dtype=np.float32)
    matrix[:, :16] = b_z
    matrix[:, 16:32] = s_z
    matrix[:, 32:56] = h_z

    # Fill scalar fields
    for i, path in enumerate(image_paths):
        hr = hist_df[hist_df["image_path"] == path]
        if not hr.empty:
            for j, f in enumerate(SCALAR_FIELDS_HIST):
                if f in hr.columns:
                    matrix[i, 56 + j] = float(hr.iloc[0][f])

        qr = qe_df[qe_df["image_path"] == path]
        if not qr.empty:
            for j, f in enumerate(SCALAR_FIELDS_QUALITY):
                if f in qr.columns:
                    matrix[i, 56 + len(SCALAR_FIELDS_HIST) + j] = float(qr.iloc[0][f])

    meta = {"n": n, "z_dims": z_dims, "scalar_dims": scalar_dims, "total_dims": matrix.shape[1]}
    return matrix, col_names, meta, image_map, image_paths


def scale_residual_matrix(matrix: np.ndarray) -> np.ndarray:
    """Scale the residual matrix with RobustScaler."""
    return RobustScaler().fit_transform(matrix).astype(np.float32)


# ============================================================
# Baseline (A): read default labels
# ============================================================

def load_default_labels(job_dir: str, image_paths: List[str]) -> np.ndarray:
    """Read default cluster labels from atlas_points.csv."""
    job = Path(job_dir)
    atlas = job / "atlas_points.csv"
    if not atlas.exists():
        raise FileNotFoundError(f"Missing: {atlas}")
    df = pd.read_csv(atlas)
    if "cluster_id" not in df.columns:
        raise ValueError("atlas_points.csv missing cluster_id column")

    # Build label array matching image_paths order
    label_map = {}
    for _, row in df.iterrows():
        p = row.get("image_path", "")
        if isinstance(p, str) and p:
            label_map[p] = int(row["cluster_id"])

    labels = np.array([label_map.get(p, -1) for p in image_paths], dtype=np.int32)
    return labels


# ============================================================
# Clustering runner
# ============================================================

def run_clustering(matrix: np.ndarray, params: dict, seed: int) -> dict:
    """Run UMAP + HDBSCAN.

    Returns dict with labels, n_clusters, noise_rate, lcr, silhouette.
    """
    import umap
    import hdbscan

    n = matrix.shape[0]
    nn = min(params.get("umap_n_neighbors", 30), max(5, n - 2))

    reducer = umap.UMAP(
        n_components=params.get("n_components", 5),
        n_neighbors=nn,
        min_dist=params.get("umap_min_dist", 0.05),
        metric="euclidean", random_state=seed,
    )
    emb = reducer.fit_transform(matrix)

    csr = params.get("csr", 0.015)
    msr = params.get("msr", 0.3)
    mcs = max(5, min(50, int(n * csr)))
    ms = max(3, int(mcs * msr))

    cl = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=ms,
                          metric="euclidean", cluster_selection_method="eom")
    labels = cl.fit_predict(emb)

    n_clusters = len([l for l in set(labels) if l >= 0])
    noise = int(np.sum(labels == -1))
    noise_rate = noise / max(n, 1)
    sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
    lcr = max(sizes) / max(n, 1) if sizes else 0
    sil = float(silhouette_score(matrix, labels)) if n_clusters >= 2 and noise < n else 0.0

    return {"labels": labels.tolist(), "n_clusters": n_clusters,
            "noise_rate": round(noise_rate, 4), "largest_cluster_ratio": round(lcr, 4),
            "silhouette": round(sil, 4)}


# ============================================================
# Cohesion / Entropy metrics
# ============================================================

def compute_cohesion(matrix: np.ndarray, labels: np.ndarray) -> float:
    """Mean within-cluster distance to centroid."""
    unique = set(l for l in labels if l >= 0)
    if not unique:
        return 0.0
    distances = []
    for label in unique:
        mask = labels == label
        if mask.sum() <= 1:
            continue
        centroid = np.mean(matrix[mask], axis=0)
        dists = np.linalg.norm(matrix[mask] - centroid, axis=1)
        distances.append(float(np.mean(dists)))
    return round(float(np.mean(distances)), 4) if distances else 0.0


def compute_label_entropy(labels: np.ndarray, n_bins: int = 10) -> float:
    """Entropy of label distribution (higher = more balanced)."""
    unique, counts = np.unique(labels[labels >= 0], return_counts=True)
    if len(unique) <= 1:
        return 0.0
    probs = counts / np.sum(counts)
    entropy = -np.sum(probs * np.log2(probs))
    # Normalize by max entropy
    max_entropy = np.log2(min(len(unique), n_bins))
    return round(float(entropy / max_entropy if max_entropy > 0 else 0), 4)


# ============================================================
# Composite score
# ============================================================

def composite_score(metrics: dict, mode: str) -> Tuple[float, bool, str]:
    """Compute composite score and apply elimination rules.

    Returns (score, eliminated, reason).
    """
    nr = metrics.get("noise_rate", 0)
    lcr = metrics.get("largest_cluster_ratio", 0)
    sil = metrics.get("silhouette", 0)
    hc = metrics.get("histogram_cohesion", 0)
    qc = metrics.get("quality_cohesion", 0)
    le = metrics.get("label_entropy", 0)
    changed = metrics.get("changed_image_ratio", 0)

    # Elimination rules
    if nr > 0.35:
        return 0.0, True, f"noise_rate {nr:.2f} > 0.35"
    if lcr > 0.55:
        return 0.0, True, f"largest_cluster_ratio {lcr:.2f} > 0.55"
    if mode.startswith("C") and changed > 0.40:
        return 0.0, True, f"changed_image_ratio {changed:.2f} > 0.40"

    # Normalize components to ~0-1
    sil_score = max(0, min(1, (sil + 0.5) / 1.0))
    hc_score = max(0, min(1, 1.0 - hc * 5))
    qc_score = max(0, min(1, 1.0 - qc * 3))
    le_score = le  # already 0-1 approx
    nr_penalty = max(0, (nr - 0.15) * 2) if nr > 0.15 else 0
    lcr_penalty = max(0, (lcr - 0.30) * 2) if lcr > 0.30 else 0

    score = (0.30 * sil_score + 0.25 * hc_score + 0.15 * qc_score +
             0.15 * le_score - 0.10 * nr_penalty - 0.10 * lcr_penalty)

    return round(max(0, score), 4), False, ""


# ============================================================
# C-stage: two-stage refine
# ============================================================

def refine_two_stage(
    matrix: np.ndarray, image_paths: List[str],
    default_labels: np.ndarray, params: dict, seed: int,
) -> dict:
    """Run two-stage refine: keep default structure, refine large clusters."""
    import umap
    import hdbscan

    default_labels = np.array(default_labels)
    n = len(default_labels)

    min_size = params.get("min_refine_size", 30)
    max_splits = params.get("max_splits", 4)
    stricter = params.get("stricter", False)

    unique_default = sorted(set(l for l in default_labels if l >= 0))
    final_labels = default_labels.copy()
    refine_decisions = []
    next_label = max(unique_default) + 1 if unique_default else 0

    for orig_label in unique_default:
        mask = default_labels == orig_label
        csize = int(np.sum(mask))

        if csize < min_size:
            refine_decisions.append({"cluster": int(orig_label), "size": csize,
                                     "attempted": False, "accepted": False,
                                     "reason": f"size {csize} < min_refine_size {min_size}"})
            continue

        # Subset matrix and run clustering
        sub_m = matrix[mask]
        nn = min(params.get("umap_n_neighbors", 15), max(3, csize - 2))

        reducer = umap.UMAP(n_components=min(5, csize - 1), n_neighbors=nn,
                            min_dist=params.get("umap_min_dist", 0.05),
                            metric="euclidean", random_state=seed)
        emb = reducer.fit_transform(sub_m)

        mcs = max(3, min(50, int(csize * params.get("csr", 0.15))))
        ms = max(2, int(mcs * params.get("msr", 0.3)))
        cl = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=ms,
                              metric="euclidean", cluster_selection_method="eom")
        sub_labels = cl.fit_predict(emb)

        n_sub = len([l for l in set(sub_labels) if l >= 0])
        sub_noise = int(np.sum(sub_labels == -1))
        sub_noise_rate = sub_noise / max(csize, 1)
        sizes = [int(np.sum(sub_labels == l)) for l in set(sub_labels) if l >= 0]
        sub_lcr = max(sizes) / max(csize, 1) if sizes else 0

        # Cohesion before/after
        coh_before = compute_cohesion(sub_m, np.zeros(csize, dtype=np.int32))
        coh_after = compute_cohesion(sub_m, sub_labels)

        # Acceptance gates
        accepted = True
        reason_parts = []
        if n_sub < 2:
            accepted = False; reason_parts.append("subcluster_count < 2")
        if sub_noise_rate > 0.30:
            accepted = False; reason_parts.append(f"noise_rate {sub_noise_rate:.2f} > 0.30")
        if sub_lcr > 0.90:
            accepted = False; reason_parts.append(f"lcr {sub_lcr:.2f} > 0.90")
        if stricter and coh_after >= coh_before * 0.95:
            accepted = False; reason_parts.append("cohesion not improved")

        if accepted:
            # Assign new labels for each subcluster
            for sub_l in set(l for l in sub_labels if l >= 0):
                final_mask = mask.copy()
                final_mask[mask] = (sub_labels == sub_l)
                final_labels[final_mask] = next_label
                next_label += 1
            orig_count = int(np.sum(mask))
            refine_decisions.append({
                "cluster": int(orig_label), "size": csize,
                "attempted": True, "accepted": True,
                "subcluster_count": n_sub,
                "internal_noise_rate": round(sub_noise_rate, 4),
                "largest_subcluster_ratio": round(sub_lcr, 4),
                "cohesion_before": round(coh_before, 4),
                "cohesion_after": round(coh_after, 4),
                "reason": "ok",
            })
        else:
            refine_decisions.append({
                "cluster": int(orig_label), "size": csize,
                "attempted": True, "accepted": False,
                "reason": ";".join(reason_parts),
            })

    # Metrics
    changed = int(np.sum(final_labels != default_labels))
    n_clusters = len([l for l in set(final_labels) if l >= 0])

    return {
        "result": {
            "labels": final_labels.tolist(),
            "n_clusters": n_clusters,
            "changed_count": changed,
            "changed_ratio": round(changed / max(n, 1), 4),
        },
        "refine_decisions": refine_decisions,
    }


# ============================================================
# C_adaptive: size-aware adaptive refine
# ============================================================

import math as _math

def refine_adaptive(
    matrix: np.ndarray, image_paths: List[str],
    default_labels: np.ndarray, params: dict, seed: int,
) -> dict:
    """Size-aware adaptive two-stage refine.

    Parameters are determined by cluster size:
      < 20:   skip
      20-39:  small mode (strict)
      40-99:  medium mode
      100+:   large mode
    """
    import umap
    import hdbscan

    default_labels = np.array(default_labels)
    n = len(default_labels)
    unique_default = sorted(set(l for l in default_labels if l >= 0))
    final_labels = default_labels.copy()
    refine_decisions = []
    next_label = max(unique_default) + 1 if unique_default else 0

    for orig_label in unique_default:
        if orig_label == -1:
            continue  # noise not refined
        mask = default_labels == orig_label
        csize = int(np.sum(mask))

        if csize < 20:
            refine_decisions.append({"cluster": int(orig_label), "size": csize,
                                     "attempted": False, "accepted": False,
                                     "reason": f"size {csize} < 20"})
            continue

        # Size-dependent parameters
        if csize < 40:
            max_splits = 2
            nn = min(8, csize - 2)
            mcs = max(5, int(csize * 0.30))
            ms = max(2, int(mcs * 0.4))
            min_cohesion_gain = 0.08
            max_noise = 0.20
            max_lcr = 0.85
        elif csize < 100:
            max_splits = 3
            nn = min(15, csize - 2)
            mcs = max(8, int(csize * 0.20))
            ms = max(3, int(mcs * 0.3))
            min_cohesion_gain = 0.05
            max_noise = 0.30
            max_lcr = 0.90
        else:
            max_splits = 4
            nn = min(30, int(_math.sqrt(csize) * 3), csize - 2)
            mcs = max(10, int(csize * 0.12))
            ms = max(3, int(mcs * 0.3))
            min_cohesion_gain = 0.05
            max_noise = 0.30
            max_lcr = 0.90

        # Run clustering on subset
        sub_m = matrix[mask]
        reducer = umap.UMAP(n_components=min(5, csize - 1), n_neighbors=nn,
                            min_dist=0.05, metric="euclidean", random_state=seed)
        emb = reducer.fit_transform(sub_m)

        cl = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=ms,
                              metric="euclidean", cluster_selection_method="eom")
        sub_labels = cl.fit_predict(emb)

        n_sub = len([l for l in set(sub_labels) if l >= 0])
        sub_noise = int(np.sum(sub_labels == -1))
        sub_noise_rate = sub_noise / max(csize, 1)
        sizes = [int(np.sum(sub_labels == l)) for l in set(sub_labels) if l >= 0]
        sub_lcr = max(sizes) / max(csize, 1) if sizes else 0

        coh_before = compute_cohesion(sub_m, np.zeros(csize, dtype=np.int32))
        coh_after = compute_cohesion(sub_m, sub_labels)

        # Acceptance gates
        accepted = True
        reasons = []
        if n_sub < 2:
            accepted = False; reasons.append(f"subcluster_count {n_sub} < 2")
        if sub_noise_rate > max_noise:
            accepted = False; reasons.append(f"noise_rate {sub_noise_rate:.2f} > {max_noise}")
        if sub_lcr > max_lcr:
            accepted = False; reasons.append(f"lcr {sub_lcr:.2f} > {max_lcr}")
        if coh_after >= coh_before * (1.0 - min_cohesion_gain):
            accepted = False; reasons.append(f"cohesion {coh_before:.4f}->{coh_after:.4f} gain < {min_cohesion_gain:.0%}")

        if accepted:
            for sub_l in set(l for l in sub_labels if l >= 0):
                fm = mask.copy()
                fm[mask] = (sub_labels == sub_l)
                final_labels[fm] = next_label
                next_label += 1
            refine_decisions.append({
                "cluster": int(orig_label), "size": csize,
                "attempted": True, "accepted": True,
                "subcluster_count": n_sub,
                "internal_noise_rate": round(sub_noise_rate, 4),
                "largest_subcluster_ratio": round(sub_lcr, 4),
                "cohesion_before": round(coh_before, 4),
                "cohesion_after": round(coh_after, 4),
                "reason": "ok",
            })
        else:
            refine_decisions.append({
                "cluster": int(orig_label), "size": csize,
                "attempted": True, "accepted": False,
                "reason": ";".join(reasons),
            })

    changed = int(np.sum(final_labels != default_labels))
    n_clusters = len([l for l in set(final_labels) if l >= 0])
    return {
        "result": {
            "labels": final_labels.tolist(),
            "n_clusters": n_clusters,
            "changed_count": changed,
            "changed_ratio": round(changed / max(n, 1), 4),
        },
        "refine_decisions": refine_decisions,
    }
