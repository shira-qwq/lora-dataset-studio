"""特征装配器 — v4.1 (支持 dict extractors)"""

import logging
from typing import Dict, List, Optional, Tuple
import numpy as np

from .feature_plugins import (
    brightness, lighting, color, spatial_lighting
)

logger = logging.getLogger("LightingEngine")

# Extractors return either dict (ordered) or np.ndarray.
# assemble() converts both to a consistent ordered array.
EXTRACTORS = {
    "brightness":       lambda img, dm, cm: brightness.extract(_get_l_channel(img)),
    "lighting":         lambda img, dm, cm: lighting.extract(_get_l_channel(img)),
    "color":            lambda img, dm, cm: color.extract(img),
    "spatial_lighting": lambda img, dm, cm: spatial_lighting.extract(img),
    "subject_bg":       lambda img, dm, cm: {"subject_bg_ratio": 0.0},
}

FEATURE_GROUP_NAMES = {
    "brightness": ["brightness_mean", "brightness_std", "brightness_p10",
                   "brightness_p90", "brightness_skewness"],
    "lighting":   ["contrast", "highlight_threshold",
                   "edge_strength_mean", "edge_strength_std"],
    "color":      ["warm_cool_bias", "saturation_mean", "saturation_std",
                   "warm_cool_bias_weighted", "low_saturation_ratio",
                   "high_saturation_ratio", "dominant_hue_strength"],
    "depth":      ["depth_variance", "depth_entropy"],
    "coupling":   ["depth_lighting_corr", "high_gradient_depth_var"],
    "spatial_lighting":
        ["light_centroid_x", "light_centroid_y", "light_spread",
         "light_concentration", "light_asymmetry"],
    "depth_gap":  ["foreground_background_depth_gap"],
    "subject_bg": ["subject_bg_ratio"],
}


def _get_l_channel(img_rgb: np.ndarray) -> np.ndarray:
    import cv2
    lab = cv2.cvtColor((img_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
    return lab[:, :, 0].astype(np.float32) / 255.0


def _feat_to_array(feat, group_name: str, group: dict) -> np.ndarray:
    """Convert extractor output to flat numpy array.

    Supports both dict (Python 3.7+ ordered) and np.ndarray returns.
    Respects group 'dims' to truncate to the desired number of dimensions.
    """
    if isinstance(feat, dict):
        vals = list(feat.values())
        dims = int(group.get("dims", len(vals)))
        return np.array(vals[:dims], dtype=np.float32)
    dims = int(group.get("dims", feat.shape[0]))
    return np.asarray(feat, dtype=np.float32).ravel()[:dims]


def assemble(img_rgb: np.ndarray,
             depth_map: Optional[np.ndarray],
             conf_map: Optional[np.ndarray],
             feature_groups: Dict) -> Tuple[np.ndarray, Dict]:
    """装配特征向量 + sidecar"""
    parts = []
    sidecar = {}

    for name, group in feature_groups.items():
        if not group.get("enabled", False):
            continue
        feat = EXTRACTORS[name](img_rgb, depth_map, conf_map)
        weight = group.get("weight", 1.0)

        arr = _feat_to_array(feat, name, group)
        parts.append(arr * weight)

        if name == "depth" and isinstance(feat, np.ndarray) and len(feat) >= 3:
            sidecar["depth_confidence_mean"] = float(feat[2])

    if not parts:
        raise ValueError("没有启用的特征组！")

    return np.concatenate(parts).astype(np.float32), sidecar


def assemble_batch(images: List,
                   depth_maps: List[Optional[np.ndarray]],
                   conf_maps: List[Optional[np.ndarray]],
                   feature_groups: Dict,
                   max_workers: int = 4) -> Tuple[np.ndarray, List[Dict]]:
    from concurrent.futures import as_completed, ThreadPoolExecutor
    from tqdm import tqdm

    n = len(images)
    sample, _ = assemble(images[0][1], depth_maps[0], conf_maps[0], feature_groups)
    dim = len(sample)
    features = np.zeros((n, dim), dtype=np.float32)
    sidecars = [{} for _ in range(n)]

    if max_workers <= 1:
        for i, (_, img) in enumerate(images):
            f, s = assemble(img, depth_maps[i], conf_maps[i], feature_groups)
            features[i] = f
            sidecars[i] = s
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            def _task(i):
                _, img = images[i]
                f, s = assemble(img, depth_maps[i], conf_maps[i], feature_groups)
                return i, f, s
            futures = {pool.submit(_task, i): i for i in range(n)}
            for f in tqdm(as_completed(futures), total=len(futures),
                          desc="Assemble features", unit="img"):
                idx, feat, sc = f.result()
                features[idx] = feat
                sidecars[idx] = sc

    return features, sidecars


def get_active_feature_names(feature_groups: Dict) -> List[str]:
    """Get feature names for all enabled feature groups.

    Uses FEATURE_GROUP_NAMES for known groups, otherwise generates
    {group_name}_{d} for each dimension.
    Truncates to the group's `dims` to match the actual feature matrix.
    """
    names = []
    for group_name, group in feature_groups.items():
        if group.get("enabled", False):
            n_dims = int(group.get("dims", 1))
            dim_names = FEATURE_GROUP_NAMES.get(
                group_name,
                [f"{group_name}_{d}" for d in range(n_dims)]
            )
            if group_name == "depth":
                dim_names = dim_names[:2]
                n_dims = min(n_dims, 2)
            names.extend(dim_names[:n_dims])
    return names


def get_cluster_indices(feature_groups: dict) -> list:
    """返回参与聚类的特征列索引"""
    indices = []
    col = 0
    for name, group in feature_groups.items():
        if not group.get("enabled", False):
            continue
        dims = group.get("dims", 2)
        actual = 2 if name == "depth" else dims
        if group.get("cluster", True):
            indices.extend(range(col, col + actual))
        col += actual
    return indices


def get_explanatory_indices(feature_groups: dict) -> list:
    """返回不参与聚类但保留输出的特征列索引"""
    indices = []
    col = 0
    for name, group in feature_groups.items():
        if not group.get("enabled", False):
            continue
        dims = group.get("dims", 2)
        actual = 2 if name == "depth" else dims
        if not group.get("cluster", True):
            indices.extend(range(col, col + actual))
        col += actual
    return indices
