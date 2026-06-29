"""色彩特征插件 (7维) — v4.4c-3

主聚类使用 raw warm_cool_bias (mean(R-B))。
warm_cool_bias_weighted (HSV S/V 加权) 作为 metadata-only。
"""

import cv2
import numpy as np


def _rgb_to_hsv_float(img_rgb: np.ndarray) -> np.ndarray:
    """Convert RGB (0~1 float) to HSV float array."""
    img_u8 = np.clip(img_rgb * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(img_u8, cv2.COLOR_RGB2HSV).astype(np.float32)


def _warm_cool_bias_raw(img_rgb: np.ndarray) -> float:
    """Raw warm-cool bias = mean(R - B). Simple, unweighted."""
    r = img_rgb[..., 0].astype(np.float32)
    b = img_rgb[..., 2].astype(np.float32)
    return float(np.mean(r - b))


def _warm_cool_bias_weighted(img_rgb: np.ndarray, hsv: np.ndarray) -> float:
    """HSV S/V weighted warm-cool bias.

    Saturated and visible pixels contribute more to color temperature.
    Low-saturation and very dark pixels get down-weighted.
    """
    r = img_rgb[..., 0].astype(np.float32)
    b = img_rgb[..., 2].astype(np.float32)

    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0

    weight = np.clip(s, 0.0, 1.0) * np.sqrt(np.clip(v, 0.0, 1.0))
    denom = float(np.sum(weight)) + 1e-6
    return float(np.sum((r - b) * weight) / denom)


def _saturation_ratios(hsv: np.ndarray) -> tuple:
    """Compute low/high saturation ratios.

    Only considers pixels with V > 0.08 (non-dark).
    """
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0

    valid = v > 0.08
    if int(np.sum(valid)) == 0:
        return 1.0, 0.0

    sv = s[valid]
    low_saturation_ratio = float(np.mean(sv < 0.12))
    high_saturation_ratio = float(np.mean(sv > 0.55))
    return low_saturation_ratio, high_saturation_ratio


def _dominant_hue_strength(hsv: np.ndarray, bins: int = 24) -> float:
    """Fraction of non-gray pixels captured by the dominant hue bin.

    Returns 0.0 for grayscale or very low-saturation images.
    """
    h = hsv[..., 0] / 180.0
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0

    valid = (s > 0.15) & (v > 0.08)
    if int(np.sum(valid)) < 32:
        return 0.0

    hist, _ = np.histogram(h[valid], bins=bins, range=(0.0, 1.0))
    total = float(np.sum(hist)) + 1e-6
    return float(np.max(hist) / total)


def extract(img_rgb: np.ndarray) -> dict:
    """色彩结构特征，返回有序字典。

    img_rgb: [H, W, 3] float32 (0~1)
    返回:
        warm_cool_bias (mean(R-B)), saturation_mean, saturation_std,
        warm_cool_bias_weighted (metadata),
        low_saturation_ratio, high_saturation_ratio, dominant_hue_strength

    Note: first 3 entries are used for clustering (config color dims=3).
    The remaining entries are metadata-only.
    """
    img_rgb = img_rgb.astype(np.float32)
    hsv = _rgb_to_hsv_float(img_rgb)

    s = hsv[..., 1] / 255.0
    low_sat, high_sat = _saturation_ratios(hsv)

    return {
        "warm_cool_bias": _warm_cool_bias_raw(img_rgb),
        "saturation_mean": float(np.mean(s)),
        "saturation_std": float(np.std(s)),
        "warm_cool_bias_weighted": _warm_cool_bias_weighted(img_rgb, hsv),
        "low_saturation_ratio": low_sat,
        "high_saturation_ratio": high_sat,
        "dominant_hue_strength": _dominant_hue_strength(hsv),
    }
