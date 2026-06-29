"""双路聚类验证 — v4.1

Pipeline A: 原始空间 HDBSCAN (euclidean + cosine)
Pipeline B: UMAP 5D → HDBSCAN
自动选优输出。
"""

import logging
from typing import Tuple

import numpy as np
from sklearn.metrics import silhouette_score, davies_bouldin_score

logger = logging.getLogger("LightingEngine")


def run_dual_comparison(features_raw: np.ndarray,
                         features_scaled: np.ndarray,
                         labels_b: np.ndarray,
                         embedding_5d: np.ndarray,
                         noise_count_b: int,
                         n_clusters_b: int,
                         min_cluster_size: int,
                         min_samples: int) -> dict:
    """运行双路聚类并对比

    返回:
        {
            "pipeline_a": {...},
            "pipeline_b": {...},
            "selected": "pipeline_a" | "pipeline_b",
            "reason": "..."
        }
    """
    import hdbscan

    n = features_scaled.shape[0]

    # ── Pipeline A: 原始空间 HDBSCAN (在原始特征上) ──
    from sklearn.preprocessing import RobustScaler
    # 原始特征仍需要缩放（HDBSCAN对尺度敏感）
    raws = RobustScaler().fit_transform(features_raw)
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels_a = clusterer.fit_predict(raws)
    n_cl_a = len([l for l in set(labels_a) if l >= 0])
    n_noise_a = int(np.sum(labels_a == -1))
    sil_a = float(silhouette_score(raws, labels_a)) if n_cl_a >= 2 else 0.0
    db_a = float(davies_bouldin_score(raws, labels_a)) if n_cl_a >= 2 else 0.0
    score_a = _composite_score(sil_a, n_noise_a / n, n_cl_a, db_a)

    result_a = {
        "silhouette": round(sil_a, 4),
        "davies_bouldin": round(db_a, 4),
        "clusters": n_cl_a,
        "noise_ratio": round(n_noise_a / n, 4),
    }

    # ── Pipeline B: UMAP 5D → HDBSCAN (已有结果) ──
    sil_b = float(silhouette_score(embedding_5d, labels_b)) if n_clusters_b >= 2 else 0.0
    db_b = float(davies_bouldin_score(embedding_5d, labels_b)) if n_clusters_b >= 2 else 0.0
    noise_ratio_b = noise_count_b / n
    score_b = _composite_score(sil_b, noise_ratio_b, n_clusters_b, db_b)

    result_b = {
        "silhouette": round(sil_b, 4),
        "davies_bouldin": round(db_b, 4),
        "clusters": n_clusters_b,
        "noise_ratio": round(noise_ratio_b, 4),
    }

    # ── 选优 ──
    if score_a >= score_b:
        selected = "pipeline_a"
        best_labels = labels_a
        reason = (
            f"pipeline_a (euclidean) score={score_a:.3f} >= "
            f"pipeline_b score={score_b:.3f}"
        )
    else:
        selected = "pipeline_b"
        best_labels = labels_b
        reason = (
            f"pipeline_b score={score_b:.3f} > "
            f"pipeline_a (euclidean) score={score_a:.3f}"
        )

    logger.info(f"双路聚类对比: {reason}")

    return {
        "pipeline_a": result_a,
        "pipeline_b": result_b,
        "selected_pipeline": selected,
        "selected_metric": "euclidean" if selected == "pipeline_a" else "umap_5d",
        "score_a": round(score_a, 3),
        "score_b": round(score_b, 3),
        "reason": reason,
        "_best_labels": best_labels,
    }


def _composite_score(sil: float, noise_ratio: float,
                     n_clusters: int, db: float) -> float:
    """综合评分公式"""
    db_norm = max(0, 1 - db / 5.0) if db > 0 else 0
    cluster_log = np.log(max(n_clusters, 1)) / np.log(50)  # normalize by log(50)
    return (
        sil * 0.3
        + (1 - noise_ratio) * 0.2
        + cluster_log * 0.2
        + db_norm * 0.3
    )
