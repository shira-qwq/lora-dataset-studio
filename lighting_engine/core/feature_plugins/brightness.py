"""亮度特征插件 (5维) — v4.1

新增: brightness_skewness (稳健偏度)
"""

import numpy as np


def _robust_skewness(L: np.ndarray) -> float:
    """Robust brightness skewness.

    Uses (mean - median) / std instead of third moment, which is
    more robust to outliers and works on small/low-contrast images.

    Positive: dark/mid image with small bright highlights.
    Negative: bright image with small dark strokes/shadows.
    Near zero: balanced brightness distribution.
    """
    mean = float(np.mean(L))
    median = float(np.median(L))
    std = float(np.std(L))
    return float((mean - median) / (std + 1e-6))


def extract(L: np.ndarray) -> dict:
    """亮度结构特征

    L: [H, W] float32, LAB-L / 255
    返回有序字典:
        brightness_mean, brightness_std, brightness_p10,
        brightness_p90, brightness_skewness
    """
    flat = L.flatten()
    return {
        "brightness_mean": float(np.mean(flat)),
        "brightness_std": float(np.std(flat)),
        "brightness_p10": float(np.percentile(flat, 10)),
        "brightness_p90": float(np.percentile(flat, 90)),
        "brightness_skewness": _robust_skewness(flat),
    }
