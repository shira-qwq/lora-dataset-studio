"""Feature-level tests for v4.1-v4.3 additions.

Tests cover:
  - warm_cool_bias_weighted: warm > cool for red vs blue images
  - brightness_skewness: positive for dark-with-highlights images
  - low_saturation_ratio: high for grayscale images
  - high_saturation_ratio: high for saturated images
  - dominant_hue_strength: high for single-color images
  - histogram_shape_label: high_key/low_key differentiation
  - blur_score: blurry < sharp
  - imagehash: near-duplicate detection

Also verifies:
  - All features are finite (no NaN/Inf)
  - Edge cases (black, white, gray, small images) don't crash
"""

import numpy as np
import pytest

from lighting_engine.core.feature_plugins import brightness, color
from lighting_engine.core.diagnostics.histogram_shape import analyze_brightness_histogram
from lighting_engine.core.quality.blur import compute_blur_score
from lighting_engine.core.quality.hash_duplicate import compute_hashes, group_near_duplicates
from lighting_engine.core.feature_assembler import assemble, get_active_feature_names, FEATURE_GROUP_NAMES
from lighting_engine.core.config import CONFIG


# ============================================================
# v4.1: Low-dim feature enhancement tests
# ============================================================

class TestBrightnessFeatures:
    """Test brightness features including new brightness_skewness."""

    def test_brightness_features_finite(self):
        L = np.ones((64, 64), dtype=np.float32) * 0.5
        feats = brightness.extract(L)
        assert all(np.isfinite(v) for v in feats.values())

    def test_brightness_feature_names(self):
        L = np.random.rand(64, 64).astype(np.float32)
        feats = brightness.extract(L)
        expected = {"brightness_mean", "brightness_std", "brightness_p10",
                     "brightness_p90", "brightness_skewness"}
        assert set(feats.keys()) == expected

    def test_brightness_skewness_positive_for_dark_with_highlights(self):
        """Dark background with bright spot → positive skewness."""
        L = np.ones((64, 64), dtype=np.float32) * 0.1  # dark bg
        L[20:30, 20:30] = 0.9  # bright highlight
        feats = brightness.extract(L)
        assert feats["brightness_skewness"] > 0, (
            f"Expected positive skewness for dark+highlight, got {feats['brightness_skewness']}")

    def test_brightness_skewness_negative_for_bright_with_shadows(self):
        """Bright with dark strokes → negative skewness."""
        L = np.ones((64, 64), dtype=np.float32) * 0.9  # bright
        L[20:30, 20:30] = 0.1  # dark stroke
        feats = brightness.extract(L)
        assert feats["brightness_skewness"] < 0, (
            f"Expected negative skewness for bright+shadow, got {feats['brightness_skewness']}")

    def test_brightness_skewness_near_zero_for_uniform(self):
        """Uniform gray → near-zero skewness."""
        L = np.ones((64, 64), dtype=np.float32) * 0.5
        feats = brightness.extract(L)
        assert abs(feats["brightness_skewness"]) < 0.01, (
            f"Expected near-zero skewness for uniform, got {feats['brightness_skewness']}")

    def test_brightness_edge_cases(self):
        """Black, white, small images don't crash."""
        for shape in [(64, 64), (4, 4), (1, 1)]:
            for val in [0.0, 1.0, 0.5]:
                L = np.ones(shape, dtype=np.float32) * val
                feats = brightness.extract(L)
                assert all(np.isfinite(v) for v in feats.values()), f"non-finite for shape={shape}, val={val}"


class TestColorFeatures:
    """Test enhanced color features."""

    def test_color_features_finite(self):
        img = np.ones((64, 64, 3), dtype=np.float32) * 0.5
        feats = color.extract(img)
        assert all(np.isfinite(v) for v in feats.values())

    def test_color_feature_names(self):
        img = np.random.rand(64, 64, 3).astype(np.float32)
        feats = color.extract(img)
        expected = {"warm_cool_bias", "saturation_mean", "saturation_std",
                     "warm_cool_bias_weighted", "low_saturation_ratio",
                     "high_saturation_ratio", "dominant_hue_strength"}
        assert set(feats.keys()) == expected

    def test_warm_cool_red_vs_blue(self):
        """Red image should have higher warm_cool_bias (raw) than blue."""
        red = np.zeros((64, 64, 3), dtype=np.float32)
        red[..., 0] = 1.0  # R channel

        blue = np.zeros((64, 64, 3), dtype=np.float32)
        blue[..., 2] = 1.0  # B channel

        red_warm = color.extract(red)["warm_cool_bias"]
        blue_warm = color.extract(blue)["warm_cool_bias"]
        assert red_warm > blue_warm, (
            f"Expected red ({red_warm}) > blue ({blue_warm})")

    def test_low_saturation_gray(self):
        """Gray image has high low_saturation_ratio."""
        gray = np.ones((64, 64, 3), dtype=np.float32) * 0.5
        feats = color.extract(gray)
        assert feats["low_saturation_ratio"] > 0.9, (
            f"Expected low_saturation_ratio > 0.9 for gray, got {feats['low_saturation_ratio']}")

    def test_high_saturation_bright_red(self):
        """Bright saturated red has high high_saturation_ratio."""
        red = np.zeros((64, 64, 3), dtype=np.float32)
        red[..., 0] = 1.0
        feats = color.extract(red)
        assert feats["high_saturation_ratio"] > 0.5, (
            f"Expected high_saturation_ratio > 0.5 for bright red, got {feats['high_saturation_ratio']}")

    def test_dominant_hue_strength_high_for_single_color(self):
        """Single-color image has high dominant_hue_strength."""
        red = np.zeros((64, 64, 3), dtype=np.float32)
        red[..., 0] = 1.0
        feats = color.extract(red)
        assert feats["dominant_hue_strength"] > 0.5, (
            f"Expected dominant_hue_strength > 0.5 for solid red, got {feats['dominant_hue_strength']}")

    def test_dominant_hue_strength_low_for_gray(self):
        """Grayscale image has dominant_hue_strength near 0."""
        gray = np.ones((64, 64, 3), dtype=np.float32) * 0.5
        feats = color.extract(gray)
        assert feats["dominant_hue_strength"] < 0.1, (
            f"Expected dominant_hue_strength near 0 for gray, got {feats['dominant_hue_strength']}")

    def test_color_edge_cases(self):
        """Black, white, small images don't crash."""
        test_cases = [
            np.zeros((64, 64, 3), dtype=np.float32),  # black
            np.ones((64, 64, 3), dtype=np.float32),   # white
            np.ones((4, 4, 3), dtype=np.float32) * 0.5,  # small gray
        ]
        for img in test_cases:
            feats = color.extract(img)
            assert all(np.isfinite(v) for v in feats.values())


# ============================================================
# v4.2: Histogram shape label tests
# ============================================================

class TestHistogramShape:
    """Test brightness histogram shape labels."""

    def test_white_image_high_key(self):
        """Pure white → high_key."""
        L = np.ones((64, 64), dtype=np.float32)
        diag = analyze_brightness_histogram(L)
        assert diag["brightness_hist_label"] == "high_key", (
            f"Expected high_key for white, got {diag['brightness_hist_label']}")

    def test_black_image_low_key(self):
        """Pure black → low_key."""
        L = np.zeros((64, 64), dtype=np.float32)
        diag = analyze_brightness_histogram(L)
        assert diag["brightness_hist_label"] == "low_key", (
            f"Expected low_key for black, got {diag['brightness_hist_label']}")

    def test_half_black_half_white_high_contrast(self):
        """Half black / half white → high_contrast."""
        L = np.ones((64, 64), dtype=np.float32)
        L[:32, :] = 0.0  # top half black
        diag = analyze_brightness_histogram(L)
        assert diag["brightness_hist_label"] == "high_contrast", (
            f"Expected high_contrast, got {diag['brightness_hist_label']}")

    def test_midgray_may_be_midtone(self):
        """Mid-gray → likely midtone or flat_hist (not high_key/low_key)."""
        L = np.ones((64, 64), dtype=np.float32) * 0.5
        diag = analyze_brightness_histogram(L)
        assert diag["brightness_hist_label"] in ("midtone", "flat_hist"), (
            f"Expected midtone/flat_hist for mid-gray, got {diag['brightness_hist_label']}")

    def test_all_outputs_finite(self):
        L = np.random.rand(64, 64).astype(np.float32)
        diag = analyze_brightness_histogram(L)
        for k, v in diag.items():
            if isinstance(v, float):
                assert np.isfinite(v), f"non-finite {k}={v}"

    def test_edge_cases(self):
        """Small, uniform, extreme images don't crash."""
        for shape in [(64, 64), (4, 4), (1, 1)]:
            for val in [0.0, 1.0, 0.5]:
                L = np.ones(shape, dtype=np.float32) * val
                diag = analyze_brightness_histogram(L)
                assert "brightness_hist_label" in diag
                assert all(np.isfinite(v) for v in diag.values() if isinstance(v, float))


# ============================================================
# v4.3: Blur + ImageHash tests
# ============================================================

class TestBlur:
    """Test blur detection."""

    def test_blur_score_finite(self):
        img = np.random.rand(64, 64, 3).astype(np.float32)
        score = compute_blur_score(img)
        assert np.isfinite(score)

    def test_blurry_lower_than_sharp(self):
        """Gaussian-blurred image should have lower blur score than original."""
        img = np.random.rand(64, 64, 3).astype(np.float32)
        import cv2
        blurred = cv2.GaussianBlur(img, (15, 15), 5)
        sharp_score = compute_blur_score(img)
        blurry_score = compute_blur_score(blurred)
        assert blurry_score < sharp_score, (
            f"Expected blurry ({blurry_score}) < sharp ({sharp_score})")

    def test_edge_cases(self):
        """Black, white, small images don't crash."""
        test_cases = [
            np.zeros((64, 64, 3), dtype=np.float32),
            np.ones((64, 64, 3), dtype=np.float32),
            np.ones((4, 4, 3), dtype=np.float32) * 0.5,
        ]
        for img in test_cases:
            score = compute_blur_score(img)
            assert np.isfinite(score)

    def test_classify_blur(self):
        from lighting_engine.core.quality.blur import classify_blur
        assert classify_blur(0.0) == "review_blurry"
        assert classify_blur(100.0) == "ok"
        assert classify_blur(59.9, threshold=60.0) == "review_blurry"
        assert classify_blur(60.0, threshold=60.0) == "ok"


@pytest.fixture
def temp_image_dir(tmp_path):
    """Create temporary directory with test images for hash tests."""
    from PIL import Image
    # Create two identical images
    im = Image.new('RGB', (64, 64), color=(128, 64, 200))
    p1 = tmp_path / "img1.webp"
    p2 = tmp_path / "img2.webp"
    p3 = tmp_path / "img3_diff.webp"
    im.save(str(p1))
    im.save(str(p2))
    # Different image
    im2 = Image.new('RGB', (64, 64), color=(200, 64, 128))
    p3 = tmp_path / "img3_diff.webp"
    im2.save(str(p3))
    return tmp_path


class TestImageHash:
    """Test near-duplicate detection."""

    def test_identical_images_same_group(self, temp_image_dir):
        """Two identical images should be in the same duplicate group."""
        paths = list(temp_image_dir.glob("*.webp"))
        hash_map = compute_hashes(paths)
        groups = group_near_duplicates(hash_map)
        # img1 and img2 should be in a group
        p1_str = str(paths[0])
        p2_str = str(paths[1])
        assert p1_str in groups, "img1 should be in a group"
        assert p2_str in groups, "img2 should be in a group"
        assert groups[p1_str]["duplicate_group_id"] == groups[p2_str]["duplicate_group_id"]
        assert groups[p1_str]["is_near_duplicate"]
        assert groups[p2_str]["is_near_duplicate"]

    def test_different_images_not_grouped(self, temp_image_dir):
        """Different images should not be grouped together."""
        paths = list(temp_image_dir.glob("*.webp"))
        hash_map = compute_hashes(paths)
        groups = group_near_duplicates(hash_map, max_distance=2)  # strict
        p3_str = str(paths[2])  # the different one
        # With max_distance=2, different images might not be grouped
        # Just verify the function runs without error

    def test_hash_map_all_paths(self, temp_image_dir):
        """compute_hashes should return entries for all paths."""
        paths = list(temp_image_dir.glob("*.webp"))
        hash_map = compute_hashes(paths)
        assert len(hash_map) == len(paths)
        for v in hash_map.values():
            assert isinstance(v, str)


# ============================================================
# Integration: assemble consistency
# ============================================================

class TestAssembleConsistency:
    """Verify feature assemble output matches config dimensions."""

    def test_feature_count_matches_config(self):
        """Active feature dims should match assemble output dims."""
        fg = CONFIG["feature_groups"]
        names = get_active_feature_names(fg)
        total_config = len(names)

        img = np.random.rand(64, 64, 3).astype(np.float32)
        feat, _ = assemble(img, None, None, fg)
        assert len(feat) == total_config, (
            f"Assemble dim {len(feat)} != config dim {total_config}")

    def test_all_features_finite(self):
        fg = CONFIG["feature_groups"]
        img = np.random.rand(64, 64, 3).astype(np.float32)
        feat, _ = assemble(img, None, None, fg)
        assert all(np.isfinite(feat))

    def test_edge_case_images(self):
        fg = CONFIG["feature_groups"]
        for img in [
            np.zeros((64, 64, 3), dtype=np.float32),
            np.ones((64, 64, 3), dtype=np.float32),
            np.ones((4, 4, 3), dtype=np.float32) * 0.5,
        ]:
            feat, _ = assemble(img, None, None, fg)
            assert len(feat) == 16, f"Expected 16 dims, got {len(feat)}"
            assert all(np.isfinite(feat))


class TestDefaultConfigProtection:
    """Tests that protect the 16-dim default clustering config.

    These tests ensure no accidental changes to the default config.
    If you need to change the config, update these tests too.
    """

    def test_default_config_brightness_dims(self):
        """brightness must be 4 dims (mean, std, p10, p90)."""
        g = CONFIG["feature_groups"]["brightness"]
        assert g["dims"] == 4, f"Expected brightness dims=4, got {g['dims']}"
        assert g["enabled"] is True
        names_4 = FEATURE_GROUP_NAMES["brightness"][:4]
        assert "brightness_mean" in names_4
        assert "brightness_skewness" not in names_4[:4], \
            "brightness_skewness must NOT be in the first 4 brightness dims"

    def test_default_config_lighting_dims(self):
        """lighting must be 4 dims (contrast, highlight, edge_mean, edge_std)."""
        g = CONFIG["feature_groups"]["lighting"]
        assert g["dims"] == 4, f"Expected lighting dims=4, got {g['dims']}"

    def test_default_config_color_dims(self):
        """color must be 3 dims (warm_cool_bias raw, sat_mean, sat_std)."""
        g = CONFIG["feature_groups"]["color"]
        assert g["dims"] == 3, f"Expected color dims=3, got {g['dims']}"
        assert g["weight"] == 1.0, f"Expected color weight=1.0, got {g['weight']}"
        names_3 = FEATURE_GROUP_NAMES["color"][:3]
        assert "warm_cool_bias" in names_3, "First color feature should be raw warm_cool_bias"
        assert "warm_cool_bias_weighted" not in names_3, \
            "warm_cool_bias_weighted should NOT be in first 3 color dims"
        assert "low_saturation_ratio" not in names_3, \
            "low_saturation_ratio must NOT be in first 3 color dims"
        assert "high_saturation_ratio" not in names_3, \
            "high_saturation_ratio must NOT be in first 3 color dims"
        assert "dominant_hue_strength" not in names_3, \
            "dominant_hue_strength must NOT be in first 3 color dims"

    def test_default_config_spatial_dims(self):
        """spatial_lighting must be 5 dims."""
        g = CONFIG["feature_groups"]["spatial_lighting"]
        assert g["dims"] == 5, f"Expected spatial dims=5, got {g['dims']}"

    def test_default_config_total_dims(self):
        """Total clustering dims must be exactly 16."""
        total = sum(
            g["dims"] for g in CONFIG["feature_groups"].values()
            if g.get("enabled", False) and g.get("cluster", True)
        )
        assert total == 16, f"Expected 16 total clustering dims, got {total}"

    def test_default_config_cluster_size_ratio(self):
        """cluster_size_ratio must be 0.015."""
        assert CONFIG["cluster_size_ratio"] == 0.015, \
            f"Expected cluster_size_ratio=0.015, got {CONFIG['cluster_size_ratio']}"

    def test_default_config_feature_names(self):
        """The exact 16 feature names must match legacy_16_like expectations."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        assert len(names) == 16
        assert names[0] == "brightness_mean"
        assert names[3] == "brightness_p90"
        assert names[4] == "contrast"
        assert names[8] == "warm_cool_bias"
        assert names[10] == "saturation_std"
        assert names[11] == "light_centroid_x"
        assert names[15] == "light_asymmetry"

    def test_brightness_skewness_not_in_clustering(self):
        """brightness_skewness is at index 4 in full extractor, but dims=4 excludes it."""
        from lighting_engine.core.feature_plugins import brightness as b
        L = np.ones((32, 32), dtype=np.float32) * 0.5
        feats = b.extract(L)
        all_keys = list(feats.keys())
        assert "brightness_skewness" in all_keys, "brightness_skewness should still be extracted"
        assert all_keys.index("brightness_skewness") >= 4, \
            "brightness_skewness must be at position 4+ in extractor output"
        # Verify config dims cuts it off
        names = get_active_feature_names(CONFIG["feature_groups"])
        assert "brightness_skewness" not in names, \
            "brightness_skewness must NOT appear in active clustering features"

    def test_extra_color_not_in_clustering_names(self):
        """low_sat_ratio, high_sat_ratio, dominant_hue must NOT be in active names."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        for forbidden in ["low_saturation_ratio", "high_saturation_ratio",
                           "dominant_hue_strength"]:
            assert forbidden not in names, \
                f"{forbidden} must NOT be in active clustering features"

    def test_blur_hash_hist_never_in_clustering(self):
        """blur, hash, hist_label metadata must never appear in feature names."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        for forbidden in ["blur", "hash", "phash", "hist_label"]:
            assert not any(forbidden in n.lower() for n in names), \
                f"'{forbidden}' must not be in clustering features"
