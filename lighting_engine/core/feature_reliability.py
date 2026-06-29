"""Feature Reliability System — 数据驱动的特征可靠性评分 — v5

每个特征的最终权重 = base_weight × reliability_score
reliability_score = normalize(MI) × normalize(IQR)
"""

from typing import Dict, List, Optional
import numpy as np
from sklearn.feature_selection import mutual_info_classif


def compute_reliability(features: np.ndarray,
                         feature_names: List[str],
                         labels: Optional[np.ndarray] = None,
                         group_map: Optional[Dict[str, List[int]]] = None) -> Dict:
    """计算每个特征的可靠性评分

    参数:
        features: [N, D] 特征矩阵
        feature_names: D 个特征名
        labels: 聚类标签（可选，用于 MI 计算）
        group_map: {组名: [列索引]}（可选，用于组级聚合）

    返回:
        {
            "per_feature": {特征名: {mi_score, iqr, variance, entropy, reliability}},
            "per_group": {组名: reliability_score},
            "dead_features": [...]
        }
    """
    n, d = features.shape
    per_feature = {}
    mi_scores = None

    # MI 分数（需要 labels）
    if labels is not None:
        valid = labels >= 0
        if valid.sum() >= 2 and len(set(labels[valid])) >= 2:
            mi_scores = mutual_info_classif(features[valid], labels[valid], random_state=42)

    # 计算每个特征的统计量
    mi_list = []
    iqr_list = []

    for idx, name in enumerate(feature_names):
        col = features[:, idx]
        std = float(np.std(col))
        q25, q75 = np.percentile(col, [25, 75])
        iqr = float(q75 - q25)
        variance = float(np.var(col))

        # 熵（离散化后计算）
        n_bins = min(50, n // 10 + 1)
        hist, _ = np.histogram(col, bins=n_bins)
        prob = hist / n
        entropy = float(-np.sum(prob * np.log(prob + 1e-10)))

        # MI
        mi = float(mi_scores[idx]) if mi_scores is not None and idx < len(mi_scores) else 0.0

        is_dead = std < 1e-5

        # 可靠性 = normalize(MI) × normalize(IQR)
        # 暂时存储原始值，归一化在所有特征统计完成后进行
        per_feature[name] = {
            "mi_score": round(mi, 6),
            "iqr": round(iqr, 6),
            "variance": round(variance, 6),
            "entropy": round(entropy, 6),
            "std": round(std, 6),
            "is_dead": is_dead,
            "reliability": 0.0,  # 暂存
        }
        mi_list.append(mi)
        iqr_list.append(iqr)

    # 归一化 MI 和 IQR
    mi_arr = np.array(mi_list)
    iqr_arr = np.array(iqr_list)

    def _normalize(arr):
        mn, mx = arr.min(), arr.max()
        if mx > mn:
            return (arr - mn) / (mx - mn)
        return np.ones_like(arr) * 0.5

    mi_norm = _normalize(mi_arr)
    iqr_norm = _normalize(iqr_arr)

    dead_list = []
    for idx, name in enumerate(feature_names):
        reliability = float(mi_norm[idx] * iqr_norm[idx])
        per_feature[name]["reliability"] = round(reliability, 4)
        if per_feature[name]["is_dead"]:
            dead_list.append(name)

    # 组级聚合
    per_group = {}
    if group_map:
        for gname, indices in group_map.items():
            scores = []
            for idx in indices:
                if idx < len(feature_names):
                    scores.append(per_feature[feature_names[idx]]["reliability"])
            per_group[gname] = round(float(np.mean(scores)), 4) if scores else 0.0

    # 计算最终权重: base_weight × reliability (归一化到均值1.0)
    final_weights = {}
    if group_map:
        vals = np.array(list(per_group.values()))
        mn, mx = vals.min(), vals.max()
        for gname, rel in per_group.items():
            # 归一化 reliability 到 [0.5, 1.5]
            if mx > mn:
                normed = 0.5 + (rel - mn) / (mx - mn) * 1.0
            else:
                normed = 1.0
            final_weights[gname] = round(float(normed), 4)

    return {
        "per_feature": per_feature,
        "per_group": per_group,
        "final_weights": final_weights,
        "dead_features": dead_list,
    }
