"""Cluster Namer — Group-based 语义标签系统

每个特征组独立输出一个最佳标签。
标签基于全局百分位动态计算，禁止硬编码阈值。

v4.1: warm_cool_bias → warm_cool_bias_weighted
      新增 brightness_skewness, low/high_saturation_ratio, dominant_hue_strength 标签
"""

from typing import Dict, List, Tuple
import numpy as np


# 特征组定义: {组名: {输出标签: [(特征名, 方向, 权重), ...]}}
# 方向: "high" = 特征值高时命中的标签, "low" = 特征值低时命中的标签
GROUP_TAGS = {
    "brightness": {
        "dark":         [("brightness_mean", "low", 2.0), ("brightness_p10", "low", 1.0)],
        "dim":          [("brightness_mean", "low", 1.0), ("brightness_p90", "low", 1.0)],
        "balanced":     [("brightness_mean", "mid", 1.0)],
        "bright":       [("brightness_mean", "high", 1.0), ("brightness_p90", "high", 1.0)],
        "high_key":     [("brightness_mean", "high", 2.0), ("brightness_p10", "high", 1.0)],
        "highlight_pop":[("brightness_skewness", "high", 1.5)],
        "ink_shadow":   [("brightness_skewness", "low", 1.5)],
    },
    "lighting": {
        "flat":         [("contrast", "low", 2.0), ("edge_strength_mean", "low", 1.0)],
        "soft":         [("contrast", "low", 1.0)],
        "dramatic":     [("contrast", "high", 2.0), ("edge_strength_std", "high", 1.0)],
        "harsh":        [("contrast", "high", 1.0), ("edge_strength_mean", "high", 1.5)],
        "specular":     [("highlight_threshold", "high", 2.0)],
    },
    "color": {
        "warm":         [("warm_cool_bias_weighted", "high", 2.0)],
        "cool":         [("warm_cool_bias_weighted", "low", 2.0)],
        "neutral":      [("warm_cool_bias_weighted", "mid", 1.5)],
        "muted":        [("saturation_mean", "low", 1.5), ("low_saturation_ratio", "high", 1.0)],
        "vivid":        [("saturation_mean", "high", 1.5), ("high_saturation_ratio", "high", 1.0)],
        "rich":         [("saturation_mean", "high", 1.5), ("saturation_std", "high", 1.0)],
        "pastel":       [("saturation_mean", "low", 1.5), ("warm_cool_bias_weighted", "mid", 0.5)],
        "mono_tone":    [("dominant_hue_strength", "high", 1.0)],
    },
    "spatial": {
        "center_light":  [("light_centroid_x", "mid", 1.5), ("light_centroid_y", "mid", 1.5)],
        "side_light":    [("light_centroid_x", "high", 1.5), ("light_centroid_y", "mid", 0.5)],
        "left_light":    [("light_centroid_x", "low", 2.0)],
        "right_light":   [("light_centroid_x", "high", 2.0)],
        "top_light":     [("light_centroid_y", "low", 2.0)],
        "bottom_light":  [("light_centroid_y", "high", 2.0)],
        "spotlight":     [("light_concentration", "high", 2.0), ("light_spread", "low", 1.5)],
        "even_light":    [("light_spread", "high", 1.5), ("light_concentration", "low", 1.0)],
        "focused":       [("light_spread", "low", 1.5)],
        "diffuse":       [("light_spread", "high", 1.5)],
    },
    "depth": {
        "flat_depth":       [("depth_variance", "low", 2.0)],
        "layered":          [("depth_variance", "high", 1.5), ("depth_entropy", "high", 1.5)],
        "deep_space":       [("depth_variance", "high", 2.0), ("foreground_background_depth_gap", "high", 1.0)],
        "compressed":       [("foreground_background_depth_gap", "low", 2.0)],
        "foreground_focus": [("depth_variance", "mid", 1.0), ("foreground_background_depth_gap", "high", 1.5)],
    },
}


def _compute_tag_score(cluster_pct: float, direction: str) -> float:
    """计算单个特征对标签的贡献分数

    规则:
      - "high": percentile > 50 时正贡献，越高分越高
      - "low":  percentile < 50 时正贡献，越低分越高
      - "mid":  percentile 在 30~70 之间时正贡献
    """
    if direction == "high":
        return max(0, (cluster_pct - 50) / 50)  # 0~1 范围
    elif direction == "low":
        return max(0, (50 - cluster_pct) / 50)  # 0~1 范围
    elif direction == "mid":
        # 越接近 50 分越高
        return max(0, 1 - abs(cluster_pct - 50) / 30)
    return 0.0


def name_clusters(
    cluster_means: Dict[int, np.ndarray],
    feature_names: List[str],
    global_features: np.ndarray,
) -> Dict[int, Dict]:
    """为所有簇生成 Group-based 语义标签

    返回:
        {cid: {
            "suggested_name": "...",
            "tags": {"组名": {"tag": "...", "confidence": 0.xx, "score": 0.xx}},
            "name_confidence": 0.xx,
            "naming_debug": [{组名, tag, score, percentile, ...}]
        }}
    """
    n = len(feature_names)
    name_map = {name: idx for idx, name in enumerate(feature_names)}
    result = {}

    for cid, cmean in cluster_means.items():
        # 计算所有特征的全局百分位
        percentiles = {}
        for idx, name in enumerate(feature_names):
            col = global_features[:, idx]
            pct = float(np.mean(col < cmean[idx]) * 100)
            percentiles[name] = pct

        # 对每个特征组，计算所有候选标签的分数
        best_tags = []  # [(group, tag, score, confidence)]
        naming_debug = []

        for group_name, tags in GROUP_TAGS.items():
            best_tag = None
            best_score = -1
            best_details = []

            for tag_name, rules in tags.items():
                score = 0.0
                total_weight = 0.0
                details = []

                for feat_name, direction, weight in rules:
                    if feat_name not in percentiles:
                        continue
                    pct = percentiles[feat_name]
                    feat_score = _compute_tag_score(pct, direction)
                    weighted = feat_score * weight
                    score += weighted
                    total_weight += weight
                    details.append({
                        "feature": feat_name,
                        "percentile": round(pct, 1),
                        "direction": direction,
                        "weight": weight,
                        "score": round(weighted, 4),
                    })

                if total_weight > 0:
                    avg_score = score / total_weight
                    if avg_score > best_score:
                        best_score = avg_score
                        best_tag = tag_name
                        best_details = details

            if best_tag and best_score > 0.1:
                confidence = round(min(best_score, 1.0), 4)
                best_tags.append((group_name, best_tag, best_score, confidence))
                naming_debug.append({
                    "group": group_name,
                    "selected_tag": best_tag,
                    "score": round(best_score, 4),
                    "confidence": confidence,
                    "feature_scores": best_details,
                })
            else:
                naming_debug.append({
                    "group": group_name,
                    "selected_tag": None,
                    "score": 0,
                    "confidence": 0,
                    "feature_scores": [],
                })

        # 按 score 排序，取 top 5
        best_tags.sort(key=lambda x: x[2], reverse=True)
        top5 = best_tags[:5]

        # 构建名称
        tag_names = [t[1] for t in top5 if t[2] > 0.15]
        if not tag_names:
            suggested = "balanced"
        else:
            suggested = "_".join(tag_names)

        # 总体置信度
        avg_conf = np.mean([t[3] for t in top5]) if top5 else 0

        result[cid] = {
            "suggested_name": suggested,
            "tags": {
                g: {"tag": t, "confidence": c}
                for g, t, _, c in top5
            },
            "name_confidence": round(float(avg_conf), 4),
            "naming_debug": naming_debug,
        }

    return result
