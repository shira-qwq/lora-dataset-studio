"""Quality + Edge Analysis Channel (v4.4i).

Side-channel features: blur, edge density, local contrast, hue coverage,
lineart_score_v2, high_contrast_score_v2, flat_color_score.

These do NOT participate in default 16-dim clustering.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import pandas as pd

# ============================================================
# Constants
# ============================================================

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _read_gray_safe(path: Path, max_side: int) -> Optional[np.ndarray]:
    """Read image as grayscale float32, resized to max_side."""
    try:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        return gray, img.shape[1], img.shape[0]
    except Exception:
        return None


def _read_rgb_safe(path: Path, max_side: int) -> Optional[Tuple[np.ndarray, int, int]]:
    """Read image as RGB float32."""
    try:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return rgb, w, h
    except Exception:
        return None


# ============================================================
# A. Blur / Sharpness
# ============================================================

def compute_blur_sharpness(gray: np.ndarray) -> dict:
    """Compute blur and sharpness scores from grayscale image.

    Returns:
        blur_laplacian_var, sharpness_score, is_blurry_candidate (bool)
    """
    gray_u8 = np.clip(gray * 255.0, 0, 255).astype(np.uint8)
    lap_var = float(cv2.Laplacian(gray_u8, cv2.CV_64F).var())
    sharpness = float(np.log1p(lap_var))
    return {"blur_laplacian_var": round(lap_var, 4), "sharpness_score": round(sharpness, 4)}


# ============================================================
# B. Edge density
# ============================================================

def compute_edge_stats(gray: np.ndarray) -> dict:
    """Compute edge density and strength stats.

    Uses Sobel gradient magnitude.
    """
    gray_u8 = np.clip(gray * 255.0, 0, 255).astype(np.uint8)
    sobel_x = cv2.Sobel(gray_u8, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray_u8, cv2.CV_64F, 0, 1, ksize=3)
    grad = np.sqrt(sobel_x**2 + sobel_y**2)

    edge_density = float(np.mean(grad > 0.08))
    edge_mean = float(np.mean(grad))
    edge_p95 = float(np.percentile(grad, 95))
    return {
        "edge_density": round(edge_density, 4),
        "edge_strength_mean": round(edge_mean, 4),
        "edge_strength_p95": round(edge_p95, 4),
    }


# ============================================================
# C. Local contrast
# ============================================================

def compute_local_contrast(gray: np.ndarray, ksize: int = 15) -> dict:
    """Compute local contrast via Gaussian blur difference."""
    gray_u8 = np.clip(gray * 255.0, 0, 255).astype(np.uint8)
    blurred = cv2.GaussianBlur(gray_u8, (ksize, ksize), 0).astype(np.float32) / 255.0
    diff = np.abs(gray - blurred)
    return {
        "local_contrast_mean": round(float(np.mean(diff)), 4),
        "local_contrast_p95": round(float(np.percentile(diff, 95)), 4),
    }


# ============================================================
# D. Hue coverage
# ============================================================

def compute_hue_coverage(rgb: np.ndarray) -> dict:
    """Compute hue_coverage and grayscale_coverage."""
    hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    s, v = hsv[..., 1] / 255.0, hsv[..., 2] / 255.0
    valid = (s > 0.12) & (v > 0.08)
    total = rgb.shape[0] * rgb.shape[1]
    hue_coverage = float(np.sum(valid)) / max(total, 1)
    return {
        "hue_coverage": round(hue_coverage, 4),
        "grayscale_coverage": round(1.0 - hue_coverage, 4),
    }


# ============================================================
# E-G: Score computations (with optional histogram fields)
# ============================================================

def compute_scores_with_histogram(
    hist_fields: Optional[dict],
    edge_density: float,
    local_contrast_p95: float,
) -> dict:
    """Compute lineart_score_v2, high_contrast_score_v2, flat_color_score.

    If hist_fields is None (no histogram_summary available), falls back to
    edge and contrast only.
    """
    if hist_fields:
        bright_ratio = hist_fields.get("brightness_bright_ratio", 0.3)
        dark_ratio = hist_fields.get("brightness_dark_ratio", 0.3)
        sat_low = hist_fields.get("saturation_low_ratio", 0.5)
    else:
        bright_ratio = 0.3
        dark_ratio = 0.3
        sat_low = 0.5

    # Normalize edge and contrast to ~0-1 range (heuristic)
    norm_edge = min(edge_density * 5, 1.0)
    norm_contrast = min(local_contrast_p95 * 20, 1.0)

    # Lineart score v2
    lineart_score = (
        0.35 * bright_ratio +
        0.25 * sat_low +
        0.25 * norm_edge +
        0.15 * norm_contrast
    )

    # High contrast score v2
    hc_score = (
        0.30 * dark_ratio +
        0.30 * bright_ratio +
        0.20 * norm_contrast +
        0.20 * norm_edge
    )

    # Flat color score (low texture, low contrast)
    flat_color = 1.0 - min((norm_edge + norm_contrast) * 0.5, 1.0)

    return {
        "lineart_score_v2": round(lineart_score, 4),
        "high_contrast_score_v2": round(hc_score, 4),
        "flat_color_score": round(flat_color, 4),
    }


# ============================================================
# Per-image computation
# ============================================================

def compute_image_quality_edge(
    image_path: str | Path,
    max_side: int = 512,
) -> dict:
    """Compute all quality/edge features for a single image.

    Returns dict with keys: blur_laplacian_var, sharpness_score,
    edge_density, edge_strength_mean, edge_strength_p95,
    local_contrast_mean, local_contrast_p95, hue_coverage,
    grayscale_coverage, width, height.
    """
    path = Path(image_path)
    if not path.exists():
        return {"error": "file_not_found"}

    # RGB for hue coverage
    rgb_result = _read_rgb_safe(path, max_side)
    if rgb_result is None:
        return {"error": "cannot_read"}

    rgb, w, h = rgb_result
    gray = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0

    result = {"width": w, "height": h}
    result.update(compute_blur_sharpness(gray))
    result.update(compute_edge_stats(gray))
    result.update(compute_local_contrast(gray))
    result.update(compute_hue_coverage(rgb))
    return result


def build_quality_edge_matrix(
    image_paths: List[Path],
    max_side: int = 512,
    histogram_summary: Optional[pd.DataFrame] = None,
) -> Tuple[List[str], List[Path], List[dict], pd.DataFrame, dict]:
    """Build quality-edge DataFrame from image paths.

    If histogram_summary is provided, merges histogram fields by image_path
    to compute enriched scores (lineart_score_v2, high_contrast_score_v2).
    """
    image_ids = []
    valid_paths = []
    skipped = []
    rows = []

    hist_lookup = {}
    if histogram_summary is not None and "image_path" in histogram_summary.columns:
        for _, r in histogram_summary.iterrows():
            hist_lookup[str(r["image_path"])] = r

    for idx, path in enumerate(image_paths):
        path = Path(path)
        ext = path.suffix.lower()
        if ext not in VALID_EXTENSIONS:
            skipped.append({"image_path": str(path), "reason": f"unsupported: {ext}"})
            continue

        result = compute_image_quality_edge(str(path), max_side)
        if "error" in result:
            skipped.append({"image_path": str(path), "reason": result["error"]})
            continue

        img_id = f"qe_{idx:06d}"
        image_ids.append(img_id)
        valid_paths.append(path)

        row = {"image_id": img_id, "image_path": str(path)}
        row.update(result)

        # Merge histogram fields if available
        hist_row = hist_lookup.get(str(path))
        hist_fields = None
        if hist_row is not None:
            hist_fields = {
                "brightness_bright_ratio": float(hist_row.get("brightness_bright_ratio", 0.3)),
                "brightness_dark_ratio": float(hist_row.get("brightness_dark_ratio", 0.3)),
                "saturation_low_ratio": float(hist_row.get("saturation_low_ratio", 0.5)),
            }
            row["_hist_found"] = True
        else:
            row["_hist_found"] = False

        # Compute scores with or without histogram
        scores = compute_scores_with_histogram(hist_fields, row.get("edge_density", 0), row.get("local_contrast_p95", 0))
        row.update(scores)

        # Labels
        labels = []
        if row.get("is_blurry_candidate", False):
            labels.append("blurry")
        if row.get("sharpness_score", 0) > 4.0:
            labels.append("sharp")
        if row.get("edge_density", 0) > 0.15:
            labels.append("edge_heavy")
        if row.get("lineart_score_v2", 0) > 0.55:
            labels.append("lineart_v2")
        if row.get("high_contrast_score_v2", 0) > 0.55:
            labels.append("high_contrast_v2")
        row["quality_edge_labels"] = ";".join(labels) if labels else "normal"

        rows.append(row)

    # Build blur classification (dataset-relative)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    if not df.empty and "sharpness_score" in df.columns:
        p10 = df["sharpness_score"].quantile(0.10)
        df["is_blurry_candidate"] = df["sharpness_score"] < p10

    return image_ids, valid_paths, skipped, df, {"image_count": len(valid_paths), "skipped_count": len(skipped)}
