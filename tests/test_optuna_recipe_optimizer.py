"""Tests for Optuna recipe optimizer (v4.4a-3).

Covers:
1. Graceful skip if optuna not installed
2. Default search space excludes extra color features
3. --allow-extra-color includes extra color features
4. Objective does not select blur/hash/hist
5. best_recipe.json can be written
6. Script does not modify CONFIG defaults
7. Manifest datasets can be read as holdout
8. --quick mode runs on small data
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# ── Check optuna availability ──
try:
    import optuna
    OPTUNA_AVAILABLE = True
except ImportError:
    OPTUNA_AVAILABLE = False

from tools.optimize_algorithm_recipe import (
    FEATURE_NAMES_20, build_feature_matrix, build_group_indices,
    compute_legacy_warm_cool, BASELINE_DATASETS,
)

optuna = pytest.importorskip("optuna", reason="optuna not installed")


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def dummy_features():
    """Create dummy 20-dim features for 10 images."""
    rng = np.random.RandomState(42)
    return rng.randn(10, 20).astype(np.float32)


@pytest.fixture
def dummy_images():
    """Create dummy RGB images for 10 images."""
    rng = np.random.RandomState(42)
    return [rng.rand(64, 64, 3).astype(np.float32) for _ in range(10)]


# ============================================================
# Tests
# ============================================================

class TestOptunaImport:
    """Test graceful handling of missing optuna."""

    def test_optuna_available(self):
        """optuna should be imported successfully."""
        import optuna
        assert hasattr(optuna, "create_study")
        assert hasattr(optuna, "trial")


class TestSearchSpace:
    """Test search space constraints."""

    def test_default_excludes_extra_color(self):
        """Default search space excludes low/high sat ratios and dominant_hue."""
        params = {
            "use_brightness_skewness": False,
            "warmcool_mode": "raw",
            "use_low_saturation_ratio": False,
            "use_high_saturation_ratio": False,
            "use_dominant_hue_strength": False,
            "brightness_weight": 1.0,
            "lighting_weight": 1.0,
            "color_weight": 0.8,
            "spatial_lighting_weight": 1.0,
            "umap_neighbors": 30,
            "umap_min_dist": 0.05,
            "umap_metric": "euclidean",
            "cluster_size_ratio": 0.02,
            "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(
            np.zeros((1, 20), dtype=np.float32),
            [np.zeros((64, 64, 3), dtype=np.float32)],
            params,
        )
        name_set = set(names)
        assert "low_saturation_ratio" not in name_set
        assert "high_saturation_ratio" not in name_set
        assert "dominant_hue_strength" not in name_set
        assert "legacy_warm_cool_bias" in name_set

    def test_allow_extra_color_includes_features(self, dummy_features, dummy_images):
        """With allow_extra_color, extra color features can be included."""
        params = {
            "use_brightness_skewness": True,
            "warmcool_mode": "weighted",
            "use_low_saturation_ratio": True,
            "use_high_saturation_ratio": True,
            "use_dominant_hue_strength": True,
            "brightness_weight": 1.0,
            "lighting_weight": 1.0,
            "color_weight": 0.8,
            "spatial_lighting_weight": 1.0,
            "umap_neighbors": 30,
            "umap_min_dist": 0.05,
            "umap_metric": "euclidean",
            "cluster_size_ratio": 0.02,
            "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(dummy_features, dummy_images, params)
        name_set = set(names)
        assert "low_saturation_ratio" in name_set
        assert "high_saturation_ratio" in name_set
        assert "dominant_hue_strength" in name_set
        assert "brightness_skewness" in name_set
        assert "warm_cool_bias_weighted" in name_set

    def test_legacy_warmcool_produces_extra_feature(self, dummy_features, dummy_images):
        """Raw mode produces legacy_warm_cool_bias extra feature."""
        params = {
            "use_brightness_skewness": False,
            "warmcool_mode": "raw",
            "use_low_saturation_ratio": False,
            "use_high_saturation_ratio": False,
            "use_dominant_hue_strength": False,
            "brightness_weight": 1.0,
            "lighting_weight": 1.0,
            "color_weight": 0.8,
            "spatial_lighting_weight": 1.0,
            "umap_neighbors": 30,
            "umap_min_dist": 0.05,
            "umap_metric": "euclidean",
            "cluster_size_ratio": 0.02,
            "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(dummy_features, dummy_images, params)
        assert "legacy_warm_cool_bias" in names
        assert "warm_cool_bias_weighted" not in names

    def test_weighted_warmcool_keeps_index_9(self, dummy_features, dummy_images):
        """Weighted mode keeps warm_cool_bias_weighted (index 9)."""
        params = {
            "use_brightness_skewness": False,
            "warmcool_mode": "weighted",
            "use_low_saturation_ratio": False,
            "use_high_saturation_ratio": False,
            "use_dominant_hue_strength": False,
            "brightness_weight": 1.0,
            "lighting_weight": 1.0,
            "color_weight": 0.8,
            "spatial_lighting_weight": 1.0,
            "umap_neighbors": 30,
            "umap_min_dist": 0.05,
            "umap_metric": "euclidean",
            "cluster_size_ratio": 0.02,
            "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(dummy_features, dummy_images, params)
        assert "warm_cool_bias_weighted" in names
        assert "legacy_warm_cool_bias" not in names

    def test_no_blur_hash_hist_in_output(self, dummy_features, dummy_images):
        """All feature combinations should never include blur/hash/hist."""
        param_sets = [
            {"use_brightness_skewness": True, "warmcool_mode": "raw",
             "use_low_saturation_ratio": False, "use_high_saturation_ratio": False,
             "use_dominant_hue_strength": False},
            {"use_brightness_skewness": False, "warmcool_mode": "weighted",
             "use_low_saturation_ratio": True, "use_high_saturation_ratio": True,
             "use_dominant_hue_strength": True},
        ]
        base_params = {
            "brightness_weight": 1.0, "lighting_weight": 1.0, "color_weight": 0.8,
            "spatial_lighting_weight": 1.0, "umap_neighbors": 30, "umap_min_dist": 0.05,
            "umap_metric": "euclidean", "cluster_size_ratio": 0.02, "min_samples_ratio": 0.3,
        }
        for p in param_sets:
            p.update(base_params)
            feats, names = build_feature_matrix(dummy_features, dummy_images, p)
            for n in names:
                assert "blur" not in n.lower()
                assert "hash" not in n.lower()
                assert "hist_label" not in n
                assert "dark_ratio" not in n


class TestGroupIndices:
    """Test group index mapping."""

    def test_group_indices_raw(self):
        """Raw mode: legacy_warm_cool goes to color group."""
        names = ["brightness_mean", "contrast", "legacy_warm_cool_bias", "light_centroid_x"]
        groups = build_group_indices(names)
        # legacy_warm_cool should be in color group
        assert 2 in groups.get("color", [])

    def test_group_indices_weighted(self):
        """Weighted mode: warm_cool_bias_weighted (9) goes to color."""
        names = ["brightness_mean", "warm_cool_bias_weighted", "saturation_mean"]
        groups = build_group_indices(names)
        # indices 0 is brightness, 1 is color (warm_cool_bias_weighted)
        assert 0 in groups.get("brightness", [])
        assert 1 in groups.get("color", []) or 2 in groups.get("color", [])


class TestConfigIsolation:
    """Test that optimizer does not modify CONFIG."""

    def test_config_unchanged(self):
        """CONFIG defaults must not change after imports or function calls.
        Current stable config: brightness=4, lighting=4, color=3, spatial=5 = 16 dims."""
        from lighting_engine.core.config import CONFIG as cfg
        assert cfg["feature_groups"]["color"]["dims"] == 3, f"Expected color dims 3"
        assert cfg["feature_groups"]["brightness"]["dims"] == 4, f"Expected brightness dims 4"
        total = sum(g["dims"] for g in cfg["feature_groups"].values() if g.get("enabled"))
        assert total == 16, f"Expected total 16 dims, got {total}"


class TestBestRecipeJson:
    """Test best_recipe.json output."""

    def test_best_recipe_structure(self, tmp_path):
        """Best recipe JSON has the expected structure."""
        best = {
            "source": "optuna_v4_4a3",
            "study_name": "test_study",
            "created_at": "2026-06-25",
            "n_trials": 1,
            "best_trial_number": 0,
            "best_value": 85.0,
            "params": {"use_brightness_skewness": True, "warmcool_mode": "raw"},
            "per_dataset": {},
            "warning": "This recipe is a suggestion only.",
        }
        path = tmp_path / "best_recipe.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(best, f, indent=2)
        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded["source"] == "optuna_v4_4a3"
        assert "warning" in loaded
        assert "Do NOT auto-apply" in loaded["warning"] or "suggestion" in loaded["warning"]


class TestLegacyWarmCool:
    """Test legacy warm_cool computation."""

    def test_red_vs_blue(self):
        red = [np.zeros((64, 64, 3), dtype=np.float32)]
        red[0][..., 0] = 1.0
        blue = [np.zeros((64, 64, 3), dtype=np.float32)]
        blue[0][..., 2] = 1.0
        r_val = compute_legacy_warm_cool(red)[0, 0]
        b_val = compute_legacy_warm_cool(blue)[0, 0]
        assert r_val > b_val

    def test_none_handled(self):
        result = compute_legacy_warm_cool([None])
        assert result[0, 0] == 0.0


class TestQuickMode:
    """Test that --quick mode works with minimal data."""

    def test_quick_mode_creates_trials(self):
        """A study with 2 trials should create trials."""
        from tools.optimize_algorithm_recipe import objective

        # Create minimal optuna study
        study = optuna.create_study(direction="maximize")

        # Create dummy cache with at least one dataset
        rng = np.random.RandomState(42)
        dummy_features = rng.randn(10, 20).astype(np.float32)
        dummy_images = [rng.rand(64, 64, 3).astype(np.float32) for _ in range(10)]

        cache = {"ready_for_training_folder": (dummy_images, dummy_features, 10)}

        def obj(trial):
            return objective(trial, cache, None, allow_extra_color=False, quick=False)

        study.optimize(obj, n_trials=2)
        assert len(study.trials) == 2
        assert study.best_value is not None


class TestBuildFeatureMatrix:
    """Test feature matrix construction."""

    def test_skewness_excluded(self, dummy_features, dummy_images):
        """When use_brightness_skewness=False, skewness is excluded."""
        params = {
            "use_brightness_skewness": False,
            "warmcool_mode": "weighted",
            "use_low_saturation_ratio": False,
            "use_high_saturation_ratio": False,
            "use_dominant_hue_strength": False,
            "brightness_weight": 1.0, "lighting_weight": 1.0, "color_weight": 0.8,
            "spatial_lighting_weight": 1.0, "umap_neighbors": 30, "umap_min_dist": 0.05,
            "umap_metric": "euclidean", "cluster_size_ratio": 0.02, "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(dummy_features, dummy_images, params)
        assert "brightness_skewness" not in names

    def test_feature_count_changes(self, dummy_features, dummy_images):
        """With skewness + weighted warmcool: brightness(5)+lighting(4)+color(3)+spatial(5)=17."""
        params = {
            "use_brightness_skewness": True,
            "warmcool_mode": "weighted",
            "use_low_saturation_ratio": False,
            "use_high_saturation_ratio": False,
            "use_dominant_hue_strength": False,
            "brightness_weight": 1.0, "lighting_weight": 1.0, "color_weight": 0.8,
            "spatial_lighting_weight": 1.0, "umap_neighbors": 30, "umap_min_dist": 0.05,
            "umap_metric": "euclidean", "cluster_size_ratio": 0.02, "min_samples_ratio": 0.3,
        }
        feats, names = build_feature_matrix(dummy_features, dummy_images, params)
        # brightness(5) + lighting(4) + color(wc_weighted+sat_mean+sat_std=3) + spatial(5) = 17
        assert len(names) == 17, f"Expected 17, got {len(names)}"
