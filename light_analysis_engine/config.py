"""CONFIG 参数总控 — Light Analysis Engine v3"""

from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent

CONFIG = {
    # ---------- 输入输出 ----------
    "input_folder": str(PROJECT_ROOT / "写真test"),
    "output_folder": str(PROJECT_ROOT / "lighting_outputs"),

    # ---------- 预处理 ----------
    "max_size": 1024,               # 最长边缩放
    "valid_extensions": {".jpg", ".jpeg", ".png", ".webp", ".bmp"},

    # ---------- DA3 深度模型 ----------
    "model_path": str(PROJECT_ROOT / "DA3Small"),   # 本地模型路径
    "device": "cuda",                                # cuda / cpu
    "batch_size": 8,                                 # DA3 batch推理

    "use_depth": True,               # 是否启用深度分析
    "fallback_depth_dir": "_depth",  # 已有深度图的子目录名（相对于 input_folder）

    # ---------- UMAP ----------
    "umap_neighbors": "auto",   # "auto" 或具体整数
    "umap_min_dist": 0.05,
    "umap_dim": 3,
    "umap_random_state": 42,
    "umap_metric": "euclidean",

    # ---------- HDBSCAN ----------
    "min_cluster_size_base": 50,
    "cluster_size_ratio": 0.02,      # 不低于总图片的 2%
    "min_samples_ratio": 0.3,
    "cluster_selection_method": "eom",

    # ---------- 输出 ----------
    "output_format": "jpg",
    "thumbnail_grid_size": 4,        # 4x4
    "max_samples_per_cluster": 16,

    # ---------- 性能 ----------
    "verbose": True,
    "num_workers": 4,                # 特征提取并行数
    "cache_features": True,
    "cache_path": str(PROJECT_ROOT / "lighting_outputs" / "feature_cache.npy"),
}
