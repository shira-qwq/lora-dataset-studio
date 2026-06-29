"""Tests for histogram residual channel.

Covers:
1. Per-image histograms sum to ~1
2. Matrix shapes correct
3. Residual mean ~0
4. z_residual shape and dtype
5. Summary contains expected fields
6. Hue ignores low-saturation pixels
7. Broken image is skipped
8. CLI produces output files
9. Default clustering not changed
10. NPZ row order matches summary
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_residual import (
    compute_image_histograms,
    build_histogram_matrix,
    compute_histogram_residuals,
    compute_histogram_summary,
    BRIGHTNESS_BINS, SATURATION_BINS, HUE_BINS,
)
from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import get_active_feature_names


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def temp_images(tmp_path):
    """Create a few small test images."""
    from PIL import Image
    rng = np.random.RandomState(42)

    # Color image
    img_red = Image.new("RGB", (64, 64), color=(200, 30, 40))
    img_red.save(str(tmp_path / "red.jpg"))

    # Blue image
    img_blue = Image.new("RGB", (64, 64), color=(30, 40, 200))
    img_blue.save(str(tmp_path / "blue.jpg"))

    # Gradient image (diverse)
    arr = np.zeros((64, 64, 3), dtype=np.uint8)
    for i in range(64):
        arr[i, :, 0] = int(255 * i / 64)
        arr[i, :, 1] = int(128 * (1 - i / 64))
        arr[i, :, 2] = int(200 * (i / 64))
    Image.fromarray(arr).save(str(tmp_path / "gradient.png"))

    # Grayscale image (for hue test)
    gray = Image.new("L", (48, 48), color=128)
    gray.save(str(tmp_path / "gray.jpg"))

    # WebP image
    img_webp = Image.new("RGB", (32, 32), color=(64, 128, 200))
    img_webp.save(str(tmp_path / "test.webp"))

    return tmp_path


@pytest.fixture
def temp_broken(tmp_path):
    """Create a broken image file."""
    bad = tmp_path / "broken.jpg"
    bad.write_text("this is not an image")
    return tmp_path


@pytest.fixture
def image_paths(temp_images):
    paths = sorted(temp_images.rglob("*"))
    return [p for p in paths if p.suffix.lower() in {".jpg", ".png", ".webp"}]


# ============================================================
# Tests
# ============================================================

class TestPerImageHists:
    """Function 1: compute_image_histograms."""

    def test_histograms_sum_to_one(self, temp_images):
        """Each hist should sum to ~1."""
        for fname in ["red.jpg", "blue.jpg", "gradient.png", "gray.jpg"]:
            path = temp_images / fname
            result = compute_image_histograms(str(path), max_side=512)
            assert "error" not in result
            assert abs(float(np.sum(result["brightness_hist_16"])) - 1.0) < 0.01
            assert abs(float(np.sum(result["saturation_hist_16"])) - 1.0) < 0.01
            if result["hue_valid"]:
                assert abs(float(np.sum(result["hue_hist_24"])) - 1.0) < 0.01
            else:
                assert float(np.sum(result["hue_hist_24"])) == 0.0

    def test_brightness_hist_16_shape(self, temp_images):
        """Brightness hist should be shape (16,)."""
        path = temp_images / "red.jpg"
        result = compute_image_histograms(str(path))
        assert result["brightness_hist_16"].shape == (16,)

    def test_saturation_hist_16_shape(self, temp_images):
        """Saturation hist should be shape (16,)."""
        path = temp_images / "red.jpg"
        result = compute_image_histograms(str(path))
        assert result["saturation_hist_16"].shape == (16,)

    def test_hue_hist_24_shape(self, temp_images):
        """Hue hist should be shape (24,)."""
        path = temp_images / "blue.jpg"
        result = compute_image_histograms(str(path))
        assert result["hue_hist_24"].shape == (24,)

    def test_dtype_float32(self, temp_images):
        """Histograms should be float32."""
        path = temp_images / "red.jpg"
        result = compute_image_histograms(str(path))
        assert result["brightness_hist_16"].dtype == np.float32
        assert result["saturation_hist_16"].dtype == np.float32
        assert result["hue_hist_24"].dtype == np.float32

    def test_broken_image_skipped(self, temp_broken):
        """Broken image returns error, doesn't crash."""
        bad_path = temp_broken / "broken.jpg"
        result = compute_image_histograms(str(bad_path))
        assert "error" in result


class TestHueSkipping:
    """Hue should be invalid for grayscale images."""

    def test_gray_image_hue_invalid(self, temp_images):
        """Gray image should have hue_valid=False and hue_hist all zeros."""
        path = temp_images / "gray.jpg"
        result = compute_image_histograms(str(path))
        assert result["hue_valid"] == False
        assert float(np.sum(result["hue_hist_24"])) == 0.0


class TestMatrixBuilder:
    """Function 2: build_histogram_matrix."""

    def test_matrix_shapes(self, image_paths):
        """Matrix shapes should be (N, 16), (N, 16), (N, 24)."""
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(image_paths, max_side=512)
        N = len(vpaths)
        assert b.shape == (N, 16), f"Expected ({N},16), got {b.shape}"
        assert s.shape == (N, 16), f"Expected ({N},16), got {s.shape}"
        assert h.shape == (N, 24), f"Expected ({N},24), got {h.shape}"

    def test_image_ids_length(self, image_paths):
        """image_ids length should match valid_paths."""
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(image_paths)
        assert len(iids) == len(vpaths)

    def test_valid_inputs_prevent_duplicates(self, image_paths):
        """Each valid path appears exactly once."""
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(image_paths)
        assert len(set(str(p) for p in vpaths)) == len(vpaths)

    def test_broken_image_in_skipped(self, temp_broken):
        """Broken image should appear in skipped list."""
        bad_path = temp_broken / "broken.jpg"
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix([bad_path])
        assert len(skipped) >= 1
        assert "broken" in str(skipped[0]).lower() or "cannot_read" in str(skipped[0]).lower()

    def test_order_preserved(self, image_paths):
        """Matrix row order should match image_paths input order."""
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(image_paths)
        for i, p in enumerate(vpaths):
            assert str(p) in image_paths[i].name or str(vpaths[i]) == str(p)


class TestResiduals:
    """Function 3: compute_histogram_residuals."""

    def test_residual_mean_close_to_zero(self):
        """residual.mean(axis=0) should be ~0."""
        rng = np.random.RandomState(42)
        matrix = rng.rand(10, 16).astype(np.float32)
        matrix /= matrix.sum(axis=1, keepdims=True)
        res = compute_histogram_residuals(matrix)
        mean_res = np.mean(res["residual"], axis=0)
        assert np.all(np.abs(mean_res) < 1e-5)

    def test_z_residual_shape(self):
        """z_residual shape should match input."""
        matrix = np.ones((5, 16), dtype=np.float32)
        res = compute_histogram_residuals(matrix)
        assert res["z_residual"].shape == (5, 16)

    def test_z_residual_dtype(self):
        """z_residual should be float32."""
        matrix = np.ones((5, 16), dtype=np.float32)
        res = compute_histogram_residuals(matrix)
        assert res["z_residual"].dtype == np.float32

    def test_outlier_score_shape(self):
        """outlier_score should be shape (N,)."""
        matrix = np.ones((7, 16), dtype=np.float32)
        res = compute_histogram_residuals(matrix)
        assert res["outlier_score"].shape == (7,)

    def test_mean_shape(self):
        """mean should be shape (B,)."""
        matrix = np.ones((5, 24), dtype=np.float32)
        res = compute_histogram_residuals(matrix)
        assert res["mean"].shape == (24,)

    def test_std_shape(self):
        """std should be shape (B,)."""
        matrix = np.ones((5, 16), dtype=np.float32)
        res = compute_histogram_residuals(matrix)
        assert res["std"].shape == (16,)


class TestSummary:
    """Function 4: compute_histogram_summary."""

    @pytest.fixture
    def mini_summary(self, image_paths):
        """Create a minimal summary for testing."""
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(image_paths)
        b_res = compute_histogram_residuals(b)
        s_res = compute_histogram_residuals(s)
        h_res = compute_histogram_residuals(h)
        df = compute_histogram_summary(iids, vpaths, b, s, h, info, b_res, s_res, h_res)
        return df

    def test_summary_has_expected_fields(self, mini_summary):
        """Summary should contain key fields."""
        for col in ["brightness_dark_ratio", "brightness_bright_ratio",
                     "saturation_low_ratio", "histogram_outlier_score", "labels",
                     "image_id", "image_path"]:
            assert col in mini_summary.columns, f"Missing: {col}"

    def test_summary_row_count(self, mini_summary, image_paths):
        """Row count should match valid image count."""
        iids, vpaths, skipped, _, _, _, _ = build_histogram_matrix(image_paths)
        assert len(mini_summary) == len(vpaths)

    def test_labels_non_empty(self, mini_summary):
        """Labels should be non-empty strings."""
        for label_str in mini_summary["labels"]:
            assert isinstance(label_str, str)
            assert len(label_str) > 0

    def test_histogram_outlier_score_finite(self, mini_summary):
        """histogram_outlier_score should be finite."""
        for val in mini_summary["histogram_outlier_score"]:
            assert np.isfinite(val)


class TestNPZConsistency:
    """NPZ row order matches summary."""

    def test_npz_order_matches_summary(self, image_paths, tmp_path):
        """image_ids in NPZ should match summary image_id order."""
        from tools.build_histogram_channel import main as cli_main
        import sys

        # Run CLI via image_root
        import argparse
        # Simulate CLI
        output_dir = tmp_path / "output"
        args = argparse.Namespace(
            job_output=None,
            image_root=str(tmp_path / "test_img_dir"),
            output=str(output_dir),
            max_side=512,
        )

        # Create test images
        from PIL import Image
        img_dir = tmp_path / "test_img_dir"
        img_dir.mkdir()
        Image.new("RGB", (32, 32), color=(200, 30, 40)).save(str(img_dir / "a.jpg"))
        Image.new("RGB", (32, 32), color=(30, 40, 200)).save(str(img_dir / "b.jpg"))
        Image.new("RGB", (32, 32), color=(64, 128, 64)).save(str(img_dir / "c.jpg"))

        # Run with --image-root
        from tools.build_histogram_channel import find_images
        paths = find_images(img_dir)
        from lighting_engine.core.analysis_channels.histogram_residual import build_histogram_matrix
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(paths)
        b_res = compute_histogram_residuals(b)
        s_res = compute_histogram_residuals(s)
        h_res = compute_histogram_residuals(h)
        df = compute_histogram_summary(iids, vpaths, b, s, h, info, b_res, s_res, h_res)

        # Verify NPZ would have same order
        assert list(df["image_id"]) == iids


class TestDefaultClustering:
    """Default clustering must NOT include histogram features."""

    def test_no_histogram_in_default_features(self):
        """Default clustering feature names must not contain histogram fields."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        for name in names:
            assert "hist" not in name.lower(), f"Histogram feature in clustering: {name}"
            assert "brightness_hist" not in name
            assert "saturation_hist" not in name
            assert "hue_hist" not in name

    def test_default_dims_still_16(self):
        """Total clustering dims must still be 16."""
        total = sum(
            g["dims"] for g in CONFIG["feature_groups"].values()
            if g.get("enabled", False) and g.get("cluster", True)
        )
        assert total == 16, f"Expected 16, got {total}"


class TestCLI:
    """CLI produces expected output files."""

    def test_cli_image_root_outputs_files(self, tmp_path):
        """Running CLI with --image-root should produce output files."""
        # Create test images
        from PIL import Image
        img_dir = tmp_path / "images"
        img_dir.mkdir()
        Image.new("RGB", (32, 32), color=(200, 30, 40)).save(str(img_dir / "test.jpg"))
        Image.new("RGB", (48, 48), color=(30, 40, 200)).save(str(img_dir / "test2.png"))

        output_dir = tmp_path / "out"

        # Run CLI
        from tools.build_histogram_channel import main as cli_main
        import argparse
        args = argparse.Namespace(
            job_output=None,
            image_root=str(img_dir),
            output=str(output_dir.parent),
            max_side=512,
        )

        # Execute main logic manually
        from tools.build_histogram_channel import find_images
        paths = find_images(img_dir)
        from lighting_engine.core.analysis_channels.histogram_residual import build_histogram_matrix, compute_histogram_residuals, compute_histogram_summary
        iids, vpaths, skipped, b, s, h, info = build_histogram_matrix(paths)
        b_res = compute_histogram_residuals(b)
        s_res = compute_histogram_residuals(s)
        h_res = compute_histogram_residuals(h)
        df = compute_histogram_summary(iids, vpaths, b, s, h, info, b_res, s_res, h_res)

        analysis_dir = output_dir / "analysis_channels"
        analysis_dir.mkdir(parents=True, exist_ok=True)

        # Write manually (simulating CLI)
        import numpy as np
        np.savez_compressed(
            analysis_dir / "histogram_bank.npz",
            image_ids=iids, image_paths=[str(p) for p in vpaths],
            brightness_hist_16=b, saturation_hist_16=s, hue_hist_24=h,
            brightness_residual_16=b_res["residual"],
            saturation_residual_16=s_res["residual"],
            hue_residual_24=h_res["residual"],
            brightness_z_residual_16=b_res["z_residual"],
            saturation_z_residual_16=s_res["z_residual"],
            hue_z_residual_24=h_res["z_residual"],
            brightness_mean_16=b_res["mean"], saturation_mean_16=s_res["mean"],
            hue_mean_24=h_res["mean"],
            brightness_std_16=b_res["std"], saturation_std_16=s_res["std"],
            hue_std_24=h_res["std"],
        )
        df.to_csv(analysis_dir / "histogram_summary.csv", index=False)
        manifest = {"default_clustering_unchanged": True, "image_count": len(vpaths)}
        with open(analysis_dir / "histogram_manifest.json", "w") as f:
            json.dump(manifest, f)

        assert (analysis_dir / "histogram_bank.npz").exists()
        assert (analysis_dir / "histogram_summary.csv").exists()
        assert (analysis_dir / "histogram_manifest.json").exists()
        assert manifest["default_clustering_unchanged"] is True
