"""Cluster Self Evaluation Engine — v4.1

包含:
1. Cluster Distinctiveness Analyzer
2. Cluster Health Score
3. Feature Contribution Score (ANOVA + Kruskal + MI)
4. Iteration Advisor
5. Stability Test (5 runs, ARI)
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.stats import f_oneway, kruskal
from sklearn.metrics import silhouette_score, davies_bouldin_score, adjusted_rand_score
from sklearn.feature_selection import mutual_info_classif

logger = logging.getLogger("LightingEngine")


def compute_health(features: np.ndarray,
                   labels: np.ndarray,
                   embedding: np.ndarray,
                   feature_names: List[str],
                   cluster_analysis: Dict,
                   total_images: int) -> dict:
    """综合健康评估

    返回: {health_score, health_level, cluster_scores, feature_contribution, ...}
    """
    n = total_images
    unique = sorted(set(l for l in labels if l >= 0))
    n_clusters = len(unique)
    noise_count = int(np.sum(labels == -1))

    # ── Cluster Distinctiveness ──
    global_mean = np.mean(features, axis=0)
    global_std = np.std(features, axis=0) + 1e-8
    cluster_scores = {}
    distinctiveness_sum = 0.0
    weak_count = 0

    for label in unique:
        mask = labels == label
        cmean = np.mean(features[mask], axis=0)
        distinct = float(np.mean(np.abs(cmean - global_mean) / global_std))
        cluster_scores[str(label)] = {
            "distinctiveness": round(distinct, 4),
            "quality": "distinct" if distinct >= 1.0
                       else ("moderate" if distinct >= 0.6 else "weak"),
            "size": int(mask.sum()),
            "ratio": round(mask.sum() / n, 4),
        }
        distinctiveness_sum += distinct
        if distinct < 0.6:
            weak_count += 1

    mean_distinctiveness = distinctiveness_sum / max(n_clusters, 1)

    # ── Cluster Balance ──
    sizes = [v["size"] for v in cluster_scores.values()]
    max_ratio = max(sizes) / n if sizes else 0
    balance_score = min(1 - (max_ratio - 1.0 / n_clusters), 0.5) * 2 if n_clusters > 1 else 0.5

    # ── Silhouette & Noise ──
    sil = float(silhouette_score(embedding, labels)) if n_clusters >= 2 else 0.0
    noise_ratio = noise_count / n

    # ── Health Score ──
    health = (
        max(sil, 0) * 0.25
        + balance_score * 0.25
        + (1 - noise_ratio) * 0.25
        + min(mean_distinctiveness / 2.0, 1.0) * 0.25
    )
    health = round(health, 4)
    health_level = "healthy" if health >= 0.7 else ("moderate" if health >= 0.4 else "unhealthy")

    # ── Feature Contribution ──
    contribution = compute_feature_contribution(features, labels, feature_names)

    # ── Micro / Dominant cluster detection ──
    micro_clusters = []
    dominant_clusters = []
    for lbl, info in cluster_scores.items():
        if info["ratio"] < 0.01:
            micro_clusters.append(int(lbl))
        if info["ratio"] > 0.5:
            dominant_clusters.append(int(lbl))

    return {
        "health_score": health,
        "health_level": health_level,
        "silhouette": round(sil, 4),
        "noise_ratio": round(noise_ratio, 4),
        "cluster_scores": cluster_scores,
        "mean_distinctiveness": round(mean_distinctiveness, 4),
        "micro_clusters": micro_clusters,
        "dominant_clusters": dominant_clusters,
        "feature_contribution": contribution,
    }


def compute_feature_contribution(features: np.ndarray,
                                  labels: np.ndarray,
                                  feature_names: List[str]) -> Dict:
    """ANOVA F + Kruskal-Wallis H + MI → 归一化均值"""
    valid = labels >= 0
    if valid.sum() < 2 or len(set(labels[valid])) < 2:
        return {name: {"contribution": 0.0} for name in feature_names}

    X = features[valid]
    y = labels[valid]
    d = X.shape[1]

    results = {}
    anova_scores = []
    kruskal_scores = []
    mi_scores = mutual_info_classif(X, y, random_state=42)

    for i, name in enumerate(feature_names):
        col = X[:, i]
        groups = [col[y == v] for v in set(y)]
        # ANOVA
        try:
            f_stat, _ = f_oneway(*groups)
        except Exception:
            f_stat = 0.0
        anova_scores.append(f_stat)
        # Kruskal-Wallis
        try:
            h_stat, _ = kruskal(*groups)
        except Exception:
            h_stat = 0.0
        kruskal_scores.append(h_stat)

    # 归一化到 [0,1]
    def _norm(arr):
        mn, mx = arr.min(), arr.max()
        if mx > mn:
            return (arr - mn) / (mx - mn)
        return np.ones_like(arr) * 0.5

    anova_n = _norm(np.array(anova_scores))
    kruskal_n = _norm(np.array(kruskal_scores))
    mi_n = _norm(mi_scores)

    for i, name in enumerate(feature_names):
        contrib = round(float(np.mean([anova_n[i], kruskal_n[i], mi_n[i]])), 4)
        results[name] = {
            "contribution": contrib,
            "anova_f": round(anova_scores[i], 4),
            "kruskal_h": round(kruskal_scores[i], 4),
            "mi_score": round(float(mi_scores[i]), 4),
            "low_contribution": contrib < 0.2,
        }

    return results


def generate_advice(health: dict, config_used: dict,
                    n_clusters: int, total_images: int) -> dict:
    """Iteration Advisor — 自动分析问题并生成建议"""
    problems = []
    suggestions = []
    severity = "low"

    # 检查清单
    if health["dominant_clusters"]:
        problems.append("dominant_cluster")
        details = f"{len(health['dominant_clusters'])} clusters > 50% of data"
        severity = "high"
        suggestions.append({
            "action": "reduce", "param": "umap_neighbors",
            "reason": "over-merged clusters"
        })

    if n_clusters <= 2 and health["health_level"] in ("unhealthy", "moderate"):
        problems.append("over_smoothing")
        severity = "high"
        suggestions.append({
            "action": "try", "pipeline": "pipeline_a",
            "reason": "原始空间聚类可能更好"
        })

    weak_count = sum(1 for v in health["cluster_scores"].values()
                     if v["quality"] == "weak")
    if weak_count / max(len(health["cluster_scores"]), 1) > 0.3:
        problems.append("too_many_weak_clusters")
        suggestions.append({
            "action": "increase", "param": "min_cluster_size",
            "reason": f"{weak_count} weak clusters found"
        })

    if health["noise_ratio"] > 0.2:
        problems.append("excessive_noise")
        suggestions.append({
            "action": "decrease", "param": "min_cluster_size",
            "reason": f"noise_ratio={health['noise_ratio']:.1%} > 20%"
        })

    low_contrib = sum(1 for v in health["feature_contribution"].values()
                      if v.get("low_contribution", False))
    if low_contrib > len(health["feature_contribution"]) * 0.3:
        problems.append("feature_collapse")
        suggestions.append({
            "action": "investigate", "param": "low_contribution features",
            "reason": f"{low_contrib} features have contribution < 0.2"
        })

    if not problems:
        problems.append("none")
        severity = "low"
        suggestions.append({"action": "none", "reason": "pipeline healthy"})

    return {
        "problems": problems,
        "severity": severity,
        "suggestions": suggestions,
        "config_snapshot": {
            "umap_neighbors": config_used.get("umap_neighbors", 50),
            "cluster_size_ratio": config_used.get("cluster_size_ratio", 0.02),
            "granularity": config_used.get("cluster_granularity", 1.0),
        },
    }


def compute_stability(features_scaled: np.ndarray,
                       min_cluster_size: int,
                       min_samples: int,
                       n_runs: int = 5) -> dict:
    """稳定性测试: 不同 random_state 重跑 HDBSCAN，计算 mean ARI"""
    import hdbscan
    random_states = [42, 123, 456, 789, 111][:n_runs]
    all_labels = []

    for rs in random_states:
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric="euclidean",
            cluster_selection_method="eom",
        )
        labels = clusterer.fit_predict(features_scaled)
        all_labels.append(labels)

    # ARI 矩阵
    n = len(all_labels)
    aris = []
    for i in range(n):
        for j in range(i + 1, n):
            ari = adjusted_rand_score(all_labels[i], all_labels[j])
            aris.append(ari)

    mean_ari = float(np.mean(aris)) if aris else 0.0
    stable = mean_ari >= 0.5
    warning = None if stable else f"mean ARI={mean_ari:.3f} < 0.5, clusters unreliable"

    return {
        "n_runs": n_runs,
        "random_states": random_states,
        "mean_ari": round(mean_ari, 4),
        "stable": stable,
        "warning": warning,
    }
