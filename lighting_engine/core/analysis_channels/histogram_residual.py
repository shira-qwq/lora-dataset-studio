"""Histogram Residual Channel — side-channel histogram analysis.

Provides 4 core functions:
1. compute_image_histograms(path) — per-image brightness/sat/hue histograms
2. build_histogram_matrix(paths) — build N×B matrix from image list
3. compute_histogram_residuals(matrix) — mean/std/residual/z_residual/outlier
4. compute_histogram_summary(...) — per-image summary DataFrame + labels

This is a SIDE CHANNEL — it does NOT participate in default 16-dim clustering.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .histogram_label_config import DEFAULT_LABEL_CONFIG, HistogramLabelConfig

# ============================================================
# Constants
# ============================================================

BRIGHTNESS_BINS = 16
SATURATION_BINS = 16
HUE_BINS = 24

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

# Hue bin mapping for warm/cool (heuristic)
# 24 bins over [0, 360), each bin = 15 degrees
# Warm: red(0-30), orange(30-45), yellow(45-75)  → bins 0-4
# Cool: cyan(165-195), blue(195-270), purple(270-315) → bins 11-20
WARM_BINS = list(range(0, 5))     # 0-60°
COOL_BINS = list(range(11, 21))   # 165-300°

EPS = 1e-6


# ============================================================
# Function 1: Per-image histograms
# ============================================================

def _read_image_safe(path: Path, max_side: int) -> Optional[Tuple[np.ndarray, int, int]]:
    """Read and resize image, returning (RGB_float32, w, h) or None."""
    try:
        import cv2
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return img_rgb, img.shape[1], img.shape[0]
    except Exception:
        return None


def _brightness_hist(img_rgb: np.ndarray, bins: int) -> np.ndarray:
    """Brightness histogram from grayscale luminance."""
    gray = 0.299 * img_rgb[..., 0] + 0.587 * img_rgb[..., 1] + 0.114 * img_rgb[..., 2]
    hist, _ = np.histogram(gray.ravel(), bins=bins, range=(0.0, 1.0), density=False)
    hist = hist.astype(np.float32)
    s = float(np.sum(hist))
    return hist / s if s > 0 else np.zeros(bins, dtype=np.float32)


def _saturation_hist(img_rgb: np.ndarray, bins: int) -> np.ndarray:
    """Saturation histogram from HSV S channel."""
    import cv2
    img_u8 = np.clip(img_rgb * 255.0, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(img_u8, cv2.COLOR_RGB2HSV).astype(np.float32)
    s = hsv[..., 1] / 255.0
    hist, _ = np.histogram(s.ravel(), bins=bins, range=(0.0, 1.0), density=False)
    hist = hist.astype(np.float32)
    s_sum = float(np.sum(hist))
    return hist / s_sum if s_sum > 0 else np.zeros(bins, dtype=np.float32)


def _hue_hist(img_rgb: np.ndarray, bins: int) -> Tuple[np.ndarray, bool]:
    """Hue histogram from HSV H channel, filtered by S and V.

    Returns (hist, is_valid).
    """
    import cv2
    img_u8 = np.clip(img_rgb * 255.0, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(img_u8, cv2.COLOR_RGB2HSV).astype(np.float32)
    h = hsv[..., 0]  # 0-180 (OpenCV)
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0

    mask = (s > 0.12) & (v > 0.08)
    valid_pixels = int(np.sum(mask))

    if valid_pixels < 32:
        return np.zeros(bins, dtype=np.float32), False

    # OpenCV H is 0-180, map to 0-360
    h_valid = (h[mask] / 180.0) * 360.0
    hist, _ = np.histogram(h_valid, bins=bins, range=(0.0, 360.0), density=False)
    hist = hist.astype(np.float32)
    s_sum = float(np.sum(hist))
    return hist / s_sum, True


def compute_image_histograms(
    image_path: str | Path,
    max_side: int = 512,
) -> dict:
    """Compute brightness, saturation, and hue histograms for a single image.

    Returns dict with keys:
        brightness_hist_16, saturation_hist_16, hue_hist_24,
        width, height, hue_valid, error (if applicable)
    """
    path = Path(image_path)
    if not path.exists():
        return {"error": "file_not_found", "width": 0, "height": 0}

    result = _read_image_safe(path, max_side)
    if result is None:
        return {"error": "cannot_read", "width": 0, "height": 0}

    img_rgb, w, h = result

    brightness_hist = _brightness_hist(img_rgb, BRIGHTNESS_BINS)
    saturation_hist = _saturation_hist(img_rgb, SATURATION_BINS)
    hue_hist, hue_valid = _hue_hist(img_rgb, HUE_BINS)

    return {
        "brightness_hist_16": brightness_hist,
        "saturation_hist_16": saturation_hist,
        "hue_hist_24": hue_hist,
        "hue_valid": hue_valid,
        "width": w,
        "height": h,
    }


# ============================================================
# Function 2: Build histogram matrix from image list
# ============================================================

def build_histogram_matrix(
    image_paths: List[Path],
    max_side: int = 512,
) -> Tuple[List[str], List[Path], List[dict],
            np.ndarray, np.ndarray, np.ndarray, List[dict]]:
    """Build histogram matrices from a list of image paths.

    Args:
        image_paths: sorted list of image paths
        max_side: resize long side to this

    Returns:
        image_ids: list of str ids
        valid_paths: list of paths that were processed successfully
        skipped: list of dicts with path and reason
        brightness_matrix: shape (N, 16)
        saturation_matrix: shape (N, 16)
        hue_matrix: shape (N, 24)
        image_info: list of dicts with width, height, hue_valid for each valid image
    """
    image_ids = []
    valid_paths = []
    skipped = []
    b_list, s_list, h_list = [], [], []
    info_list = []

    for idx, path in enumerate(image_paths):
        img_id = f"img_{idx:06d}"
        ext = path.suffix.lower()
        if ext not in VALID_EXTENSIONS:
            skipped.append({"image_path": str(path), "reason": f"unsupported_extension: {ext}"})
            continue

        result = compute_image_histograms(str(path), max_side)
        if "error" in result:
            skipped.append({"image_path": str(path), "reason": result["error"]})
            continue

        image_ids.append(img_id)
        valid_paths.append(path)
        b_list.append(result["brightness_hist_16"])
        s_list.append(result["saturation_hist_16"])
        h_list.append(result["hue_hist_24"])
        info_list.append({
            "width": result["width"],
            "height": result["height"],
            "hue_valid": result["hue_valid"],
        })

    brightness_matrix = np.array(b_list, dtype=np.float32) if b_list else np.zeros((0, BRIGHTNESS_BINS), dtype=np.float32)
    saturation_matrix = np.array(s_list, dtype=np.float32) if s_list else np.zeros((0, SATURATION_BINS), dtype=np.float32)
    hue_matrix = np.array(h_list, dtype=np.float32) if h_list else np.zeros((0, HUE_BINS), dtype=np.float32)

    return image_ids, valid_paths, skipped, brightness_matrix, saturation_matrix, hue_matrix, info_list


# ============================================================
# Function 3: Compute residuals against dataset mean/std
# ============================================================

def compute_histogram_residuals(matrix: np.ndarray) -> dict:
    """Compute mean, std, residual, z_residual, outlier_score for a histogram matrix.

    Args:
        matrix: shape (N, B) float32

    Returns:
        dict with keys: mean, std, residual, z_residual, outlier_score
    """
    mean = np.mean(matrix, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(matrix, axis=0, dtype=np.float64).astype(np.float32)
    residual = (matrix - mean).astype(np.float32)
    z_residual = (residual / (std + EPS)).astype(np.float32)
    outlier_score = np.linalg.norm(z_residual, axis=1).astype(np.float32)

    return {
        "mean": mean,
        "std": std,
        "residual": residual,
        "z_residual": z_residual,
        "outlier_score": outlier_score,
    }


# ============================================================
# Function 4: Per-image summary DataFrame
# ============================================================

def _hist_entropy(hist: np.ndarray) -> float:
    h = hist + EPS
    return float(-np.sum(h * np.log2(h)))


def compute_histogram_summary(
    image_ids: List[str],
    valid_paths: List[Path],
    brightness_matrix: np.ndarray,
    saturation_matrix: np.ndarray,
    hue_matrix: np.ndarray,
    info_list: List[dict],
    brightness_residuals: dict,
    saturation_residuals: dict,
    hue_residuals: dict,
    label_config: Optional[HistogramLabelConfig] = None,
) -> pd.DataFrame:
    """Compute per-image summary DataFrame with labels.

    Labels use heuristic rules (configurable via label_config).
    Pass a custom HistogramLabelConfig to override thresholds, or use defaults.
    """
    cfg = label_config or DEFAULT_LABEL_CONFIG
    rows = []
    N = len(image_ids)

    for i in range(N):
        b = brightness_matrix[i]
        s = saturation_matrix[i]
        h = hue_matrix[i]
        inf = info_list[i] if i < len(info_list) else {}
        hue_valid = inf.get("hue_valid", False)

        # Brightness ratios
        bright_dark = float(np.sum(b[0:4]))
        bright_mid = float(np.sum(b[4:12]))
        bright_bright = float(np.sum(b[12:16]))

        # Saturation ratios
        sat_low = float(np.sum(s[0:4]))
        sat_mid = float(np.sum(s[4:12]))
        sat_high = float(np.sum(s[12:16]))

        # Hue ratios
        if hue_valid and float(np.sum(h)) > 0:
            hue_warm = float(np.sum(h[WARM_BINS]))
            hue_cool = float(np.sum(h[COOL_BINS]))
            hue_dominant = int(np.argmax(h))
        else:
            hue_warm = 0.0
            hue_cool = 0.0
            hue_dominant = -1

        # Entropy
        b_entropy = _hist_entropy(b)
        s_entropy = _hist_entropy(s)
        h_entropy = _hist_entropy(h) if hue_valid else 0.0

        # Peak count
        b_peak = int(np.sum(b > np.mean(b) * 1.5))

        # Outlier scores
        b_outlier = float(brightness_residuals["outlier_score"][i]) if i < len(brightness_residuals["outlier_score"]) else 0.0
        s_outlier = float(saturation_residuals["outlier_score"][i]) if i < len(saturation_residuals["outlier_score"]) else 0.0
        h_outlier = float(hue_residuals["outlier_score"][i]) if i < len(hue_residuals["outlier_score"]) else 0.0
        hist_outlier = math.sqrt(b_outlier**2 + s_outlier**2 + h_outlier**2)

        # Labels (heuristic, thresholds from config)
        labels = []
        if bright_dark > cfg.low_key_dark_ratio:
            labels.append("low_key")
        if bright_bright > cfg.high_key_bright_ratio:
            labels.append("high_key")
        if bright_dark > cfg.high_contrast_dark_ratio and bright_bright > cfg.high_contrast_bright_ratio:
            labels.append("high_contrast")
        if b_entropy < cfg.flat_light_entropy:
            labels.append("flat_light")
        if sat_low > cfg.muted_low_sat_ratio:
            labels.append("muted")
        if sat_high > cfg.vivid_high_sat_ratio:
            labels.append("vivid")
        if hue_valid and hue_warm > cfg.warm_ratio:
            labels.append("warm")
        if hue_valid and hue_cool > cfg.cool_ratio:
            labels.append("cool")
        if hue_valid and h_entropy > cfg.mixed_color_entropy:
            labels.append("mixed_color")
        if bright_bright > cfg.lineart_bright_ratio and sat_low > cfg.lineart_low_sat_ratio and bright_dark > cfg.lineart_dark_ratio:
            labels.append("lineart_like_candidate")

        row = {
            "image_id": image_ids[i],
            "image_path": str(valid_paths[i]),
            "width": inf.get("width", 0),
            "height": inf.get("height", 0),
            "brightness_dark_ratio": round(bright_dark, 4),
            "brightness_midtone_ratio": round(bright_mid, 4),
            "brightness_bright_ratio": round(bright_bright, 4),
            "brightness_entropy": round(b_entropy, 4),
            "brightness_peak_count": b_peak,
            "brightness_outlier_score": round(b_outlier, 4),
            "saturation_low_ratio": round(sat_low, 4),
            "saturation_mid_ratio": round(sat_mid, 4),
            "saturation_high_ratio": round(sat_high, 4),
            "saturation_entropy": round(s_entropy, 4),
            "saturation_outlier_score": round(s_outlier, 4),
            "hue_warm_ratio": round(hue_warm, 4),
            "hue_cool_ratio": round(hue_cool, 4),
            "hue_entropy": round(h_entropy, 4),
            "hue_dominant_bin": hue_dominant,
            "hue_valid": hue_valid,
            "hue_outlier_score": round(h_outlier, 4),
            "histogram_outlier_score": round(hist_outlier, 4),
            "labels": ";".join(labels) if labels else "unclassified",
        }
        rows.append(row)

    return pd.DataFrame(rows)


# ============================================================
# Reusable label masks (shared between production and calibration)
# ============================================================

def compute_label_masks(
    df: pd.DataFrame,
    label_config: Optional[HistogramLabelConfig] = None,
) -> dict:
    """Compute boolean masks for each heuristic label.

    This is the canonical label computation function, shared between
    the summary generator, the calibrator, and downstream consumers.
    It reads fields from the provided DataFrame.
    """
    cfg = label_config or DEFAULT_LABEL_CONFIG
    masks = {}

    masks["low_key"] = df["brightness_dark_ratio"] > cfg.low_key_dark_ratio
    masks["high_key"] = df["brightness_bright_ratio"] > cfg.high_key_bright_ratio
    masks["high_contrast"] = (
        (df["brightness_dark_ratio"] > cfg.high_contrast_dark_ratio) &
        (df["brightness_bright_ratio"] > cfg.high_contrast_bright_ratio)
    )
    masks["flat_light"] = df["brightness_entropy"] < cfg.flat_light_entropy
    masks["muted"] = df["saturation_low_ratio"] > cfg.muted_low_sat_ratio
    masks["vivid"] = df["saturation_high_ratio"] > cfg.vivid_high_sat_ratio

    hue_valid = df.get("hue_valid", pd.Series(False, index=df.index))
    masks["warm"] = hue_valid & (df["hue_warm_ratio"] > cfg.warm_ratio)
    masks["cool"] = hue_valid & (df["hue_cool_ratio"] > cfg.cool_ratio)
    masks["mixed_color"] = hue_valid & (df["hue_entropy"] > cfg.mixed_color_entropy)

    masks["lineart_like_candidate"] = (
        (df["brightness_bright_ratio"] > cfg.lineart_bright_ratio) &
        (df["saturation_low_ratio"] > cfg.lineart_low_sat_ratio) &
        (df["brightness_dark_ratio"] > cfg.lineart_dark_ratio)
    )
    return masks


def compute_labels_from_masks(masks: dict, df: pd.DataFrame) -> pd.Series:
    """Convert label masks to semicolon-joined label strings."""
    n = len(df)
    result = []
    for i in range(n):
        labels = [name for name, mask in masks.items() if mask[i]]
        result.append(";".join(labels) if labels else "unclassified")
    return pd.Series(result, index=df.index)
