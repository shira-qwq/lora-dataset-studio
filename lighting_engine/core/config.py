"""CONFIG 参数总控 — Intrinsic Lighting Embedding Engine v6 (无 DA3)"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

CONFIG = {
    "input_folders": [],
    "output_folder": str(PROJECT_ROOT / "lighting_outputs"),
    "preset": "full",
    "feature_groups": {
        "brightness":       {"enabled": True, "dims": 4, "weight": 1.0, "cluster": True, "label": "亮度"},
        "lighting":         {"enabled": True, "dims": 4, "weight": 1.0, "cluster": True, "label": "光影"},
        "color":            {"enabled": True, "dims": 3, "weight": 1.0, "cluster": True, "label": "颜色"},
        # color features: warm_cool_bias(raw), saturation_mean, saturation_std
        # warm_cool_bias_weighted, low/high_sat_ratio, dominant_hue are metadata-only
        "spatial_lighting": {"enabled": True, "dims": 5, "weight": 1.0, "cluster": True, "label": "空间光"},
        "subject_bg":       {"enabled": False, "dims": 1, "weight": 1.0, "cluster": True, "label": "主体背景"},
        # 注意: depth/coupling/depth_gap 已移除（DA3 不可用）
    },
    "color_weight": 1.0,
    "umap_neighbors": 50,
    "cluster_size_ratio": 0.015,

    # ── 高级 ──
    "metric": "euclidean",

    # ── GUI隐藏 ──
    "device": "cpu",  # 改为 CPU（无 DA3 后 GPU 不再必需）
    "batch_size": 8,
    "max_size": 1024,
    "num_workers": 4,
    "cache_dir": str(PROJECT_ROOT / ".cache"),
    "umap_min_dist": 0.05,
    "umap_n_components_cluster": 5,
    "umap_n_components_viz": 3,
    "min_samples_ratio": 0.3,
    "output_format": "jpg",
    "verbose": True,
    "valid_extensions": {".jpg", ".jpeg", ".png", ".webp", ".bmp"},

    # ── Plotly ──
    "plotly_mode": "3d",
    "plotly_show_thumbnails": False,
    "cluster_granularity": 1.0,
}
