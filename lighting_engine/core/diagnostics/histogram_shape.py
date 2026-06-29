"""亮度直方图形状分析 — v4.2

为每张图片生成亮度直方图解释标签。
这些标签不参与主聚类，只作为 metadata / 排序 / 筛选 / 簇名解释用。

标签:
  - high_key: 明亮为主 (>65% 像素 >0.75)
  - low_key: 暗调为主 (>55% 像素 <0.25)
  - high_contrast: 亮暗皆多 (暗>30% 且 亮>30%)
  - midtone: 中间调为主 (>65% 在 0.25~0.75)
  - flat_hist: 低熵或尖峰
  - mixed_hist: 其他混合分布
"""

import numpy as np


def analyze_brightness_histogram(L: np.ndarray) -> dict:
    """Analyze brightness histogram shape.

    Args:
        L: [H, W] float32 array, L channel from LAB (0~1)

    Returns:
        dict with keys:
            brightness_hist_label: str - one of high_key, low_key, high_contrast,
                                   midtone, flat_hist, mixed_hist
            dark_ratio: float - fraction of pixels < 0.25
            mid_ratio: float - fraction of pixels 0.25~0.75
            bright_ratio: float - fraction of pixels > 0.75
            hist_entropy: float - Shannon entropy of 32-bin histogram
            hist_peak_strength: float - max bin fraction
    """
    L = L.astype(np.float32).reshape(-1)
    hist, _ = np.histogram(L, bins=32, range=(0.0, 1.0))
    hist = hist.astype(np.float32)
    hist_total = float(np.sum(hist)) + 1e-6
    hist_norm = hist / hist_total

    dark_ratio = float(np.mean(L < 0.25))
    mid_ratio = float(np.mean((L >= 0.25) & (L <= 0.75)))
    bright_ratio = float(np.mean(L > 0.75))

    entropy = float(-np.sum(hist_norm * np.log(hist_norm + 1e-8)))
    peak_strength = float(np.max(hist_norm))

    # Simple rule labels. Keep them conservative.
    if bright_ratio > 0.65 and dark_ratio < 0.15:
        label = "high_key"
    elif dark_ratio > 0.55 and bright_ratio < 0.20:
        label = "low_key"
    elif dark_ratio > 0.30 and bright_ratio > 0.30:
        label = "high_contrast"
    elif mid_ratio > 0.65:
        label = "midtone"
    elif entropy < 2.2 or peak_strength > 0.25:
        label = "flat_hist"
    else:
        label = "mixed_hist"

    return {
        "brightness_hist_label": label,
        "dark_ratio": round(dark_ratio, 4),
        "mid_ratio": round(mid_ratio, 4),
        "bright_ratio": round(bright_ratio, 4),
        "hist_entropy": round(entropy, 4),
        "hist_peak_strength": round(peak_strength, 4),
    }
