"""Tests for quality-edge analysis channel (v4.4i)."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.quality_edge import (
    compute_image_quality_edge, compute_blur_sharpness, compute_edge_stats,
    compute_local_contrast, compute_hue_coverage, compute_scores_with_histogram,
    build_quality_edge_matrix,
)
from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import get_active_feature_names


@pytest.fixture
def test_images(tmp_path):
    """Create test images: sharp, blurry, solid color, line art, high contrast."""
    from PIL import Image, ImageDraw, ImageFilter
    rng = np.random.RandomState(42)

    # Sharp image with detail
    sharp = Image.new("RGB", (128, 128), color=(200, 200, 200))
    draw = ImageDraw.Draw(sharp)
    for _ in range(200):
        x, y = rng.randint(0, 128, 2)
        draw.point((x, y), fill=(rng.randint(0, 255),) * 3)
    sharp.save(str(tmp_path / "sharp.jpg"))

    # Blurry image (Gaussian blur applied)
    blurry = sharp.filter(ImageFilter.GaussianBlur(radius=8))
    blurry.save(str(tmp_path / "blurry.jpg"))

    # Solid color (low edge, flat)
    solid = Image.new("RGB", (64, 64), color=(128, 128, 128))
    solid.save(str(tmp_path / "solid.jpg"))

    # Line art (high edge density)
    lineart = Image.new("RGB", (64, 64), color=(255, 255, 255))
    draw = ImageDraw.Draw(lineart)
    for x in range(0, 64, 4):
        draw.line([(x, 0), (x, 63)], fill=(0, 0, 0), width=1)
    for y in range(0, 64, 4):
        draw.line([(0, y), (63, y)], fill=(0, 0, 0), width=1)
    lineart.save(str(tmp_path / "lineart.jpg"))

    # High contrast (black and white blocks)
    hc = Image.new("RGB", (64, 64), color=(255, 255, 255))
    draw = ImageDraw.Draw(hc)
    draw.rectangle([0, 0, 31, 63], fill=(0, 0, 0))
    hc.save(str(tmp_path / "high_contrast.jpg"))

    # Colorful image (high hue coverage)
    colorful = Image.new("RGB", (64, 64), color=(255, 0, 0))
    draw = ImageDraw.Draw(colorful)
    draw.rectangle([0, 0, 31, 31], fill=(0, 255, 0))
    draw.rectangle([32, 0, 63, 31], fill=(0, 0, 255))
    colorful.save(str(tmp_path / "colorful.jpg"))

    return tmp_path


class TestQualityEdge:
    """Core quality-edge computations."""

    def test_generates_csv(self, test_images):
        """build_quality_edge_matrix should produce a DataFrame."""
        paths = sorted(test_images.glob("*"))
        iids, vpaths, skipped, df, meta = build_quality_edge_matrix(paths, max_side=512)
        assert len(df) >= 5
        for col in ["blur_laplacian_var", "sharpness_score", "edge_density",
                      "edge_strength_mean", "local_contrast_p95", "hue_coverage"]:
            assert col in df.columns, f"Missing: {col}"

    def test_blurry_lower_than_sharp(self, test_images):
        """Blurry image should have lower blur_laplacian_var than sharp."""
        sharp_result = compute_image_quality_edge(str(test_images / "sharp.jpg"))
        blurry_result = compute_image_quality_edge(str(test_images / "blurry.jpg"))
        assert sharp_result["blur_laplacian_var"] > 0
        assert blurry_result["blur_laplacian_var"] < sharp_result["blur_laplacian_var"]

    def test_edge_density_for_lineart(self, test_images):
        """Line art should have higher edge_density than solid color."""
        lineart_result = compute_image_quality_edge(str(test_images / "lineart.jpg"))
        solid_result = compute_image_quality_edge(str(test_images / "solid.jpg"))
        assert lineart_result["edge_density"] > solid_result["edge_density"]

    def test_local_contrast_for_high_contrast(self, test_images):
        """High contrast image should have higher local_contrast_p95 than solid."""
        hc_result = compute_image_quality_edge(str(test_images / "high_contrast.jpg"))
        solid_result = compute_image_quality_edge(str(test_images / "solid.jpg"))
        assert hc_result["local_contrast_p95"] > solid_result["local_contrast_p95"]

    def test_hue_coverage_colorful_vs_gray(self, test_images):
        """Colorful image should have higher hue_coverage than grayscale."""
        colorful_result = compute_image_quality_edge(str(test_images / "colorful.jpg"))
        solid_result = compute_image_quality_edge(str(test_images / "solid.jpg"))
        assert colorful_result["hue_coverage"] > solid_result["hue_coverage"]

    def test_broken_image_skipped(self, test_images, tmp_path):
        """Broken image should be skipped, not crash."""
        bad = tmp_path / "broken.jpg"
        bad.write_text("not an image")
        result = compute_image_quality_edge(str(bad))
        assert "error" in result

    def test_scores_with_histogram(self):
        """compute_scores_with_histogram should produce lineart/hc/flat scores."""
        hist = {"brightness_bright_ratio": 0.6, "brightness_dark_ratio": 0.3, "saturation_low_ratio": 0.7}
        scores = compute_scores_with_histogram(hist, edge_density=0.2, local_contrast_p95=0.05)
        for key in ["lineart_score_v2", "high_contrast_score_v2", "flat_color_score"]:
            assert key in scores

    def test_scores_without_histogram(self):
        """Without histogram, scores should still produce values."""
        scores = compute_scores_with_histogram(None, edge_density=0.1, local_contrast_p95=0.03)
        for key in ["lineart_score_v2", "high_contrast_score_v2", "flat_color_score"]:
            assert key in scores

    def test_histogram_merging(self, test_images, tmp_path):
        """When histogram_summary is provided, fields should be merged."""
        # Create a mock histogram_summary.csv
        paths = sorted(test_images.glob("*"))
        hist_df = pd.DataFrame({
            "image_path": [str(p) for p in paths],
            "brightness_bright_ratio": [0.5] * len(paths),
            "brightness_dark_ratio": [0.3] * len(paths),
            "saturation_low_ratio": [0.6] * len(paths),
        })
        iids, vpaths, skipped, df, meta = build_quality_edge_matrix(paths, max_side=512, histogram_summary=hist_df)
        assert len(df) == len(paths)


class TestDefaultClustering:
    """Default clustering unchanged."""

    def test_no_quality_edge_in_clustering(self):
        """Quality-edge specific fields must not be in clustering features."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        qe_specific = ["blur_laplacian_var", "sharpness_score", "edge_density",
                        "local_contrast", "hue_coverage", "lineart_score",
                        "high_contrast_score_v2", "flat_color_score", "quality_edge"]
        for qe in qe_specific:
            assert not any(qe in n.lower() for n in names), f"Found {qe} in clustering features"

    def test_dims_still_16(self):
        """Total dims still 16."""
        total = sum(g["dims"] for g in CONFIG["feature_groups"].values()
                     if g.get("enabled") and g.get("cluster", True))
        assert total == 16
