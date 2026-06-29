"""Cluster Semantic Analyzer — v4.1（Group-based 语义标签）

使用 Group-based 标签系统完成命名。
保留 z-score / percentile 分析用于 dominant_features。
"""

from typing import Dict, List
import numpy as np

from .cluster_namer import name_clusters


def analyze_clusters(
    cluster_means: Dict[int, np.ndarray],
    feature_names: List[str],
    global_features: np.ndarray,
    top_k: int = 3,
) -> Dict[int, Dict]:
    """分析所有簇 → Group-based 标签 + 区分特征"""
    n = len(feature_names)
    global_mean = np.mean(global_features, axis=0)
    global_std = np.std(global_features, axis=0) + 1e-8

    dna_result = name_clusters(cluster_means, feature_names, global_features)

    result = {}
    for cid, cmean in cluster_means.items():
        zscores = []
        percentiles = {}

        for idx, name in enumerate(feature_names):
            col = global_features[:, idx]
            pct = float(np.mean(col < cmean[idx]) * 100)
            percentiles[name] = round(pct, 1)
            z = float((cmean[idx] - global_mean[idx]) / global_std[idx])
            zscores.append((name, abs(z), z, pct))

        zscores.sort(key=lambda x: x[1], reverse=True)
        dominant = [
            {"feature": name, "z_score": round(z, 3), "direction": "pos" if z > 0 else "neg"}
            for name, _, z, _ in zscores[:top_k]
        ]

        distinctiveness = float(np.mean([
            abs(cmean[idx] - global_mean[idx]) / global_std[idx]
            for idx in range(n)
        ]))

        entry = dna_result.get(cid, {})
        entry.update({
            "dominant_features": dominant,
            "percentiles": percentiles,
            "distinctiveness_score": round(distinctiveness, 4),
            "quality": "distinct" if distinctiveness >= 1.0
                       else ("moderate" if distinctiveness >= 0.6 else "weak"),
        })
        result[cid] = entry

    return result
