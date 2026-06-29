"""主流程：拼接特征、标准化、降维、聚类 — Light Analysis Engine v3"""

import logging
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm

from .config import CONFIG
from .preprocess import find_images, preprocess_all
from .feature_extractor import extract_non_depth_batch
from .depth_module import (
    infer_depth_batch,
    extract_depth_features,
    compute_depth_features_from_files,
)
from .coupling_features import compute_coupling_batch, compute_depth_consistency_label

logger = logging.getLogger("LightAnalysisEngine")


def run_pipeline() -> Tuple[np.ndarray, np.ndarray, list, dict]:
    """
    执行完整主流程：
      1. 预处理
      2. 提取 11维 非深度特征
      3. DA3 深度推理 / 从文件加载
      4. 3维 深度特征
      5. 2维 耦合特征
      6. 拼接 16维
      7. StandardScaler
      8. UMAP 降维
      9. HDBSCAN 聚类

    返回:
        features_16d:     原始16维特征 (N x 16)
        labels:           聚类标签 (N,)
        filenames:        文件名列表 (N,)
        report_extra:     额外信息 (深度一致性标签等)
    """
    # ── Step 1: 查找图片 ──
    input_dir = CONFIG["input_folder"]
    image_paths = find_images(input_dir)
    if not image_paths:
        raise RuntimeError(f"没有找到有效图片: {input_dir}")

    # ── Step 2: 预处理 ──
    logger.info("开始预处理...")
    images = preprocess_all(image_paths, max_workers=CONFIG["num_workers"])
    filenames = [name for name, _ in images]

    n = len(images)

    # ── Step 3: 非深度特征 (11维) ──
    logger.info("提取 11维 亮度/光影/色彩特征...")
    feat_nodepth = extract_non_depth_batch(images, max_workers=CONFIG["num_workers"])

    # ── Step 4: 深度特征 (3维) ──
    depth_features = np.zeros((n, 3), dtype=np.float32)
    depth_maps: List[Optional[np.ndarray]] = [None] * n
    depth_consistency_labels = ["unknown"] * n

    if CONFIG["use_depth"]:
        logger.info("提取 DA3 深度特征 (3维)...")

        # 先尝试从已有深度图加载
        file_depth_feat, file_depth_maps, missing = compute_depth_features_from_files(
            input_dir, filenames
        )

        # 填充从文件加载的深度特征
        for i in range(n):
            if file_depth_maps[i] is not None:
                depth_features[i] = file_depth_feat[i]
                depth_maps[i] = file_depth_maps[i]
                hgv = file_depth_feat[i, 2]  # 用 conf 作为代理
                depth_consistency_labels[i] = compute_depth_consistency_label(
                    file_depth_feat[i, 1], hgv, 0.01, 0.5
                )

        if missing:
            logger.info(f"需要 DA3 实时推理 {len(missing)} 张图...")
            missing_indices = [filenames.index(f) for f in missing]
            missing_paths = [str(image_paths[i]) for i in missing_indices]

            # DA3 batch 推理
            new_depths, new_confs = infer_depth_batch(
                missing_paths, batch_size=CONFIG["batch_size"]
            )

            for j, i in enumerate(missing_indices):
                depth_features[i] = extract_depth_features(
                    new_depths[j], new_confs[j]
                )
                depth_maps[i] = new_depths[j]
                depth_consistency_labels[i] = compute_depth_consistency_label(
                    depth_features[i, 1], depth_features[i, 2], 0.01, 0.5
                )
    else:
        logger.info("跳过深度分析 (use_depth=False)")

    # ── Step 5: 耦合特征 (2维) ──
    logger.info("计算亮度-深度耦合特征 (2维)...")
    coupling_feat = compute_coupling_batch(images, depth_maps)

    # ── Step 6: 拼接 16维 ──
    logger.info("拼接 16维 特征向量...")
    features_16d = np.concatenate([feat_nodepth, depth_features, coupling_feat], axis=1)
    logger.info(f"特征矩阵形状: {features_16d.shape}")

    # ── Step 7: StandardScaler ──
    logger.info("StandardScaler 标准化...")
    scaler = StandardScaler()
    features_normalized = scaler.fit_transform(features_16d)

    # ── Step 8: UMAP 降维 ──
    logger.info(f"UMAP 降维 ({CONFIG['umap_dim']}D)...")
    import umap

    # 自适应 n_neighbors：小数据集关注局部，大数据集关注全局
    n = features_normalized.shape[0]
    auto_neighbors = min(50, max(10, int(np.sqrt(n) * 2.5)))
    n_neighbors = CONFIG["umap_neighbors"]
    if n_neighbors == "auto" or n_neighbors < 0:
        n_neighbors = auto_neighbors
    logger.info(f"  n_neighbors={n_neighbors} (n={n})")

    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        min_dist=CONFIG["umap_min_dist"],
        n_components=CONFIG["umap_dim"],
        random_state=CONFIG["umap_random_state"],
        metric=CONFIG["umap_metric"],
    )
    embedding = reducer.fit_transform(features_normalized)
    logger.info(f"  UMAP 嵌入形状: {embedding.shape}")

    # ── Step 9: HDBSCAN 聚类 ──
    # 自适应 min_cluster_size：
    #   - 比例基准: N × 2%
    #   - 下限基准: min(50, N × 5%) — 小数据集自动降低下限
    #   - 取两者较大值，最低不低于 5
    ratio_based = int(n * CONFIG["cluster_size_ratio"])
    floor_based = min(CONFIG["min_cluster_size_base"], int(n * 0.05))
    min_cluster_size = max(floor_based, ratio_based, 5)
    min_samples = max(3, int(min_cluster_size * CONFIG["min_samples_ratio"]))

    logger.info(f"HDBSCAN 聚类 (min_cluster_size={min_cluster_size}, "
                f"min_samples={min_samples})...")
    import hdbscan
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method=CONFIG["cluster_selection_method"],
    )
    labels = clusterer.fit_predict(embedding)

    unique_labels = set(labels)
    n_clusters = len([l for l in unique_labels if l >= 0])
    noise_count = int(np.sum(labels == -1))
    logger.info(f"聚类结果: {n_clusters} 簇, {noise_count} 噪点")

    # ── 收集额外报告信息 ──
    report_extra = {
        "total_images": n,
        "clusters": n_clusters,
        "noise_ratio": round(noise_count / max(n, 1), 4),
        "n_neighbors_used": n_neighbors,
        "noise_count": noise_count,
        "feature_dim": 16,
        "model": "DA3-SMALL",
        "umap_params": {
            "n_neighbors": CONFIG["umap_neighbors"],
            "min_dist": CONFIG["umap_min_dist"],
            "n_components": CONFIG["umap_dim"],
        },
        "hdbscan_params": {
            "min_cluster_size": min_cluster_size,
            "min_samples": min_samples,
        },
        "cluster_info": {},
        "depth_consistency": depth_consistency_labels,
    }

    return features_16d, labels, filenames, report_extra
