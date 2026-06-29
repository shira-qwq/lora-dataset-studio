"""Feature Diagnostic — 特征诊断 + MI 排序 — v5"""

import numpy as np
from typing import Dict, List, Tuple, Optional
from sklearn.feature_selection import mutual_info_classif


def compute_diagnostics(features: np.ndarray,
                        feature_names: List[str],
                        labels: Optional[np.ndarray] = None,
                        use_iqr_dead: bool = True) -> Tuple[Dict, List[int], List[str]]:
    """计算每个维度的诊断统计量，检测死特征

    死特征条件 (v4.1):
      预聚类: IQR < P10(所有IQR)
      后聚类: IQR < P10(IQR) 且 MI < P10(MI)

    返回:
        report: {特征名: {mean, std, iqr, variance, is_dead, mi_score, dead_reason}}
        keep_indices: 保留的列索引
        dead_features: 死特征列表
    """
    report = {}
    keep_indices = []
    dead_features = []

    n_dims = features.shape[1]

    # 第一步: 计算所有 IQR
    iqrs = []
    for idx in range(n_dims):
        col = features[:, idx]
        q25 = float(np.percentile(col, 25))
        q75 = float(np.percentile(col, 75))
        iqrs.append(q75 - q25)
    iqr_threshold = float(np.percentile(iqrs, 10)) if n_dims >= 5 else 0.0

    # 计算 MI 分数（如果 labels 提供）
    mi_scores = None
    mi_threshold = 0.0
    if labels is not None:
        valid = labels >= 0
        if valid.sum() >= 2 and len(set(labels[valid])) >= 2:
            mi_scores = mutual_info_classif(features[valid], labels[valid], random_state=42)
            mi_threshold = float(np.percentile(mi_scores, 10)) if len(mi_scores) >= 5 else 0.0

    for idx, name in enumerate(feature_names):
        col = features[:, idx]
        mean = float(np.mean(col))
        std = float(np.std(col))
        q25 = float(np.percentile(col, 25))
        q75 = float(np.percentile(col, 75))
        iqr = q75 - q25
        variance = float(np.var(col))

        mi = float(mi_scores[idx]) if mi_scores is not None and idx < len(mi_scores) else 0.0

        # 死特征判定
        is_dead = False
        dead_reason = None

        if use_iqr_dead and n_dims >= 5:
            if iqr < iqr_threshold:
                if labels is not None and mi_scores is not None:
                    if mi < mi_threshold:
                        is_dead = True
                        dead_reason = f"IQR={iqr:.6f}<P10({iqr_threshold:.6f}) AND MI={mi:.6f}<P10({mi_threshold:.6f})"
                    else:
                        dead_reason = f"low_iqr: IQR={iqr:.6f}<P10({iqr_threshold:.6f}) but MI={mi:.6f} OK"
                else:
                    # 预聚类: 仅IQR检测
                    is_dead = True
                    dead_reason = f"IQR={iqr:.6f}<P10({iqr_threshold:.6f})"

        entry = {
            "mean": round(mean, 6),
            "std": round(std, 6),
            "iqr": round(iqr, 6),
            "variance": round(variance, 6),
            "is_dead": is_dead,
            "dead_reason": dead_reason,
            "mi_score": round(mi, 6) if mi_scores is not None else None,
        }

        report[name] = entry

        if is_dead:
            dead_features.append(name)
        else:
            keep_indices.append(idx)

    return report, keep_indices, dead_features


def compute_importance_ranking(diag_report: Dict[str, Dict]) -> Dict:
    """按 IQR / Variance / MI Score 排序输出特征重要性排名"""
    alive = {k: v for k, v in diag_report.items() if not v["is_dead"]}

    # 按 IQR 排序
    by_iqr = sorted(alive.items(), key=lambda x: x[1]["iqr"], reverse=True)
    # 按 Variance 排序
    by_var = sorted(alive.items(), key=lambda x: x[1]["variance"], reverse=True)
    # 按 MI Score 排序（排除 None）
    by_mi = sorted(
        [(k, v) for k, v in alive.items() if v["mi_score"] is not None],
        key=lambda x: x[1]["mi_score"], reverse=True
    )

    return {
        "ranking_by_iqr": [{"feature": k, "iqr": v["iqr"]} for k, v in by_iqr],
        "ranking_by_variance": [{"feature": k, "variance": v["variance"]} for k, v in by_var],
        "ranking_by_mutual_info": [{"feature": k, "mi_score": v["mi_score"]} for k, v in by_mi],
        "dead_features": [k for k, v in diag_report.items() if v["is_dead"]],
    }


def _auto_indices(total_dims: int,
                  feature_groups: Dict) -> Dict[str, List[int]]:
    """按 feature_groups 迭代顺序 + dims 累加列号，得到 {组名: [列索引]}。

    约定: 所有组（含 depth）一律用 config 中的 `dims` 作为该组实际列数。
    depth 组 dims=2（匹配 feature_assembler.assemble 对 depth 的 feat[:2] 切片
    与 compute_iqr_weights 的 depth=2 假设）。旧 dynamic_weights._auto_indices
    把 depth 特殊化为 1 维 —— 那是 P0 bug 的根因，已统一消除。
    """
    indices: Dict[str, List[int]] = {}
    col = 0
    for name, group in feature_groups.items():
        if group.get("enabled", False):
            dims = int(group.get("dims", 2))
            indices[name] = list(range(col, col + dims))
            col += dims
    return indices


def compute_iqr_weights(features: np.ndarray,
                        feature_groups: Dict,
                        group_indices: Dict[str, List[int]]) -> Dict[str, float]:
    """基于 IQR 计算动态权重

    weight = clamp(raw_iqr_ratio × base_weight, 0.5, 2.0)
    不归一化。
    """
    group_iqrs = {}
    for name, indices in group_indices.items():
        if not feature_groups.get(name, {}).get("enabled", False):
            continue
        total_iqr = 0.0
        count = 0
        for idx in indices:
            if idx < features.shape[1]:
                col = features[:, idx]
                q25, q75 = np.percentile(col, [25, 75])
                total_iqr += (q75 - q25)
                count += 1
        group_iqrs[name] = max(total_iqr / max(count, 1), 1e-10)

    if not group_iqrs:
        return {}

    mean_iqr = sum(group_iqrs.values()) / len(group_iqrs)

    weights = {}
    for name, iqr in group_iqrs.items():
        raw = iqr / mean_iqr if mean_iqr > 0 else 1.0
        base = feature_groups.get(name, {}).get("weight", 1.0)
        w = raw * base
        weights[name] = round(float(np.clip(w, 0.5, 2.0)), 4)

    return weights
