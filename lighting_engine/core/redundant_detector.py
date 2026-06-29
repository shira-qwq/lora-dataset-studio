"""特征冗余检测 — v4.1

计算相关矩阵，检测 |corr| > 0.95 的特征对。
仅告警，不自动删除。
"""

import numpy as np
from typing import List, Tuple


def detect_redundant_pairs(features: np.ndarray,
                            feature_names: List[str],
                            threshold: float = 0.95) -> List[dict]:
    """检测高度相关的特征对

    返回:
        [{feature_a, feature_b, correlation}, ...]
    """
    corr = np.corrcoef(features.T)
    n = len(feature_names)
    pairs = []

    for i in range(n):
        for j in range(i + 1, n):
            r = corr[i, j]
            if abs(r) >= threshold:
                pairs.append({
                    "feature_a": feature_names[i],
                    "feature_b": feature_names[j],
                    "correlation": round(float(r), 4),
                })

    # 按 |corr| 降序
    pairs.sort(key=lambda x: abs(x["correlation"]), reverse=True)
    return pairs
