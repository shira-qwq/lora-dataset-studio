"""光影特征插件 (4维) — v5（P1 精简）

P1 删除 (见 ALGORITHM_REVIEW §10.1):
  - shadow_threshold  (↔ brightness_mean, r=0.901, brightness_mean 已是 MI #3)
  - edge_strength_p90 (↔ edge_strength_mean, r=0.972)
保留: contrast, highlight_threshold, edge_strength_mean, edge_strength_std
"""

import cv2
import numpy as np


def extract(L: np.ndarray) -> np.ndarray:
    """光影结构特征
    L: [H, W] float32, LAB-L / 255
    返回: [contrast, highlight_threshold,
           edge_strength_mean, edge_strength_std]
    """
    flat = L.flatten()
    p10 = float(np.percentile(flat, 10))
    p50 = float(np.percentile(flat, 50))
    p90 = float(np.percentile(flat, 90))

    contrast = (p90 - p10) / max(p50, 0.01)

    highlight_threshold = float(np.percentile(flat, 80))

    # 边缘梯度强度（实际强度，非比例）
    sobel_x = cv2.Sobel(L, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(L, cv2.CV_64F, 0, 1, ksize=3)
    grad = np.sqrt(sobel_x**2 + sobel_y**2)

    edge_strength_mean = float(np.mean(grad))
    edge_strength_std = float(np.std(grad))

    return np.array([
        contrast, highlight_threshold,
        edge_strength_mean, edge_strength_std,
    ], dtype=np.float32)
