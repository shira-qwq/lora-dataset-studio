"""Spatial Lighting 特征插件 (5维) — v5（P1 精简）

P1 删除 (与 light_centroid_x/y 高度冗余, r≥0.94, 见 ALGORITHM_REVIEW §10.1):
  - light_direction_x  (≡ light_centroid_x, r=1.0)
  - light_direction_y  (≡ light_centroid_y, r=1.0)
  - light_verticality  (↔ light_centroid_y, r=0.938)
保留: 质心 + 扩散 + 集中度 + 不对称。
"""

import cv2
import numpy as np


def extract(img_rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor((img_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
    L = lab[:, :, 0].astype(np.float32) / 255.0
    h, w = L.shape

    Y, X = np.mgrid[0:h, 0:w]
    total_brightness = np.sum(L) + 1e-10
    cx = float(np.sum(X * L) / total_brightness / w)
    cy = float(np.sum(Y * L) / total_brightness / h)

    # light_spread
    dist_sq = (X - cx * w)**2 + (Y - cy * h)**2
    if np.sum(L) > 1e-10:
        light_spread = float(np.sqrt(np.average(dist_sq, weights=L)) / max(w, h))
    else:
        light_spread = 0.0

    # light_concentration
    threshold = np.percentile(L, 80)
    light_concentration = float(np.mean(L > threshold))

    # light_asymmetry
    half_w, half_h = w // 2, h // 2
    left_energy = float(np.mean(L[:, :half_w]))
    right_energy = float(np.mean(L[:, half_w:]))
    top_energy = float(np.mean(L[:half_h, :]))
    bottom_energy = float(np.mean(L[half_h:, :]))
    light_asymmetry = abs(left_energy - right_energy) + abs(top_energy - bottom_energy)

    return np.array([
        cx, cy, light_spread,
        light_concentration, light_asymmetry,
    ], dtype=np.float32)
