"""特征提取模块 — 亮度/光影/色彩特征（不含DA3）— Light Analysis Engine v3"""

import logging
from typing import Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed

import cv2
import numpy as np
from tqdm import tqdm

logger = logging.getLogger("LightAnalysisEngine")


def extract_brightness_features(L: np.ndarray) -> np.ndarray:
    """
    亮度结构（4维）
    L: [H, W] float32, 范围 0~1 (LAB-L 通道 / 255)
    """
    flat = L.flatten()
    p10 = float(np.percentile(flat, 10))
    p90 = float(np.percentile(flat, 90))
    return np.array([
        float(np.mean(flat)),     # brightness_mean
        float(np.std(flat)),      # brightness_std
        p10,                       # brightness_p10
        p90,                       # brightness_p90
    ], dtype=np.float32)


def extract_lighting_features(L: np.ndarray) -> np.ndarray:
    """
    光影结构（4维）
    """
    flat = L.flatten()
    p10 = float(np.percentile(flat, 10))
    p50 = float(np.percentile(flat, 50))
    p90 = float(np.percentile(flat, 90))

    # contrast
    denom = max(p50, 0.01)
    contrast = (p90 - p10) / denom

    # shadow_ratio
    shadow_thresh = float(np.percentile(flat, 20))
    shadow_ratio = float(np.mean(flat < shadow_thresh))

    # highlight_ratio
    highlight_thresh = float(np.percentile(flat, 90))
    highlight_ratio = float(np.mean(flat > highlight_thresh))

    # hard_edge_ratio (Sobel)
    sobel_x = cv2.Sobel(L, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(L, cv2.CV_64F, 0, 1, ksize=3)
    sobel_mag = np.sqrt(sobel_x**2 + sobel_y**2)
    edge_thresh = float(np.percentile(sobel_mag, 85))
    hard_edge_ratio = float(np.mean(sobel_mag > edge_thresh))

    return np.array([
        contrast,
        shadow_ratio,
        highlight_ratio,
        hard_edge_ratio,
    ], dtype=np.float32)


def extract_color_features(img_rgb: np.ndarray) -> np.ndarray:
    """
    色彩结构（3维）
    img_rgb: [H, W, 3] float32 (0~1)
    """
    # warm_cool_bias = mean(R - B)
    warm_cool = float(np.mean(img_rgb[:, :, 0] - img_rgb[:, :, 2]))

    # HSV 饱和度
    hsv = cv2.cvtColor((img_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    S = hsv[:, :, 1].astype(np.float32) / 255.0

    saturation_mean = float(np.mean(S))
    saturation_std = float(np.std(S))

    return np.array([
        warm_cool,
        saturation_mean,
        saturation_std,
    ], dtype=np.float32)


def extract_non_depth_features(
    img_rgb: np.ndarray
) -> np.ndarray:
    """
    提取非深度特征：亮度4 + 光影4 + 色彩3 = 11维
    """
    # L 通道 (LAB)
    lab = cv2.cvtColor((img_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
    L = lab[:, :, 0].astype(np.float32) / 255.0

    bright = extract_brightness_features(L)
    light = extract_lighting_features(L)
    color = extract_color_features(img_rgb)

    return np.concatenate([bright, light, color])  # 11维


def extract_non_depth_batch(
    images: list,
    max_workers: int = 4
) -> np.ndarray:
    """批量提取非深度特征，支持多进程"""
    n = len(images)
    features = np.zeros((n, 11), dtype=np.float32)

    if max_workers <= 1:
        for i, (_, img) in enumerate(images):
            features[i] = extract_non_depth_features(img)
    else:
        with ProcessPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(extract_non_depth_features, img): i
                for i, (_, img) in enumerate(images)
            }
            for f in tqdm(as_completed(futures), total=len(futures),
                          desc="Extract features", unit="img"):
                idx = futures[f]
                features[idx] = f.result()

    return features
