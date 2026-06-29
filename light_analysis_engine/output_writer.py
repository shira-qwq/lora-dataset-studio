"""输出模块 — 写 CSV、JSON、复制图片、缩略图 — Light Analysis Engine v3"""

import json
import logging
import shutil
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import pandas as pd
from matplotlib import pyplot as plt

from .config import CONFIG

logger = logging.getLogger("LightAnalysisEngine")

# 特征列名
FEATURE_NAMES = [
    "brightness_mean",
    "brightness_std",
    "brightness_p10",
    "brightness_p90",
    "contrast",
    "shadow_ratio",
    "highlight_ratio",
    "hard_edge_ratio",
    "warm_cool_bias",
    "saturation_mean",
    "saturation_std",
    "depth_mean",
    "depth_variance",
    "depth_confidence_mean",
    "depth_lighting_corr",
    "high_gradient_depth_var",
]


def ensure_output_dirs(output_folder: str):
    """创建输出目录结构"""
    root = Path(output_folder)
    root.mkdir(parents=True, exist_ok=True)
    (root / "clusters").mkdir(exist_ok=True)
    return root


def write_features_csv(
    output_folder: str,
    features: np.ndarray,
    labels: np.ndarray,
    filenames: List[str],
):
    """写入 features.csv"""
    df = pd.DataFrame(features, columns=FEATURE_NAMES)
    df.insert(0, "filename", filenames)
    df["cluster_id"] = labels
    out_path = Path(output_folder) / "features.csv"
    df.to_csv(out_path, index=False)
    logger.info(f"写入 features.csv: {out_path} ({len(df)} 行)")


def copy_images_to_clusters(
    output_folder: str,
    image_paths: List[Path],
    filenames: List[str],
    labels: np.ndarray,
):
    """按聚类复制图片到 clusters/ 子目录"""
    root = Path(output_folder) / "clusters"
    name_to_path = {p.name: p for p in image_paths}

    for fname, label in zip(filenames, labels):
        if label == -1:
            cluster_dir = root / "noise"
        else:
            cluster_dir = root / f"cluster_{label}"
        cluster_dir.mkdir(exist_ok=True)

        src = name_to_path.get(fname)
        if src and src.exists():
            dst = cluster_dir / fname
            if not dst.exists():
                shutil.copy2(str(src), str(dst))

    logger.info(f"图片复制完成到 {root}")


def write_cluster_preview(
    output_folder: str,
    filenames: List[str],
    labels: np.ndarray,
):
    """写入 cluster_preview.json"""
    clusters: Dict[str, Dict] = {}
    for fname, label in zip(filenames, labels):
        key = f"cluster_{label}" if label >= 0 else "noise"
        if key not in clusters:
            clusters[key] = {"count": 0, "examples": []}
        clusters[key]["count"] += 1
        if len(clusters[key]["examples"]) < 3:
            clusters[key]["examples"].append(fname)

    out_path = Path(output_folder) / "cluster_preview.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(clusters, f, indent=2, ensure_ascii=False)
    logger.info(f"写入 cluster_preview.json")


def write_cluster_summary(
    output_folder: str,
    features: np.ndarray,
    labels: np.ndarray,
    filenames: List[str],
):
    """写入 cluster_summary.json — 每簇特征均值/标准差"""
    root = Path(output_folder)
    unique_labels = sorted(set(labels))

    summary = {}
    for label in unique_labels:
        mask = labels == label
        key = "noise" if label == -1 else f"cluster_{label}"
        cluster_feat = features[mask]
        summary[key] = {
            "count": int(mask.sum()),
            "mean": {FEATURE_NAMES[i]: float(np.mean(cluster_feat[:, i]))
                     for i in range(cluster_feat.shape[1])},
            "std": {FEATURE_NAMES[i]: float(np.std(cluster_feat[:, i]))
                    for i in range(cluster_feat.shape[1])},
        }

    out_path = root / "cluster_summary.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    logger.info(f"写入 cluster_summary.json")


def write_report(
    output_folder: str,
    features: np.ndarray,
    labels: np.ndarray,
    filenames: List[str],
    report_extra: dict,
):
    """写入 report.json"""
    root = Path(output_folder)
    unique_labels = sorted(set(labels))

    cluster_info = {}
    for label in unique_labels:
        if label == -1:
            continue
        mask = labels == label
        cluster_feat = features[mask]
        cluster_info[str(label)] = {
            "count": int(mask.sum()),
            "mean_features": {FEATURE_NAMES[i]: float(np.mean(cluster_feat[:, i]))
                              for i in range(cluster_feat.shape[1])},
            "depth_consistency": "unknown",
            "suggested_name": "",
        }

    report = dict(report_extra)
    report["cluster_info"] = cluster_info

    out_path = root / "report.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    logger.info(f"写入 report.json")


def generate_thumbnail_grid(
    output_folder: str,
    image_paths: List[Path],
    filenames: List[str],
    labels: np.ndarray,
):
    """生成 cluster_thumbnails.png — 每簇最多 16 张 4x4 网格"""
    root = Path(output_folder)
    unique_labels = sorted(set(l for l in labels if l >= 0))
    name_to_path = {p.name: p for p in image_paths}

    n_clusters = len(unique_labels)
    if n_clusters == 0:
        logger.warning("没有有效簇，跳过缩略图生成")
        return

    max_samples = CONFIG["max_samples_per_cluster"]
    grid_size = CONFIG["thumbnail_grid_size"]
    thumb_h, thumb_w = 180, 180

    fig, axes = plt.subplots(
        n_clusters, grid_size,
        figsize=(grid_size * 2.2, n_clusters * 2.2)
    )
    if n_clusters == 1:
        axes = [axes]

    for row, label in enumerate(unique_labels):
        mask = labels == label
        cluster_files = [f for i, f in enumerate(filenames) if mask[i]]
        samples = cluster_files[:max_samples]

        ax_row = axes[row] if n_clusters > 1 else axes
        for col in range(grid_size):
            ax = ax_row[col] if n_clusters > 1 else ax_row[col]
            ax.axis("off")
            if col < len(samples):
                src = name_to_path.get(samples[col])
                if src and src.exists():
                    img = cv2.imdecode(
                        np.fromfile(str(src), dtype=np.uint8),
                        cv2.IMREAD_COLOR
                    )
                    if img is not None:
                        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                        ax.imshow(img_rgb)
            ax.set_title(f"Cluster {label}" if col == 0 else "", fontsize=9)

    plt.tight_layout()
    out_path = root / "cluster_thumbnails.png"
    plt.savefig(str(out_path), dpi=120, bbox_inches="tight")
    plt.close(fig)
    logger.info(f"写入缩略图: {out_path}")


def write_outputs(
    output_folder: str,
    image_paths: List[Path],
    features: np.ndarray,
    labels: np.ndarray,
    filenames: List[str],
    report_extra: dict,
):
    """写入所有输出"""
    root = ensure_output_dirs(output_folder)

    write_features_csv(str(root), features, labels, filenames)
    write_cluster_preview(str(root), filenames, labels)
    write_cluster_summary(str(root), features, labels, filenames)
    write_report(str(root), features, labels, filenames, report_extra)
    generate_thumbnail_grid(str(root), image_paths, filenames, labels)
    copy_images_to_clusters(str(root), image_paths, filenames, labels)

    logger.info(f"所有输出已写入: {root}")
