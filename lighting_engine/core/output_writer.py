"""输出模块 — CSV / JSON / 缩略图 / Plotly / 相关性 — v5"""

import csv
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import pandas as pd
from matplotlib import pyplot as plt

from .config import CONFIG


logger = logging.getLogger("LightingEngine")


def _imread_safe(path: str):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def ensure_output_dirs(output_folder: str, cluster_names: Dict[int, str], new_structure: bool = False):
    root = Path(output_folder)
    root.mkdir(parents=True, exist_ok=True)
    if new_structure:
        for sub in ["features", "clustering", "inspection", "logs", "reports"]:
            (root / "_studio" / sub).mkdir(parents=True, exist_ok=True)
        (root / "_cache" / "thumbnails").mkdir(parents=True, exist_ok=True)


def write_features_csv(output_folder: str,
                       features: np.ndarray,
                       feature_names: List[str],
                       labels: np.ndarray,
                       filenames: List[str]):
    df = pd.DataFrame(features, columns=feature_names)
    df.insert(0, "filename", filenames)
    df["cluster_id"] = labels
    out = Path(output_folder) / "features.csv"
    df.to_csv(out, index=False)
    logger.info(f"features.csv: {out} ({len(df)} 行)")


def write_umap_points_csv(output_folder: str,
                          prefix: str,
                          embedding: np.ndarray,
                          labels: np.ndarray,
                          filenames: List[str]):
    cols = {f"dim_{i}": embedding[:, i] for i in range(embedding.shape[1])}
    df = pd.DataFrame({"filename": filenames, **cols, "cluster": labels})
    out = Path(output_folder) / f"umap_points_{prefix}.csv"
    df.to_csv(out, index=False)
    logger.info(f"umap_points_{prefix}.csv: {out}")


def write_feature_correlation(output_folder: str,
                              features: np.ndarray,
                              feature_names: List[str]):
    corr = np.corrcoef(features.T)
    df = pd.DataFrame(corr, index=feature_names, columns=feature_names)
    out = Path(output_folder) / "feature_correlation.csv"
    df.to_csv(out)
    logger.info(f"feature_correlation.csv: {out}")

    # 热力图
    fig, ax = plt.subplots(figsize=(10, 8))
    im = ax.imshow(corr, cmap='coolwarm', vmin=-1, vmax=1)
    ax.set_xticks(range(len(feature_names)))
    ax.set_yticks(range(len(feature_names)))
    ax.set_xticklabels(feature_names, rotation=45, ha='right', fontsize=8)
    ax.set_yticklabels(feature_names, fontsize=8)
    ax.set_title("Feature Correlation Matrix")
    plt.colorbar(im, ax=ax, shrink=0.8)
    plt.tight_layout()
    out_png = Path(output_folder) / "correlation_heatmap.png"
    plt.savefig(str(out_png), dpi=150)
    plt.close(fig)
    logger.info(f"correlation_heatmap.png: {out_png}")


def write_feature_importance(output_folder: str,
                             importance: dict):
    out = Path(output_folder) / "feature_importance.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(importance, f, indent=2, ensure_ascii=False)
    logger.info(f"feature_importance.json: {out}")


def generate_lighting_map(output_folder: str,
                          embedding: np.ndarray,
                          labels: np.ndarray,
                          filenames: List[str],
                          cluster_names: Optional[Dict[int, str]] = None,
                          mode: str = "3d",
                          show_thumbnails: bool = False):
    """Plotly 交互式 UMAP 地图（基于3D嵌入）"""
    import plotly.express as px

    if cluster_names:
        legend = {**cluster_names, -1: "Noise"}
    else:
        legend = {}
    cluster_labels = [
        legend.get(l, f"Cluster {l}") if l >= 0 else "Noise"
        for l in labels
    ]

    thumbnails = []
    if show_thumbnails:
        for fname in filenames:
            b64 = _image_to_base64(str(Path(output_folder).parent / fname), size=64)
            thumbnails.append(f'<img src="data:image/jpeg;base64,{b64}" width="64">' if b64 else "")

    df = pd.DataFrame({
        "x": embedding[:, 0],
        "y": embedding[:, 1],
        "cluster": cluster_labels,
        "filename": filenames,
    })
    hover = {"filename": True, "cluster": True}

    if mode == "3d" and embedding.shape[1] >= 3:
        df["z"] = embedding[:, 2]
        if show_thumbnails:
            df["thumbnail"] = thumbnails
            hover["thumbnail"] = True
        fig = px.scatter_3d(
            df, x="x", y="y", z="z", color="cluster",
            hover_data=hover,
            title="Lighting Embedding Space (3D) — 悬停查看文件名",
            opacity=0.7,
        )
        fig.update_traces(marker=dict(size=4))
        fig.update_layout(
            legend=dict(font=dict(size=10)),
            scene=dict(xaxis_title="UMAP1", yaxis_title="UMAP2", zaxis_title="UMAP3"),
        )
    else:
        if show_thumbnails:
            df["thumbnail"] = thumbnails
            hover["thumbnail"] = True
        fig = px.scatter(
            df, x="x", y="y", color="cluster",
            hover_data=hover,
            title="Lighting Embedding Space (2D) — 悬停查看文件名",
            opacity=0.7,
        )
        fig.update_traces(marker=dict(size=5))
        fig.update_layout(
            legend=dict(font=dict(size=10)),
            xaxis_title="UMAP1", yaxis_title="UMAP2",
        )

    out = Path(output_folder) / "lighting_map.html"
    fig.write_html(str(out))
    logger.info(f"lighting_map.html: {out} (mode={mode})")


def _image_to_base64(path: str, size: int = 64) -> str:
    import base64
    try:
        img = cv2.imread(path)
        if img is None:
            return ""
        h, w = img.shape[:2]
        scale = size / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 60])
        return base64.b64encode(buf).decode("ascii")
    except Exception:
        return ""


def write_cluster_names(output_folder: str,
                        cluster_names: Dict[int, str]):
    out = Path(output_folder) / "cluster_names.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in cluster_names.items()},
                  f, indent=2, ensure_ascii=False)
    logger.info(f"cluster_names.json: {out}")


def write_experiment(output_folder: str, result: dict):
    import datetime
    exp = {
        "experiment_id": f"exp_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "timestamp": datetime.datetime.now().isoformat(),
        "preset": result["config_used"].get("preset", "full"),
        "input_folders": result["config_used"]["input_folders"],
        "output_folder": output_folder,
        "feature_groups": result["config_used"]["feature_groups"],
            "feature_weights": result.get("feature_weights", {}),
            "scaler": "RobustScaler",
            "umap": {
            "n_neighbors": result["config_used"]["umap_neighbors"],
            "n_components_cluster": 5,
            "n_components_viz": 3,
            "note": "5D 是 HDBSCAN 聚类输入(实证必要), 3D 仅可视化",
        },
        "hdbscan": {
            "min_cluster_size": result["config_used"]["min_cluster_size"],
            "min_samples": result["config_used"]["min_samples"],
            "cluster_size_ratio": result["config_used"]["cluster_size_ratio"],
            "granularity": result["config_used"]["cluster_granularity"],
        },
        "results": {
            "total_images": len(result["filenames"]),
            "clusters": result["n_clusters"],
            "noise_ratio": round(result["noise_count"] / max(len(result["filenames"]), 1), 4),
            "silhouette_score": result["quality"].get("silhouette_score"),
            "davies_bouldin_score": result["quality"].get("davies_bouldin_score"),
        },
    }
    out = Path(output_folder) / "experiment.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(exp, f, indent=2, ensure_ascii=False)
    logger.info(f"experiment.json: {out}")


def write_cluster_summary(output_folder: str,
                          features: np.ndarray,
                          feature_names: List[str],
                          labels: np.ndarray,
                          filenames: List[str],
                          importance: dict = None):
    unique = sorted(set(labels))
    summary = {}
    for label in unique:
        mask = labels == label
        key = f"cluster_{label}" if label >= 0 else "noise"
        cf = features[mask]
        entry = {
            "count": int(mask.sum()),
            "mean": {feature_names[i]: float(np.mean(cf[:, i]))
                     for i in range(cf.shape[1])},
            "std": {feature_names[i]: float(np.std(cf[:, i]))
                    for i in range(cf.shape[1])},
        }
        if importance and str(label) in importance:
            entry["top_features"] = importance[str(label)]
        summary[key] = entry
    out = Path(output_folder) / "cluster_summary.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    logger.info(f"cluster_summary.json: {out}")


def write_cluster_preview(output_folder: str,
                          filenames: List[str],
                          labels: np.ndarray):
    clusters = {}
    for fname, label in zip(filenames, labels):
        key = f"cluster_{label}" if label >= 0 else "noise"
        if key not in clusters:
            clusters[key] = {"count": 0, "examples": []}
        clusters[key]["count"] += 1
        if len(clusters[key]["examples"]) < 3:
            clusters[key]["examples"].append(fname)
    out = Path(output_folder) / "cluster_preview.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(clusters, f, indent=2, ensure_ascii=False)
    logger.info(f"cluster_preview.json: {out}")


def write_report(output_folder: str, result: dict,
                 cluster_names: Dict[int, str],
                 feature_names: List[str]):
    features = result["features"]
    labels = result["labels"]
    unique = sorted(set(l for l in labels if l >= 0))

    cluster_info = {}
    for label in unique:
        mask = labels == label
        cf = features[mask]
        entry = {
            "count": int(mask.sum()),
            "name": cluster_names.get(label, ""),
            "mean_features": {feature_names[i]: float(np.mean(cf[:, i]))
                              for i in range(cf.shape[1])},
        }
        # 加入语义分析信息
        ca = result.get("cluster_analysis", {})
        if str(label) in ca:
            entry["semantic_tags"] = ca[str(label)].get("semantic_tags", [])
            entry["suggested_name"] = ca[str(label)].get("suggested_name", "")
            entry["dominant_features"] = ca[str(label)].get("dominant_features", [])
        cluster_info[str(label)] = entry

    report = {
        "total_images": len(result["filenames"]),
        "clusters": result["n_clusters"],
        "noise_count": result["noise_count"],
        "noise_ratio": round(result["noise_count"] / max(len(result["filenames"]), 1), 4),
        "feature_dim": features.shape[1],
        "quality": result["quality"],
        "feature_weights": result.get("feature_weights", {}),
        "cluster_info": cluster_info,
    }

    # v5: 添加 depth_confidence_mean 摘要
    sidecars = result.get("sidecars", [])
    if sidecars and "depth_confidence_mean" in sidecars[0]:
        confs = [s.get("depth_confidence_mean", 0) for s in sidecars]
        report["depth_confidence_stats"] = {
            "mean": float(np.mean(confs)),
            "std": float(np.std(confs)),
            "min": float(min(confs)),
            "max": float(max(confs)),
        }

    out = Path(output_folder) / "report.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    logger.info(f"report.json: {out}")


def generate_thumbnail_grid(output_folder: str,
                            image_paths: List[Path],
                            filenames: List[str],
                            labels: np.ndarray,
                            cluster_names: Dict[int, str]):
    unique = sorted(set(l for l in labels if l >= 0))
    name_to_path = {p.name: p for p in image_paths}
    n_clusters = len(unique)
    if n_clusters == 0:
        logger.warning("无有效簇，跳过缩略图")
        return

    grid_size = CONFIG.get("thumbnail_grid_size", 4)
    max_samples = CONFIG.get("max_samples_per_cluster", 16)
    fig, axes = plt.subplots(n_clusters, grid_size,
                             figsize=(grid_size * 2.2, n_clusters * 2.2))
    if n_clusters == 1:
        axes = [axes]

    for row, label in enumerate(unique):
        mask = labels == label
        samples = [f for i, f in enumerate(filenames) if mask[i]][:max_samples]
        ax_row = axes[row] if n_clusters > 1 else axes
        for col in range(grid_size):
            ax = ax_row[col] if n_clusters > 1 else ax_row[col]
            ax.axis("off")
            if col < len(samples):
                src = name_to_path.get(samples[col])
                if src and src.exists():
                    img = _imread_safe(str(src))
                    if img is not None:
                        ax.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            name = cluster_names.get(label, f"Cluster {label}")
            ax.set_title(name if col == 0 else "", fontsize=8)

    plt.tight_layout()
    out = Path(output_folder) / "cluster_thumbnails.png"
    plt.savefig(str(out), dpi=120, bbox_inches="tight")
    plt.close(fig)
    logger.info(f"thumbnail: {out}")


def write_thumbnails(output_folder: str,
                     image_paths: List[str],
                     size: int = 256,
                     quality: int = 75,
                     max_workers: int = 4):
    """Pre-generate 256px JPEG thumbnails for all images.

    Saved to: {output_folder}/thumbnails/{filename}.jpg

    This is the OPTIMIZED path: thumbs are generated ONCE during pipeline,
    not on every request.

    Note: cv2.imwrite fails on Windows for paths with non-ASCII characters
    (e.g. Chinese), so we use cv2.imencode + Python's open() instead.
    """
    from concurrent.futures import ThreadPoolExecutor

    thumb_dir = Path(output_folder) / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    def _gen_one(img_path: str) -> bool:
        if not img_path:
            return False
        try:
            p = Path(img_path)
            if not p.exists():
                alt = Path(output_folder) / p.name
                if alt.exists():
                    p = alt
                else:
                    return False
            dst = thumb_dir / (p.stem + ".jpg")
            if dst.exists() and dst.stat().st_mtime > p.stat().st_mtime:
                return True  # already generated and newer
            img = _imread_safe(str(p))
            if img is None:
                return False
            h, w = img.shape[:2]
            if w > size or h > size:
                ratio = size / max(w, h)
                img = cv2.resize(img, (int(w * ratio), int(h * ratio)), interpolation=cv2.INTER_AREA)
            # cv2.imwrite 不支持中文路径，用 imencode + Python 文件 I/O
            ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if not ok:
                return False
            with open(str(dst), 'wb') as f:
                f.write(buf.tobytes())
            return True
        except Exception as e:
            logger.warning(f"thumbnail failed: {img_path} - {e}")
            return False

    ok = 0
    fail = 0
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for r in ex.map(_gen_one, image_paths):
            if r: ok += 1
            else: fail += 1
    logger.info(f"thumbnails: {ok} ok, {fail} fail, dir={thumb_dir}")


def _out(output_folder: str, *segments: str) -> Path:
    """Resolve an output path relative to output_folder."""
    return Path(output_folder).joinpath(*segments)


def _out_new(output_folder: str, *segments: str) -> Path:
    """Resolve a new-structure path under _studio/ or _cache/."""
    return Path(output_folder) / "_studio" / segments[0] / Path(*segments[1:])


def _out_thumb(output_folder: str, use_new_structure: bool = False) -> Path:
    """Resolve thumbnail cache directory."""
    if use_new_structure:
        return Path(output_folder) / "_cache" / "thumbnails"
    return Path(output_folder) / "thumbnails"


def _ensure_dir(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def write_all(output_folder: str, result: dict, write_extras: bool = False,
              new_structure: bool = False):
    """Write all output files.

    new_structure=True: files go to _studio/ subdirs, thumbnails to _cache/.
    new_structure=False (default): backward compatible flat layout.

    write_extras=False (default): minimal set used by web UI
      - features.csv
      - cluster_summary.json (with names)
      - cluster_names.json
      - atlas_points.csv (2D)
      - umap_points_3d.csv
      - experiment.json
      - report.json (consolidated)
      - thumbnails/ (pre-generated JPEGs)
      - cluster_health.json (if available)

    write_extras=True: also include diagnostic reports (kept for debugging)
    """
    # Path shortcuts
    out = lambda *s: _out(output_folder, *s)
    out_s = lambda sub, fn: _out_new(output_folder, sub, fn) if new_structure else _out(output_folder, fn)
    thumb_dir = _out_thumb(output_folder, new_structure)
    features = result["features"]
    labels = result["labels"]
    filenames = result["filenames"]
    image_paths = result.get("image_paths", [])
    embedding_3d = result.get("embedding_3d")
    embedding_5d = result.get("embedding_5d")
    feature_names = result["feature_names"]
    importance = result.get("feature_importance", {})
    diag = result.get("diagnostic_report", {})

    # Cluster 命名：suggested_name > DNA tags
    cluster_analysis = result.get("cluster_analysis", {})
    cluster_names: Dict[int, str] = {}
    for label in sorted(set(l for l in labels if l >= 0)):
        info = cluster_analysis.get(label, {})
        suggested = info.get("suggested_name", "")
        if suggested and suggested != "balanced":
            cluster_names[label] = suggested  # 不加 000_ 前缀，更简洁
        else:
            tags = info.get("semantic_tags", [])
            if tags:
                cluster_names[label] = "_".join(tags[:3])
            else:
                cluster_names[label] = f"{label:03d}_balanced"

    # 创建目录
    ensure_output_dirs(output_folder, cluster_names, new_structure=new_structure)

    # === 必写 (Web UI 需要) ===
    write_features_csv(str(_ensure_dir(out_s("features", ""))), features, feature_names, labels, filenames)
    write_cluster_summary(str(_ensure_dir(out_s("clustering", ""))), features, feature_names, labels, filenames, importance)
    write_cluster_names(str(_ensure_dir(out_s("clustering", ""))), cluster_names)
    write_report(str(_ensure_dir(out_s("", ""))), result, cluster_names, feature_names)
    write_experiment(str(_ensure_dir(out_s("", ""))), result)

    # === atlas_points.csv (2D, 必需) ===
    # pipeline 只产生 embedding_5d / embedding_3d，这里取前 2 维作为 2D 投影
    if embedding_5d is not None and len(embedding_5d) > 0:
        atlas_df = pd.DataFrame({
            "image_path": [str(p).replace("\\", "/") for p in image_paths],
            "cluster_id": labels,
            "cluster_name": [cluster_names.get(int(l), "noise" if l == -1 else f"cluster_{l}") for l in labels],
            "umap_x": embedding_5d[:, 0],
            "umap_y": embedding_5d[:, 1],
        })
        atlas_out = _ensure_dir(out_s("features", "atlas_points.csv"))
        atlas_df.to_csv(atlas_out, index=False)
        logger.info(f"atlas_points.csv: {atlas_out}")

    if embedding_3d is not None and len(embedding_3d) > 0:
        umap3_out = _ensure_dir(out_s("features", "umap_points_3d.csv"))
        umap3_df = pd.DataFrame({
            "image_path": [str(p).replace("\\", "/") for p in image_paths],
            "cluster_id": labels,
            "cluster_name": [cluster_names.get(int(l), "noise" if l == -1 else f"cluster_{l}") for l in labels],
            "umap_x": embedding_3d[:, 0],
            "umap_y": embedding_3d[:, 1],
            "umap_z": embedding_3d[:, 2],
        })
        umap3_df.to_csv(umap3_out, index=False)
        logger.info(f"umap_points_3d.csv: {umap3_out}")

    # === 缩略图预生成（关键优化） ===
    if image_paths:
        write_thumbnails(str(thumb_dir), image_paths, size=256, quality=75)

    # === cluster_analysis.json (Web UI 必需) ===
    if cluster_analysis:
        ca_serializable = {str(k): v for k, v in cluster_analysis.items()}
        ca_out = _ensure_dir(out_s("clustering", "cluster_analysis.json"))
        with open(ca_out, "w", encoding="utf-8") as f:
            json.dump(ca_serializable, f, indent=2, ensure_ascii=False)
        logger.info(f"cluster_analysis.json: {ca_out}")

    # === v4.2: image_diagnostics.json (直方图标签, 不参与聚类) ===
    image_diag = result.get("image_diagnostics")
    if image_diag:
        diag_out = _ensure_dir(out_s("inspection", "image_diagnostics.json"))
        with open(diag_out, "w", encoding="utf-8") as f:
            json.dump(image_diag, f, indent=2, ensure_ascii=False)
        logger.info(f"image_diagnostics.json: {diag_out}")

    # === v4.3: quality_report.json (blur + imagehash, 不参与聚类) ===
    quality_rep = result.get("quality_report")
    if quality_rep:
        qr_out = _ensure_dir(out_s("inspection", "quality_report.json"))
        with open(qr_out, "w", encoding="utf-8") as f:
            json.dump(quality_rep, f, indent=2, ensure_ascii=False)
        logger.info(f"quality_report.json: {qr_out}")

    # === 可选: 写诊断/调试文件 (默认不写，用户需要时可指定) ===
    if write_extras:
        if diag:
            out_path = _ensure_dir(out_s("reports", "feature_variance_report.json"))
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(diag, f, indent=2, ensure_ascii=False)
            logger.info(f"feature_variance_report.json: {out_path}")

        write_feature_correlation(_ensure_dir(out_s("reports", "feature_correlation.csv")), features, feature_names)
        write_feature_importance(_ensure_dir(out_s("reports", "feature_importance.csv")), importance)
        write_cluster_preview(_ensure_dir(out_s("reports", "cluster_preview.json")), filenames, labels)

        # 特征冗余
        redundant = result.get("redundant_features", [])
        if redundant:
            red_out = _ensure_dir(out_s("reports", "redundant_features.json"))
            with open(red_out, "w", encoding="utf-8") as f:
                json.dump(redundant, f, indent=2, ensure_ascii=False)
            logger.info(f"redundant_features.json: {red_out}")

        # 聚类健康
        health = result.get("cluster_health", {})
        if health:
            health_out = _ensure_dir(out_s("reports", "cluster_health.json"))
            with open(health_out, "w", encoding="utf-8") as f:
                json.dump(health, f, indent=2, ensure_ascii=False)
            logger.info(f"cluster_health.json: {health_out}")

        # 聚类稳定性
        stability = result.get("cluster_stability", {})
        if stability:
            stab_out = _ensure_dir(out_s("reports", "cluster_stability.json"))
            with open(stab_out, "w", encoding="utf-8") as f:
                json.dump(stability, f, indent=2, ensure_ascii=False)
            logger.info(f"cluster_stability.json: {stab_out}")

        # 优化建议
        advice = result.get("iteration_advice", {})
        if advice:
            adv_out = _ensure_dir(out_s("reports", "iteration_advice.json"))
            with open(adv_out, "w", encoding="utf-8") as f:
                json.dump(advice, f, indent=2, ensure_ascii=False)
            logger.info(f"iteration_advice.json: {adv_out}")

        # Lighting Atlas (alternative format)
        _write_atlas_csv(output_folder, result, cluster_names, new_structure=new_structure)

        # 增强 cluster_health
        _enhance_health(output_folder, result, cluster_names, new_structure=new_structure)

        # UMAP Plotly
        generate_lighting_map(
            output_folder, embedding_3d, labels, filenames, cluster_names,
            mode=result.get("plotly_mode", "3d"),
            show_thumbnails=result.get("plotly_show_thumbnails", False),
            new_structure=new_structure,
        )
        generate_thumbnail_grid(output_folder, image_paths, filenames, labels, cluster_names, new_structure=new_structure)
    else:
        logger.info("(skipped: extras - pass write_extras=True to enable)")

    logger.info(f"全部输出已写入: {output_folder}")


def _write_atlas_csv(output_folder: str, result: dict, cluster_names: dict):
    """Lighting Atlas: 统一地图格式供未来 GUI 使用"""
    filenames = result["filenames"]
    labels = result["labels"]
    embedding_3d = result.get("embedding_3d")
    image_paths = result["image_paths"]
    cluster_names_rev = {v: k for k, v in cluster_names.items()}
    name_to_path = {p.name: str(p) for p in image_paths}

    rows = []
    for i, fname in enumerate(filenames):
        label = labels[i]
        cname = cluster_names.get(label, "noise") if label >= 0 else "noise"
        rows.append({
            "image_path": name_to_path.get(fname, ""),
            "cluster_id": label,
            "cluster_name": cname,
            "umap_x": round(float(embedding_3d[i, 0]), 6),
            "umap_y": round(float(embedding_3d[i, 1]), 6),
            "umap_z": round(float(embedding_3d[i, 2]) if embedding_3d.shape[1] >= 3 else 0, 6),
            "thumbnail_path": "",
        })

    import csv
    out = Path(output_folder) / "atlas_points.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    logger.info(f"atlas_points.csv: {out}")


def _enhance_health(output_folder: str, result: dict, cluster_names: dict):
    """增强 cluster_health.json: 重复名称/大簇/小簇/死特征/lowMI"""
    health = result.get("cluster_health", {})
    if not health:
        return

    labels = result["labels"]
    n = len(labels)
    features = result["features"]
    feature_names = result["feature_names"]

    # 重复名称
    name_counts = {}
    for cid, name in cluster_names.items():
        name_counts[name] = name_counts.get(name, 0) + 1
    duplicated = {name: cnt for name, cnt in name_counts.items() if cnt > 1}

    # 大簇/小簇
    unique = sorted(set(l for l in labels if l >= 0))
    oversized = []
    undersized = []
    for label in unique:
        size = int(np.sum(labels == label))
        ratio = size / n
        if ratio > 0.5:
            oversized.append({"cluster_id": int(label), "size": size, "ratio": round(ratio, 4)})
        if ratio < 0.01:
            undersized.append({"cluster_id": int(label), "size": size, "ratio": round(ratio, 4)})

    # 低 MI 特征
    low_mi = []
    if "feature_reliability" in result:
        rel = result["feature_reliability"]
        pf = rel.get("per_feature", {})
        for name, info in pf.items():
            mi = info.get("mi_score", 0)
            if mi is not None and mi < 0.05:
                low_mi.append({"feature": name, "mi_score": round(mi, 4)})

    health["duplicated_names"] = duplicated
    health["oversized_clusters"] = oversized
    health["undersized_clusters"] = undersized
    health["dead_features"] = result.get("dead_features", [])
    health["low_mi_features"] = low_mi
    health["rerun_count"] = result.get("config_used", {}).get("rerun_count", 0)

    # final_quality_score
    sil = health.get("silhouette", 0)
    noise = health.get("noise_ratio", 0)
    bal = 1 - (sum(s["ratio"] for s in oversized) if oversized else 0)
    health["final_quality_score"] = round(
        max(sil, 0) * 0.4 + (1 - noise) * 0.3 + bal * 0.3, 4
    )

    out = Path(output_folder) / "cluster_health.json"
    with open(out, "w", encoding="utf-8") as f:
        import json
        json.dump(health, f, indent=2, ensure_ascii=False)
    logger.info(f"cluster_health.json (enhanced): {out}")
