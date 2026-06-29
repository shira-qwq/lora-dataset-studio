"""聚类质量评估 — v4"""

import numpy as np
from sklearn.metrics import silhouette_score, davies_bouldin_score


def compute_quality(embedding: np.ndarray, labels: np.ndarray) -> dict:
    """计算聚类质量指标
    返回 {silhouette_score, davies_bouldin_score}
    """
    unique = set(labels)
    n_clusters = len([l for l in unique if l >= 0])

    result = {
        "silhouette_score": None,
        "davies_bouldin_score": None,
    }

    if n_clusters >= 2:
        mask = labels >= 0
        if mask.sum() >= 2:
            result["silhouette_score"] = round(
                float(silhouette_score(embedding[mask], labels[mask])), 4
            )
        if n_clusters >= 2:
            result["davies_bouldin_score"] = round(
                float(davies_bouldin_score(embedding, labels)), 4
            )

    return result
