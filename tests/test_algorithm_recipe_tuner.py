"""Tests for algorithms recipe tuner (v4.4a).

Tests cover:
1. Recipe can select feature subsets
2. Recipe does not select blur/hash/hist features
3. Recipe does not modify CONFIG defaults
4. Recipe output JSON/MD report generation
5. legacy_16_like can construct feature list
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

# Add project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from tools.tune_algorithm_recipes import (
    get_recipes, get_orthogonal_recipe_names, _apply_recipe_indices,
    FEATURE_NAMES_20, compute_legacy_warm_cool, _get_feature_subset_names,
    run_clustering,
)
from lighting_engine.core.config import CONFIG


class TestRecipeDefinitions:
    """Test recipe definitions produce valid feature selections."""

    def test_all_recipes_defined(self):
        recipes = get_recipes()
        assert len(recipes) >= 8, f"Expected 8+ recipes, got {len(recipes)}"
        names = [r["name"] for r in recipes]
        expected = [
            "current_v4_1", "color_weight_0_5", "color_weight_0_3",
            "no_saturation_ratios", "no_dominant_hue", "color_back_to_core",
            "legacy_color", "no_brightness_skewness", "legacy_16_like",
        ]
        for e in expected:
            assert e in names, f"Missing recipe: {e}"

    def test_recipe_does_not_select_blur_hash_hist(self):
        """No recipe should select blur/hash/histogram features."""
        recipes = get_recipes()
        for recipe in recipes:
            keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
            names = [FEATURE_NAMES_20[i] for i in keep_idx]
            names.extend(extra_names)
            for n in names:
                assert "blur" not in n.lower(), f"Recipe {recipe['name']} selects blur feature: {n}"
                assert "hash" not in n.lower(), f"Recipe {recipe['name']} selects hash feature: {n}"
                assert "phash" not in n.lower(), f"Recipe {recipe['name']} selects phash feature: {n}"
            hist_terms = ["hist_label", "dark_ratio", "mid_ratio", "bright_ratio", "hist_entropy"]
            for ht in hist_terms:
                assert ht not in names, f"Recipe {recipe['name']} selects hist feature: {ht}"

    def test_recipe_does_not_modify_config(self):
        """Recipe evaluation should not modify CONFIG defaults."""
        orig_color_weight = CONFIG["feature_groups"]["color"]["weight"]
        orig_brightness_dims = CONFIG["feature_groups"]["brightness"]["dims"]

        recipes = get_recipes()
        for recipe in recipes:
            keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)

        # After all recipe processing, CONFIG must be unchanged
        assert CONFIG["feature_groups"]["color"]["weight"] == orig_color_weight
        assert CONFIG["feature_groups"]["brightness"]["dims"] == orig_brightness_dims
        assert CONFIG["feature_groups"]["brightness"]["dims"] == 4
        assert CONFIG["feature_groups"]["color"]["dims"] == 3

    def test_legacy_16_like_feature_list(self):
        """legacy_16_like should produce a valid feature list."""
        recipes = get_recipes()
        legacy = [r for r in recipes if r["name"] == "legacy_16_like"]
        assert len(legacy) == 1
        recipe = legacy[0]

        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)

        # Should have: brightness(4) + lighting(4) + color_legacy(3) + spatial(5) = 16
        assert len(names) == 16, f"Expected 16 features for legacy_16_like, got {len(names)}: {names}"

        # Should contain legacy_warm_cool_bias
        assert "legacy_warm_cool_bias" in names

        # Should NOT contain brightness_skewness
        assert "brightness_skewness" not in names

        # Should NOT contain new color features
        assert "low_saturation_ratio" not in names
        assert "high_saturation_ratio" not in names
        assert "dominant_hue_strength" not in names
        assert "warm_cool_bias_weighted" not in names

    def test_color_back_to_core(self):
        """color_back_to_core should have only 3 color features."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "color_back_to_core"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)

        color_names = [n for n in names if n in FEATURE_NAMES_20[9:15]]
        assert len(color_names) == 3, f"Expected 3 color features, got {len(color_names)}: {color_names}"
        assert "warm_cool_bias_weighted" in color_names
        assert "saturation_mean" in color_names
        assert "saturation_std" in color_names
        assert "low_saturation_ratio" not in color_names
        assert "high_saturation_ratio" not in color_names
        assert "dominant_hue_strength" not in color_names

    def test_no_saturation_ratios(self):
        """no_saturation_ratios should exclude indices 12, 13."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "no_saturation_ratios"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "low_saturation_ratio" not in names
        assert "high_saturation_ratio" not in names
        assert "dominant_hue_strength" in names  # should still be present

    def test_no_dominant_hue(self):
        """no_dominant_hue should exclude index 14."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "no_dominant_hue"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "dominant_hue_strength" not in names
        assert "low_saturation_ratio" in names
        assert "high_saturation_ratio" in names

    def test_no_brightness_skewness(self):
        """no_brightness_skewness should exclude index 4."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "no_brightness_skewness"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "brightness_skewness" not in names

    def test_weight_overrides(self):
        """Recipes should apply correct weight overrides."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "color_weight_0_5"][0]
        _, _, _, weights = _apply_recipe_indices(recipe)
        assert weights["color"] == 0.5
        assert weights["brightness"] == 1.0

        recipe2 = [r for r in recipes if r["name"] == "current_v4_1"][0]
        _, _, _, weights2 = _apply_recipe_indices(recipe2)
        assert weights2["color"] == 0.8

        recipe3 = [r for r in recipes if r["name"] == "color_weight_0_3"][0]
        _, _, _, weights3 = _apply_recipe_indices(recipe3)
        assert weights3["color"] == 0.3


class TestLegacyWarmCool:
    """Test legacy warm_cool_bias computation."""

    def test_legacy_warm_cool_red_vs_blue(self):
        """Red image should have higher legacy warm_cool than blue."""
        red = np.zeros((64, 64, 3), dtype=np.float32)
        red[..., 0] = 1.0
        blue = np.zeros((64, 64, 3), dtype=np.float32)
        blue[..., 2] = 1.0

        result = compute_legacy_warm_cool([red, blue])
        assert result.shape == (2, 1)
        assert result[0, 0] > result[1, 0], f"Expected red > blue, got {result[0,0]} vs {result[1,0]}"

    def test_legacy_warm_cool_gray(self):
        """Gray image should have warm_cool near 0."""
        gray = np.ones((64, 64, 3), dtype=np.float32) * 0.5
        result = compute_legacy_warm_cool([gray])
        assert abs(result[0, 0]) < 0.01

    def test_legacy_warm_cool_none_handling(self):
        """None image should produce 0.0."""
        result = compute_legacy_warm_cool([None])
        assert result[0, 0] == 0.0


class TestFeatureSubset:
    """Test feature subset construction."""

    def test_subset_names_correct(self):
        keep_idx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 18, 19]
        extra = ["legacy_warm_cool_bias"]
        names = _get_feature_subset_names(keep_idx, extra)
        assert "brightness_mean" in names
        assert "brightness_skewness" in names
        assert "contrast" in names
        assert "legacy_warm_cool_bias" in names
        assert "saturation_mean" not in names  # not in keep_idx
        assert len(names) == len(keep_idx) + len(extra)

    def test_legacy_warm_cool_in_compute_fn(self):
        """_apply_recipe_indices should return extra_fn for legacy recipes."""
        recipes = get_recipes()
        for name in ["legacy_color", "legacy_16_like"]:
            recipe = [r for r in recipes if r["name"] == name][0]
            _, extra_names, extra_fn, _ = _apply_recipe_indices(recipe)
            assert "legacy_warm_cool_bias" in extra_names
            assert extra_fn is not None

    def test_non_legacy_has_no_extra(self):
        """Non-legacy recipes should have no extra features."""
        recipes = get_recipes()
        for name in ["current_v4_1", "color_weight_0_5", "no_saturation_ratios",
                       "no_dominant_hue", "no_brightness_skewness"]:
            recipe = [r for r in recipes if r["name"] == name][0]
            _, extra_names, extra_fn, _ = _apply_recipe_indices(recipe)
            assert extra_names == [], f"Recipe {name} should have no extra features, got {extra_names}"
            assert extra_fn is None


class TestRunClustering:
    """Test clustering function runs on small synthetic data."""

    def test_run_clustering_basic(self):
        """Run clustering with synthetic 20-dim data."""
        np.random.seed(42)
        n = 50
        features = np.random.randn(n, 20).astype(np.float32)
        feature_names = FEATURE_NAMES_20
        weights = {"brightness": 1.0, "lighting": 1.0, "color": 0.8, "spatial_lighting": 1.0}

        result = run_clustering(features, feature_names, weights, n)

        assert "n_clusters" in result
        assert "silhouette" in result
        assert "noise_rate" in result
        assert "live_features" in result
        assert "dead_feature_names" in result
        assert result["silhouette"] >= -1.0 and result["silhouette"] <= 1.0
        assert result["noise_rate"] >= 0
        assert result["n_clusters"] >= 0
        assert result["live_features"] <= 20


class TestJsonReport:
    """Test JSON output format."""

    def test_json_structure(self, tmp_path):
        """Verify the JSON output has expected structure."""
        from tools.tune_algorithm_recipes import write_json, compute_scores

        # Create minimal mock results
        mock_results = {
            "ready_for_training_folder": {
                "current_v4_1": {
                    "silhouette": 0.39,
                    "n_clusters": 5,
                    "noise_rate": 21.7,
                    "live_features": 18,
                    "dead_feature_count": 2,
                    "dead_feature_names": ["f1", "f2"],
                    "largest_cluster_ratio": 0.3,
                    "image_count": 60,
                    "total_features": 20,
                    "selected_feature_names": FEATURE_NAMES_20,
                    "group_weights": {"color": 0.8},
                    "runtime_seconds": 5.0,
                    "recipe_name": "current_v4_1",
                    "dataset": "ready_for_training_folder",
                }
            }
        }

        scores = compute_scores(mock_results)
        json_path = write_json(mock_results, scores, tmp_path)
        assert json_path.exists()

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "results" in data
        assert "scores" in data
        assert "datasets" in data
        assert "ready_for_training_folder" in data["results"]
        assert "current_v4_1" in data["results"]["ready_for_training_folder"]
        assert data["results"]["ready_for_training_folder"]["current_v4_1"]["silhouette"] == 0.39


class TestOrthogonalRecipes:
    """Tests for v4.4a-2 orthogonal ablation recipes."""

    def test_orthogonal_recipes_defined(self):
        """All 8 orthogonal recipes + reference should exist."""
        from tools.tune_algorithm_recipes import get_orthogonal_recipe_names
        names = get_orthogonal_recipe_names()
        expected = [
            "legacy_16_like",
            "legacy_16_plus_skewness",
            "legacy_16_weighted_warmcool",
            "legacy_16_plus_low_high_sat",
            "legacy_16_plus_dominant_hue",
            "legacy_16_plus_all_new_color",
            "legacy_16_plus_all_new_color_weighted",
            "legacy_16_plus_skewness_only_metadata_color",
        ]
        for e in expected:
            assert e in names, f"Missing orthogonal recipe: {e}"
        assert len(names) == 8

    def test_orthogonal_recipes_in_get_recipes(self):
        """All orthogonal recipes should be in the full get_recipes list."""
        ortho_names = set(get_orthogonal_recipe_names())
        all_names = {r["name"] for r in get_recipes()}
        missing = ortho_names - all_names
        assert not missing, f"Orthogonal recipes missing from get_recipes: {missing}"

    def test_legacy_16_plus_skewness_has_skewness(self):
        """legacy_16_plus_skewness should include brightness_skewness."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_skewness"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "brightness_skewness" in names

    def test_legacy_16_plus_skewness_has_17_features(self):
        """legacy_16_like(15 base + legacy_warm_cool=16) + skewness(1) = 17."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_skewness"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert len(names) == 17, f"Expected 17, got {len(names)}: {names}"

    def test_legacy_16_weighted_warmcool_has_no_legacy(self):
        """legacy_16_weighted_warmcool should use weighted not legacy warm_cool."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_weighted_warmcool"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        assert "legacy_warm_cool_bias" not in extra_names, "Should not have legacy warm_cool"
        assert extra_fn is None, "Should not have extra compute function"
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "warm_cool_bias_weighted" in names, "Should have weighted warm_cool"

    def test_legacy_16_plus_low_high_sat(self):
        """legacy_16_plus_low_high_sat should include saturation ratios."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_low_high_sat"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "low_saturation_ratio" in names
        assert "high_saturation_ratio" in names
        assert "legacy_warm_cool_bias" in extra_names

    def test_legacy_16_plus_dominant_hue(self):
        """legacy_16_plus_dominant_hue should include dominant_hue_strength."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_dominant_hue"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "dominant_hue_strength" in names

    def test_legacy_16_plus_all_new_color_has_19_features(self):
        """legacy_16_like(15 base + legacy_warm_cool=16) + 3 new color = 19."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_all_new_color"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert len(names) == 19, f"Expected 19, got {len(names)}: {names}"

    def test_legacy_16_plus_all_new_color_weighted_is_20(self):
        """legacy_16_plus_all_new_color_weighted should have all 20 dims."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_all_new_color_weighted"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        # This uses all features from the current config (brightness=4, lighting=4, color=6, spatial=5)
        # legacy_16_like base + new color features = 14 base + 3 new color + weighted warmcool = 20
        assert len(names) == 20, f"Expected 20, got {len(names)}: {names}"
        assert "legacy_warm_cool_bias" not in extra_names

    def test_legacy_16_plus_skewness_only_metadata_color(self):
        """Only skewness added, new color feats not in clustering."""
        recipes = get_recipes()
        recipe = [r for r in recipes if r["name"] == "legacy_16_plus_skewness_only_metadata_color"][0]
        keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
        names = _get_feature_subset_names(keep_idx, extra_names)
        assert "brightness_skewness" in names, "Should have skewness"
        assert "low_saturation_ratio" not in names, "Should NOT have low_sat"
        assert "high_saturation_ratio" not in names, "Should NOT have high_sat"
        assert "dominant_hue_strength" not in names, "Should NOT have dominant_hue"
        assert "legacy_warm_cool_bias" in extra_names, "Should have legacy warm_cool"

    def test_orthogonal_recipes_produce_valid_names(self):
        """All orthogonal recipes should produce valid feature names without errors."""
        from tools.tune_algorithm_recipes import get_orthogonal_recipe_names
        ortho_names = get_orthogonal_recipe_names()
        all_recipes = {r["name"]: r for r in get_recipes()}
        for name in ortho_names:
            recipe = all_recipes.get(name)
            assert recipe is not None, f"Recipe {name} not found"
            keep_idx, extra_names, extra_fn, weights = _apply_recipe_indices(recipe)
            names = _get_feature_subset_names(keep_idx, extra_names)
            assert len(names) > 0, f"Recipe {name} produced empty feature list"
            # No blur/hash/hist
            for n in names:
                assert "blur" not in n.lower()
                assert "hash" not in n.lower()
                assert "hist_label" not in n
                assert "dark_ratio" not in n
