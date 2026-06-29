"""Basic Metadata Analysis Channel (v4.5-ui).

Extracts image-level metadata for sorting/filtering/review.
NOT used for clustering.

Output: basic_metadata_summary.csv

Fields:
- image_path, width, height, megapixels, short_side, long_side,
  aspect_ratio, orientation, file_size_mb, has_alpha,
  transparent_ratio, overexposed_ratio, underexposed_ratio, clipping_ratio
"""

from __future__ import annotations

import csv
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


def find_images(root: Path) -> List[Path]:
    """Recursively find images, sorted for reproducibility."""
    images = []
    for ext in VALID_EXTENSIONS:
        images.extend(root.rglob(f"*{ext}"))
    images.sort(key=str)
    return images


def analyze_single_image(
    image_path: Path,
    image_root: Optional[Path] = None,
    original_path: Optional[Path] = None,
) -> dict:
    """Analyze a single image and return metadata dict.

    Args:
        image_path: Absolute path to the image file (may be a resized copy).
        image_root: If provided, image_path will be stored relative to this.
        original_path: If provided, the original source image (full resolution).
                       Used to populate original_* fields separately.

    Returns:
        dict with all metadata fields. Missing fields are None.
        original_* fields always come from the original source image.
    """
    result = {
        "image_path": str(image_path.relative_to(image_root)) if image_root else str(image_path),
        "width": None,
        "height": None,
        "megapixels": None,
        "short_side": None,
        "long_side": None,
        "aspect_ratio": None,
        "orientation": None,
        "file_size_mb": None,
        "has_alpha": None,
        "transparent_ratio": None,
        "overexposed_ratio": None,
        "underexposed_ratio": None,
        "clipping_ratio": None,
        # Original-source fields (always from the original, not a thumbnail)
        "original_width": None,
        "original_height": None,
        "original_megapixels": None,
        "original_file_size_bytes": None,
        "original_format": None,
    }

    try:
        # File size (from the passed image_path — may be resized copy)
        file_size = image_path.stat().st_size
        result["file_size_mb"] = round(file_size / (1024 * 1024), 4)

        # Determine the path used for original_* fields
        origin_src = original_path if original_path is not None else image_path

        # Original-source metadata (always from the original, full-res image)
        try:
            orig_fs = origin_src.stat().st_size
            result["original_file_size_bytes"] = orig_fs
            with Image.open(origin_src) as orig_img:
                ow, oh = orig_img.size
                result["original_width"] = ow
                result["original_height"] = oh
                result["original_megapixels"] = round(ow * oh / 1_000_000, 4)
                result["original_format"] = orig_img.format or Path(str(origin_src)).suffix.lstrip(".").upper()
        except Exception:
            # If original path fails, fall back to image_path values
            pass

        # Open image with PIL for dimensions and pixel data
        with Image.open(image_path) as img:
            w, h = img.size
            result["width"] = w
            result["height"] = h

            # Short/long side
            short_side = min(w, h)
            long_side = max(w, h)
            result["short_side"] = short_side
            result["long_side"] = long_side

            # Megapixels
            result["megapixels"] = round(w * h / 1_000_000, 4)

            # Aspect ratio (as short/long, always <= 1)
            result["aspect_ratio"] = round(short_side / max(long_side, 1), 6)

            # Orientation
            if w > h:
                result["orientation"] = "landscape"
            elif h > w:
                result["orientation"] = "portrait"
            else:
                result["orientation"] = "square"

            # Alpha channel check
            has_alpha = img.mode in ("RGBA", "LA", "PA") or "A" in img.mode
            result["has_alpha"] = has_alpha

            # For overexposed/underexposed, convert to RGB and sample
            # Use a downsampled version for speed
            max_sample = 256  # max dimension for sampling
            if w > max_sample or h > max_sample:
                ratio = max_sample / max(w, h)
                sample_w = max(1, int(w * ratio))
                sample_h = max(1, int(h * ratio))
                sample = img.resize((sample_w, sample_h), Image.NEAREST)
            else:
                sample = img

            if sample.mode != "RGB":
                sample = sample.convert("RGB")

            pixels = np.array(sample, dtype=np.float32) / 255.0
            total_pixels = pixels.shape[0] * pixels.shape[1]

            # Brightness (luminance approximation)
            brightness = 0.299 * pixels[:, :, 0] + 0.587 * pixels[:, :, 1] + 0.114 * pixels[:, :, 2]

            # Overexposed: brightness > 0.98
            overexposed = float(np.sum(brightness > 0.98)) / max(total_pixels, 1)
            result["overexposed_ratio"] = round(overexposed, 6)

            # Underexposed: brightness < 0.02
            underexposed = float(np.sum(brightness < 0.02)) / max(total_pixels, 1)
            result["underexposed_ratio"] = round(underexposed, 6)

            # Clipping ratio
            result["clipping_ratio"] = round(overexposed + underexposed, 6)

            # Transparent ratio (only for images with alpha)
            if has_alpha:
                # Re-open and get alpha channel
                with Image.open(image_path) as img2:
                    if img2.mode in ("RGBA", "LA"):
                        alpha = np.array(img2.getchannel("A"), dtype=np.float32) / 255.0
                    elif img2.mode == "PA":
                        alpha = np.array(img2.convert("RGBA").getchannel("A"), dtype=np.float32) / 255.0
                    else:
                        alpha = np.ones((h, w), dtype=np.float32)

                    if alpha.size > 0:
                        # Downsample alpha to same size as sample
                        from PIL import Image as PILImage
                        alpha_img = PILImage.fromarray((alpha * 255).astype(np.uint8))
                        if w > max_sample or h > max_sample:
                            alpha_img = alpha_img.resize((sample_w, sample_h), PILImage.NEAREST)
                        alpha_small = np.array(alpha_img, dtype=np.float32) / 255.0
                        transparent = float(np.sum(alpha_small < 0.05)) / max(alpha_small.size, 1)
                        result["transparent_ratio"] = round(transparent, 6)
                    else:
                        result["transparent_ratio"] = 0.0

    except Exception as e:
        # Graceful fallback for any image that can't be read
        pass

    return result


def build_metadata_summary(
    image_paths: List[Path],
    image_root: Optional[Path] = None,
    max_workers: int = 4,
    original_path_map: Optional[dict] = None,
) -> List[dict]:
    """Build metadata summary for a list of images.

    Uses ThreadPoolExecutor for parallel processing.

    Args:
        image_paths: List of image paths to analyze (may be resized copies).
        image_root: Base path for relative image_path storage.
        max_workers: Thread pool size.
        original_path_map: Optional dict mapping str(image_path) -> original Path.
                           If provided, original_* fields are populated from these paths.
    """
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for p in image_paths:
            orig = None
            if original_path_map:
                orig = original_path_map.get(str(p))
            futures[executor.submit(analyze_single_image, p, image_root, orig)] = p
        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
            except Exception:
                pass

    # Sort by image_path for reproducibility
    results.sort(key=lambda r: str(r.get("image_path", "")))
    return results


def write_csv(results: List[dict], output_path: Path):
    """Write metadata results to CSV."""
    if not results:
        # Write header only
        fieldnames = [
            "image_path", "width", "height", "megapixels", "short_side", "long_side",
            "aspect_ratio", "orientation", "file_size_mb", "has_alpha",
            "transparent_ratio", "overexposed_ratio", "underexposed_ratio", "clipping_ratio",
            # Original-source fields
            "original_width", "original_height", "original_megapixels",
            "original_file_size_bytes", "original_format",
        ]
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
        return

    fieldnames = list(results[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)
