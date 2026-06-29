"""亮度-深度耦合特征（核心）— Light Analysis Engine v3

核心思想：亮度变化 + 深度变化的耦合关系 = 判断光影真实性的数学依据。
  - depth_lighting_corr: 在高梯度区域，亮度梯度与深度梯度的 Pearson 相关性
  - high_gradient_depth_var: 在高梯度区域的深度方差
"""

import logging
from typing import List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("LightAnalysisEngine")


def compute_coupling_features(
    img_rgb: np.ndarray,
    depth_map: Optional[np.ndarray]
) -> np.ndarray:
    """
    计算亮度-深度耦合特征（2维）

    参数:
        img_rgb: [H, W, 3] float32 (0~1)
        depth_map: [H, W] float32 或 None（则返回 0）

    返回:
        [depth_lighting_corr, high_gradient_depth_var]
    """
    if depth_map is None:
        return np.array([0.0, 0.0], dtype=np.float32)

    # L 通道
    lab = cv2.cvtColor((img_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
    L = lab[:, :, 0].astype(np.float32) / 255.0

    # 确保深度图和亮度图尺寸一致
    if depth_map.shape[:2] != L.shape[:2]:
        depth_map = cv2.resize(depth_map, (L.shape[1], L.shape[0]),
                               interpolation=cv2.INTER_LINEAR)

    # 亮度梯度
    sobel_x = cv2.Sobel(L, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(L, cv2.CV_64F, 0, 1, ksize=3)
    brightness_grad = np.sqrt(sobel_x**2 + sobel_y**2)

    # 深度梯度
    d_sobel_x = cv2.Sobel(depth_map, cv2.CV_64F, 1, 0, ksize=3)
    d_sobel_y = cv2.Sobel(depth_map, cv2.CV_64F, 0, 1, ksize=3)
    depth_grad = np.sqrt(d_sobel_x**2 + d_sobel_y**2)

    # 在高亮度梯度区域采样（前 10%）
    threshold = float(np.percentile(brightness_grad, 90))
    mask = brightness_grad > threshold

    if mask.sum() > 10:
        bg = brightness_grad[mask].flatten()
        dg = depth_grad[mask].flatten()
        depth_lighting_corr = float(np.corrcoef(bg, dg)[0, 1])
        high_gradient_depth_var = float(np.var(depth_map[mask]))
    else:
        depth_lighting_corr = 0.0
        high_gradient_depth_var = 0.0

    return np.array([depth_lighting_corr, high_gradient_depth_var], dtype=np.float32)


def compute_coupling_batch(
    images: List,
    depth_maps: List[Optional[np.ndarray]]
) -> np.ndarray:
    """批量计算耦合特征"""
    n = len(images)
    features = np.zeros((n, 2), dtype=np.float32)

    for i, (_, img) in enumerate(images):
        depth = depth_maps[i] if i < len(depth_maps) else None
        features[i] = compute_coupling_features(img, depth)

    return features


def compute_depth_consistency_label(
    high_gradient_depth_var: float,
    depth_confidence_mean: float,
    var_threshold: float = 0.01,
    conf_threshold: float = 0.5
) -> str:
    """
    深度一致性辅助标签
      - Cast Shadow（投影阴影）: var低  ∧ conf高
      - Form Shadow（结构阴影）: var高  ∧ conf高
      - Fake Shadow（AI伪影）  : conf低
    """
    if depth_confidence_mean < conf_threshold:
        return "fake_shadow"
    elif high_gradient_depth_var < var_threshold:
        return "cast_shadow"
    else:
        return "form_shadow"
