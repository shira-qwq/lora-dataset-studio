"""主流程 — v4.3 (低维增强 + 直方图诊断 + 质量 review)

v4.1: 低维特征增强 (brightness_skewness, warm_cool_bias_weighted, 饱和度比例, 主色强度)
v4.2: 直方图形状标签 (high_key/low_key/high_contrast 等, 不参与聚类)
v4.3: Blur + ImageHash 质量 review (不参与聚类)
"""

import logging
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from sklearn.preprocessing import RobustScaler

from .config import CONFIG
from .preprocess import find_images, preprocess_all
from .feature_assembler import assemble_batch, get_active_feature_names, get_cluster_indices, get_explanatory_indices
from .feature_diagnostic import compute_diagnostics, _auto_indices
from .cluster_analyzer import analyze_clusters
from .cluster_comparison import run_dual_comparison
from .redundant_detector import detect_redundant_pairs
from .cluster_health import compute_health, compute_stability, generate_advice
from .feature_reliability import compute_reliability
from .quality_metrics import compute_quality

# v4.2: 直方图诊断
from .diagnostics.histogram_shape import analyze_brightness_histogram

# v4.3: 质量 review
from .quality.blur import compute_blur_score, classify_blur
from .quality.hash_duplicate import compute_hashes, group_near_duplicates

logger = logging.getLogger("LightingEngine")


def _emit_progress(progress_callback, stage: str, progress: float, message: str = "") -> None:
    if progress_callback is None:
        return
    progress_callback(stage, progress, message)


def _build_alive_index_map(total_dims: int, keep_idx: List[int], dead_features: List[str]) -> dict:
    if dead_features:
        return {old_idx: new_idx for new_idx, old_idx in enumerate(keep_idx)}
    return {idx: idx for idx in range(total_dims)}


def _remap_indices(indices: List[int], alive_index_map: dict) -> List[int]:
    return [alive_index_map[idx] for idx in indices if idx in alive_index_map]


def _remap_group_indices(group_indices: dict, alive_index_map: dict) -> dict:
    return {
        name: [alive_index_map[idx] for idx in indices if idx in alive_index_map]
        for name, indices in group_indices.items()
    }


def run_pipeline(input_folders: List[str],
                 output_folder: str,
                 feature_groups: dict = None,
                 progress_callback=None,
                 **kwargs) -> dict:
    cfg = dict(CONFIG)
    if feature_groups is not None:
        cfg["feature_groups"] = feature_groups
    cfg.update(kwargs)

    # ── Step 1: 查找图片 ──
    _emit_progress(progress_callback, "scan", 0.0, f"Scanning: {input_folders}")
    image_paths = find_images(input_folders)
    if not image_paths:
        raise RuntimeError(f"没有找到有效图片: {input_folders}")
    _emit_progress(progress_callback, "scan", 1.0, f"Found {len(image_paths)} images")

    # ── Step 2: 预处理 ──
    logger.info("预处理...")
    _emit_progress(progress_callback, "preprocess", 0.0, "Preprocessing images")
    images = preprocess_all(image_paths, max_workers=cfg["num_workers"])
    filenames = [name for name, _ in images]
    n = len(images)
    _emit_progress(progress_callback, "preprocess", 1.0, f"Preprocessed {n} images")

    # ── Step 3: 特征装配 (无 DA3，所有 depth/coupling/depth_gap 自动跳过) ──
    depth_maps: List[Optional[np.ndarray]] = [None] * n
    conf_maps: List[Optional[np.ndarray]] = [None] * n

    logger.info("装配特征...")
    _emit_progress(progress_callback, "assemble", 0.0, "Assembling features")
    features_raw, sidecars = assemble_batch(
        images, depth_maps, conf_maps,
        cfg["feature_groups"],
        max_workers=cfg["num_workers"],
    )
    feature_names = get_active_feature_names(cfg["feature_groups"])
    _emit_progress(progress_callback, "assemble", 1.0, f"Assembled {len(feature_names)} features")
    logger.info(f"特征矩阵: {features_raw.shape} ({len(feature_names)} 维原始)")

    # ── Step 4: 计算直方图诊断 (v4.2) — 不参与聚类 ──
    logger.info("直方图诊断...")
    _emit_progress(progress_callback, "diagnose", 0.0, "Computing histogram diagnostics")
    image_diagnostics = {}
    for name, img in images:
        # Get L channel for histogram analysis
        lab = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
        L = lab[:, :, 0].astype(np.float32) / 255.0
        image_diagnostics[name] = analyze_brightness_histogram(L)
    _emit_progress(progress_callback, "diagnose", 0.3, "Histogram diagnostics complete")
    logger.info(f"直方图诊断: {len(image_diagnostics)} 张")

    # ── Step 5: 计算质量 metadata (v4.3) — 不参与聚类 ──
    logger.info("质量 review...")
    _emit_progress(progress_callback, "quality", 0.0, "Computing blur and hash")
    quality_report = _compute_quality_report(image_paths)
    _emit_progress(progress_callback, "quality", 1.0, "Quality review complete")
    logger.info(f"质量 review: {len(quality_report.get('images', {}))} 张")

    # ── Step 6: Feature Diagnostic + 死特征检测 + Cluster/Explanatory 拆分 ──
    logger.info("特征诊断...")
    _emit_progress(progress_callback, "diagnose", 0.5, "Diagnosing features")
    diag_report, keep_idx, dead_features = compute_diagnostics(features_raw, feature_names)
    if dead_features:
        logger.warning(f"死特征 (std<1e-5): {dead_features}")
        features_full = features_raw[:, keep_idx]
        feature_names_alive = [feature_names[i] for i in keep_idx]
    else:
        features_full = features_raw
        feature_names_alive = feature_names

    # 拆分为聚类特征和非聚类特征
    alive_index_map = _build_alive_index_map(len(feature_names), keep_idx, dead_features)
    cluster_idx = get_cluster_indices(cfg["feature_groups"])
    explanatory_idx = get_explanatory_indices(cfg["feature_groups"])
    cluster_idx_alive = _remap_indices(cluster_idx, alive_index_map)
    explanatory_idx_alive = _remap_indices(explanatory_idx, alive_index_map)
    features_cluster = features_full[:, cluster_idx_alive]
    feature_names_cluster = [feature_names_alive[i] for i in cluster_idx_alive]
    features_explanatory = features_full[:, explanatory_idx_alive]
    feature_names_explanatory = [feature_names_alive[i] for i in explanatory_idx_alive]
    _emit_progress(progress_callback, "diagnose", 1.0, "Feature diagnosis complete")
    logger.info(f"  聚类: {features_cluster.shape[1]}维, 解释性: {features_explanatory.shape[1]}维")

    # 后面用 features 表示完整特征用于输出和分析
    features = features_full

    # ── Step 7: 固定权重（P1.3：删除 IQR 动态权重，改用 config 中的 weight 字段） ──
    group_idx_original = _auto_indices(features_raw.shape[1], cfg["feature_groups"])
    group_idx = _remap_group_indices(group_idx_original, alive_index_map)
    fixed_weights = {name: g.get("weight", 1.0)
                     for name, g in cfg["feature_groups"].items()
                     if g.get("enabled", False)}
    per_feature_weights = cfg.get("feature_weights") if isinstance(cfg.get("feature_weights"), dict) else {}
    logger.info(f"固定权重: {fixed_weights}")
    if per_feature_weights:
        logger.info(f"run_config feature_weights: {per_feature_weights}")
    features_weighted = _apply_weights(
        features,
        cfg["feature_groups"],
        fixed_weights,
        group_idx,
        feature_names_alive,
        per_feature_weights,
    )

    # 聚类子集也应用相同权重
    features_cluster_weighted = features_weighted[:, cluster_idx_alive]

    # ── Step 8: RobustScaler（在聚类特征上） ──
    logger.info("RobustScaler...")
    scaler = RobustScaler()
    features_scaled = scaler.fit_transform(features_cluster_weighted)

    # ── Step 9: UMAP 5D（HDBSCAN 聚类输入） ──
    n_neighbors = cfg["umap_neighbors"]
    auto_max = min(100, max(15, int(np.sqrt(n))))
    if n_neighbors == "auto" or n_neighbors < 0 or n_neighbors > auto_max:
        n_neighbors = auto_max
    logger.info(f"UMAP n_neighbors={n_neighbors}")

    import umap
    _emit_progress(progress_callback, "umap", 0.0, "Building embeddings")
    logger.info("UMAP 5D (聚类)...")
    reducer_5d = umap.UMAP(
        n_components=cfg.get("umap_n_components_cluster", 5),
        n_neighbors=n_neighbors,
        min_dist=cfg["umap_min_dist"],
        metric=cfg.get("metric", "euclidean"),
        random_state=42,
    )
    embedding_5d = reducer_5d.fit_transform(features_scaled)
    _emit_progress(progress_callback, "umap", 1.0, "Embedding complete")
    logger.info(f"  5D: {embedding_5d.shape}")

    # ── Step 10-16: 迭代聚类 + 自检诊断（最多3轮，在 UMAP 5D 上） ──
    import hdbscan
    _emit_progress(progress_callback, "cluster", 0.0, "Clustering")
    granularity = cfg.get("cluster_granularity", 1.0)
    best_labels = None
    best_sil = -1
    rerun_count = 0

    for iteration in range(3):
        explicit_mcs = cfg.get("min_cluster_size")
        explicit_ms = cfg.get("min_samples")
        if explicit_mcs is not None:
            mcs = max(2, int(explicit_mcs))
        else:
            ratio_based = max(3, int(n * cfg["cluster_size_ratio"] * granularity))
            floor_based = min(50, int(n * 0.05))
            mcs = max(floor_based, ratio_based, 5)
        if explicit_ms is not None:
            ms = max(1, int(explicit_ms))
        else:
            ms = max(3, int(mcs * cfg["min_samples_ratio"]))
        cluster_selection_method = cfg.get("cluster_selection_method", "eom")
        logger.info(f"HDBSCAN 迭代{iteration+1}: min_cluster_size={mcs}, min_samples={ms}")

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=mcs, min_samples=ms,
            metric="euclidean", cluster_selection_method=cluster_selection_method,
        )
        labels = clusterer.fit_predict(embedding_5d)
        n_clusters = len([l for l in set(labels) if l >= 0])
        noise_count = int(np.sum(labels == -1))
        sil = float(compute_quality(embedding_5d, labels).get("silhouette_score", 0) or 0)

        if sil > best_sil:
            best_sil = sil
            best_labels = labels.copy()

        logger.info(f"  → {n_clusters} 簇, {noise_count} 噪点, Silhouette={sil:.4f}")

        # ── 自检诊断 ──
        sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
        max_ratio = max(sizes) / n if sizes else 0
        weak_count = sum(1 for s in sizes if s < n * 0.02)

        problems = []
        if max_ratio > 0.5:
            problems.append("dominant_cluster")
        if n_clusters <= 2 and sil < 0.3:
            problems.append("over_smoothing")
        if weak_count / max(n_clusters, 1) > 0.3 and n_clusters > 2:
            problems.append("too_many_weak")

        if not problems or iteration >= 2:
            logger.info(f"  自检: {'、'.join(problems) if problems else '健康'}, 停止迭代")
            break

        # 调整参数
        if "dominant_cluster" in problems:
            granularity = min(granularity * 1.3, 2.0)
        if "too_many_weak" in problems or "over_smoothing" in problems:
            mcs = max(mcs - 3, 5)
        rerun_count += 1

    labels = best_labels
    n_clusters = len([l for l in set(labels) if l >= 0])
    noise_count = int(np.sum(labels == -1))

    # ── 质量评估（在聚类输入 embedding_5d 上） ──
    quality = compute_quality(embedding_5d, labels)
    logger.info(f"最终: {n_clusters} 簇, {noise_count} 噪点, Silhouette={quality.get('silhouette_score', 'N/A')}")

    # ── Step 9b: UMAP 3D post-hoc 可视化（仅渲染器输入，独立于聚类 UMAP 5D） ──
    logger.info(f"UMAP 3D 可视化 (n_neighbors={n_neighbors})...")
    reducer_3d = umap.UMAP(
        n_components=cfg.get("umap_n_components_viz", 3),
        n_neighbors=n_neighbors,
        min_dist=cfg["umap_min_dist"],
        metric=cfg.get("metric", "euclidean"),
        random_state=42,
    )
    embedding_3d = reducer_3d.fit_transform(features_scaled)
    logger.info(f"  3D: {embedding_3d.shape}")

    # ── 特征重要性 + 语义分析 ──
    feature_importance = _compute_feature_importance(
        features_weighted, labels, feature_names_alive)
    cluster_means = {}
    for label in sorted(set(l for l in labels if l >= 0)):
        mask = labels == label
        cluster_means[label] = np.mean(features_weighted[mask], axis=0)
    cluster_analysis = analyze_clusters(
        cluster_means, feature_names_alive, features_weighted, top_k=5)
    _emit_progress(progress_callback, "name", 1.0, "Cluster naming analysis complete")

    # ── 可靠性 + 诊断 ──
    reliability = compute_reliability(
        features, feature_names_alive, labels=labels, group_map=group_idx)
    diag_report_full, _, _ = compute_diagnostics(features, feature_names_alive, labels=labels)

    # ── 特征相关性 ──
    corr_matrix = np.corrcoef(features_weighted.T)
    feature_corr = {"names": feature_names_alive, "matrix": corr_matrix.tolist()}

    # ── 双路聚类对比 ──
    logger.info("双路聚类对比...")
    comparison = run_dual_comparison(
        features_cluster_weighted, features_scaled, labels, embedding_5d,
        noise_count, n_clusters,
        mcs, ms,
    )

    # ── 特征冗余检测 ──
    logger.info("特征冗余检测...")
    redundant_pairs = detect_redundant_pairs(features_weighted, feature_names_alive)

    # ── Cluster Health Evaluation（embedding 参数传 embedding_5d） ──
    logger.info("聚类健康评估...")
    health = compute_health(
        features_weighted, labels, embedding_5d,
        feature_names_alive, cluster_analysis, n)

    # ── 稳定性测试 ──
    logger.info("聚类稳定性测试...")
    stability = compute_stability(features_scaled, mcs, ms)

    # ── 优化建议 ──
    advice = generate_advice(health, cfg, n_clusters, n)

    # If dual comparison selects pipeline A, adopt its labels.
    if comparison["selected_pipeline"] == "pipeline_a":
        labels = comparison["_best_labels"]
        n_clusters = len([l for l in set(labels) if l >= 0])
        noise_count = int(np.sum(labels == -1))
        logger.info(f"  Adopted Pipeline A: {n_clusters} clusters, {noise_count} noise")
    _emit_progress(progress_callback, "cluster", 1.0, f"Created {n_clusters} clusters")
    del comparison["_best_labels"]
    # ── 组装结果 ──
    result = {
        "image_paths": image_paths,
        "filenames": filenames,
        "features": features,
        "feature_names": feature_names_alive,
        "features_cluster": features_cluster_weighted,
        "features_explanatory": features_explanatory,
        "feature_names_cluster": feature_names_cluster,
        "feature_names_explanatory": feature_names_explanatory,
        "embedding_5d": embedding_5d,
        "embedding_3d": embedding_3d,
        "labels": labels,
        "n_clusters": n_clusters,
        "noise_count": noise_count,
        "quality": quality,
        "sidecars": sidecars,
        "feature_weights": per_feature_weights or {
            name: 1.0 for name in feature_names_alive
        },
        "group_weights": fixed_weights,
        "diagnostic_report": diag_report_full,
        "dead_features": dead_features,
        "feature_importance": feature_importance,
        "feature_corr": feature_corr,
        "cluster_analysis": cluster_analysis,
        "feature_reliability": reliability,
        "clustering_comparison": comparison,
        "redundant_features": redundant_pairs,
        "cluster_health": health,
        "cluster_stability": stability,
        "iteration_advice": advice,
        # v4.2: 直方图诊断 (不参与聚类)
        "image_diagnostics": image_diagnostics,
        # v4.3: 质量 review (不参与聚类)
        "quality_report": quality_report,
        "config_used": {
            "input_folders": input_folders,
            "output_folder": output_folder,
            "feature_groups": cfg["feature_groups"],
            "umap_neighbors": n_neighbors,
            "metric": cfg.get("metric", "euclidean"),
            "cluster_size_ratio": cfg["cluster_size_ratio"],
            "cluster_granularity": granularity,
            "min_cluster_size": mcs,
            "min_samples": ms,
            "cluster_selection_method": cfg.get("cluster_selection_method", "eom"),
            "feature_weights": per_feature_weights or {
                name: 1.0 for name in feature_names_alive
            },
            "group_weights": fixed_weights,
            "dead_features": dead_features,
            "rerun_count": rerun_count,
        },
        "plotly_mode": cfg.get("plotly_mode", "3d"),
        "plotly_show_thumbnails": cfg.get("plotly_show_thumbnails", False),
    }

    # ── 写产物 (默认写核心文件，extras=False) ──
    from .output_writer import write_all
    _emit_progress(progress_callback, "output", 0.0, "Writing outputs")
    logger.info("写产物...")
    try:
        new_structure = cfg.get("new_structure", False)
        write_all(output_folder, result, write_extras=False, new_structure=new_structure)
        logger.info(f"全部输出已写入: {output_folder}")
    except Exception as e:
        logger.error(f"写产物失败: {e}")
        # 不影响主流程

    _emit_progress(progress_callback, "output", 1.0, "Outputs written")
    return result


def _compute_quality_report(image_paths: List[Path]) -> dict:
    """Compute blur scores and image hashes for quality review.

    Returns dict with format:
    {
        "images": {
            "filename.webp": {
                "blur_score": 42.3,
                "blur_label": "ok" | "review_blurry",
                "phash": "ff00aa...",
                "duplicate_group_id": "dup_0001" or None,
                "is_near_duplicate": true/false
            }
        },
        "summary": {
            "blurry_count": 12,
            "duplicate_group_count": 5,
            "duplicate_image_count": 17
        }
    }
    """
    # Compute blur scores for all images
    blur_scores = {}
    blur_labels = {}
    paths = [Path(p) if not isinstance(p, Path) else p for p in image_paths]
    for path in paths:
        try:
            img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                blur_scores[path.name] = 0.0
                blur_labels[path.name] = "ok"
            else:
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
                score = compute_blur_score(img_rgb)
                blur_scores[path.name] = score
                blur_labels[path.name] = classify_blur(score)
        except Exception:
            blur_scores[path.name] = 0.0
            blur_labels[path.name] = "ok"

    # Compute hashes
    hash_map = compute_hashes(paths)
    dup_groups = group_near_duplicates(hash_map)

    # Build per-image entries
    images_report = {}
    for path in paths:
        pname = path.name
        entry = {
            "blur_score": round(blur_scores.get(pname, 0.0), 2),
            "blur_label": blur_labels.get(pname, "ok"),
            "phash": hash_map.get(str(path), ""),
            "duplicate_group_id": None,
            "is_near_duplicate": False,
        }
        # Merge duplicate info
        dup_info = dup_groups.get(str(path))
        if dup_info:
            entry["duplicate_group_id"] = dup_info["duplicate_group_id"]
            entry["is_near_duplicate"] = dup_info["is_near_duplicate"]
            # Also add group size
            entry["duplicate_group_size"] = dup_info.get("duplicate_group_size", 1)
        images_report[pname] = entry

    # Summary
    blurry_count = sum(1 for v in images_report.values() if v["blur_label"] == "review_blurry")
    dup_ids = set(v["duplicate_group_id"] for v in images_report.values() if v["duplicate_group_id"])
    dup_img_count = sum(1 for v in images_report.values() if v["is_near_duplicate"])

    return {
        "images": images_report,
        "summary": {
            "blurry_count": blurry_count,
            "duplicate_group_count": len(dup_ids),
            "duplicate_image_count": dup_img_count,
        },
    }


def _apply_weights(features: np.ndarray,
                   feature_groups: dict,
                   weights: dict,
                   group_indices: dict = None,
                   feature_names: List[str] = None,
                   feature_weights: dict = None) -> np.ndarray:
    if group_indices is None:
        group_indices = _auto_indices(features.shape[1], feature_groups)
    result = features.copy()
    for name, indices in group_indices.items():
        w = weights.get(name, 1.0)
        for idx in indices:
            if idx < features.shape[1]:
                result[:, idx] *= w
    if feature_names and feature_weights:
        for idx, feature_name in enumerate(feature_names):
            if idx < result.shape[1] and feature_name in feature_weights:
                try:
                    result[:, idx] *= float(feature_weights[feature_name])
                except (TypeError, ValueError):
                    logger.warning("Invalid feature weight for %s: %r", feature_name, feature_weights[feature_name])
    return result


def _compute_feature_importance(features: np.ndarray,
                                 labels: np.ndarray,
                                 feature_names: List[str]) -> dict:
    unique = sorted(set(l for l in labels if l >= 0))
    global_mean = np.mean(features, axis=0)
    global_std = np.std(features, axis=0) + 1e-8
    result = {}
    for label in unique:
        mask = labels == label
        cluster_mean = np.mean(features[mask], axis=0)
        deviation = np.abs(cluster_mean - global_mean) / global_std
        top_idx = np.argsort(deviation)[::-1][:5]
        result[str(label)] = [
            {"feature": feature_names[i],
             "deviation": float(deviation[i]),
             "cluster_mean": float(cluster_mean[i]),
             "global_mean": float(global_mean[i])}
            for i in top_idx
        ]
    return result
