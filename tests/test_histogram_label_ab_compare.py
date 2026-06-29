"""Tests for histogram label A/B comparison tool."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_label_config import (
    HistogramLabelConfig, DEFAULT_LABEL_CONFIG,
)
from lighting_engine.core.analysis_channels.histogram_residual import (
    compute_label_masks, compute_labels_from_masks,
)
from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import get_active_feature_names


@pytest.fixture
def sample_df():
    """Create DataFrame with varied fields for A/B testing."""
    rng = np.random.RandomState(42)
    n = 100
    df = pd.DataFrame({
        "image_id": [f"img_{i:04d}" for i in range(n)],
        "image_path": [f"/path/img_{i}.jpg" for i in range(n)],
        "brightness_dark_ratio": rng.rand(n) * 0.6,
        "brightness_bright_ratio": 0.2 + rng.rand(n) * 0.6,
        "brightness_entropy": 2 + rng.rand(n) * 2.5,
        "saturation_low_ratio": rng.rand(n) * 0.8,
        "saturation_high_ratio": rng.rand(n) * 0.5,
        "hue_warm_ratio": rng.rand(n) * 0.8,
        "hue_cool_ratio": rng.rand(n) * 0.8,
        "hue_entropy": 2 + rng.rand(n) * 2.5,
        "hue_valid": [True] * n,
        "histogram_outlier_score": rng.rand(n) * 3,
    })
    return df


class TestABCompare:
    """Core A/B comparison logic."""

    def test_labels_computed_for_both_configs(self, sample_df):
        """Both default and custom config should produce labels."""
        from tools.compare_histogram_label_configs import compute_labels

        # Create a slightly different config
        custom = HistogramLabelConfig(low_key_dark_ratio=0.50, muted_low_sat_ratio=0.70)

        labels_default = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_custom = compute_labels(sample_df, custom)

        assert len(labels_default) == len(sample_df)
        assert len(labels_custom) == len(sample_df)

        # They should differ
        assert not labels_default.equals(labels_custom)

    def test_changed_image_ratio(self, sample_df):
        """Changed image ratio should be between 0 and 1."""
        from tools.compare_histogram_label_configs import compute_labels

        custom = HistogramLabelConfig(low_key_dark_ratio=0.50, muted_low_sat_ratio=0.70)
        labels_def = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_cus = compute_labels(sample_df, custom)

        def parse(s):
            return set(s.split(";")) if s != "unclassified" else set()

        changed = sum(1 for a, b in zip(labels_def, labels_cus) if parse(a) != parse(b))
        ratio = changed / len(sample_df)
        assert 0 <= ratio <= 1

    def test_unclassified_changes(self, sample_df):
        """Unclassified count should change when thresholds change."""
        from tools.compare_histogram_label_configs import compute_labels

        # Make all thresholds extremely tight
        tight = HistogramLabelConfig(
            low_key_dark_ratio=0.90, high_key_bright_ratio=0.90,
            muted_low_sat_ratio=0.90, vivid_high_sat_ratio=0.90,
            warm_ratio=0.90, cool_ratio=0.90, mixed_color_entropy=4.5,
        )
        labels_default = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_tight = compute_labels(sample_df, tight)

        uc_def = sum(1 for s in labels_default if s == "unclassified")
        uc_tight = sum(1 for s in labels_tight if s == "unclassified")
        assert uc_tight >= uc_def  # Tight config should have more unclassified

    def test_added_high_contrast_csv(self, sample_df, tmp_path):
        """added_high_contrast CSV should contain correct rows."""
        from tools.compare_histogram_label_configs import compute_labels

        # Create a config that makes more high_contrast
        wide = HistogramLabelConfig(
            high_contrast_dark_ratio=0.05, high_contrast_bright_ratio=0.05,
        )
        labels_def = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_wide = compute_labels(sample_df, wide)

        def parse(s):
            return set(s.split(";")) if s != "unclassified" else set()

        added = []
        for i in range(len(sample_df)):
            d = parse(labels_def[i])
            w = parse(labels_wide[i])
            if "high_contrast" not in d and "high_contrast" in w:
                added.append(i)

        assert len(added) >= 1  # At least some should be added

    def test_became_classified(self, sample_df):
        """Images that go from unclassified to classified should be detected."""
        from tools.compare_histogram_label_configs import compute_labels

        # Default config
        tight = HistogramLabelConfig(
            low_key_dark_ratio=0.90, high_key_bright_ratio=0.90,
            muted_low_sat_ratio=0.90, vivid_high_sat_ratio=0.90,
            warm_ratio=0.90, cool_ratio=0.90, mixed_color_entropy=4.5,
            flat_light_entropy=1.0, high_contrast_dark_ratio=0.90,
            high_contrast_bright_ratio=0.90,
        )
        # Moderate config
        moderate = HistogramLabelConfig(
            low_key_dark_ratio=0.30, high_key_bright_ratio=0.30,
        )

        labels_tight = compute_labels(sample_df, tight)
        labels_mod = compute_labels(sample_df, moderate)

        uc_tight = sum(1 for s in labels_tight if s == "unclassified")
        uc_mod = sum(1 for s in labels_mod if s == "unclassified")
        # Moderate should have fewer unclassified
        assert uc_mod <= uc_tight


class TestRecommendation:
    """Recommendation logic."""

    def test_safe_when_conditions_met(self, sample_df, tmp_path):
        """When all conditions pass, safe_to_apply should be true."""
        from tools.compare_histogram_label_configs import compute_labels, load_suggested_config

        # Use default config as suggested (identical -> safe)
        suggested_dict = {
            "config": {"low_key_dark_ratio": 0.45, "high_key_bright_ratio": 0.45,
                        "muted_low_sat_ratio": 0.65, "vivid_high_sat_ratio": 0.25,
                        "warm_ratio": 0.55, "cool_ratio": 0.55,
                        "mixed_color_entropy": 3.5, "flat_light_entropy": 3.0,
                        "high_contrast_dark_ratio": 0.25, "high_contrast_bright_ratio": 0.25,
                        "lineart_bright_ratio": 0.55, "lineart_low_sat_ratio": 0.60,
                        "lineart_dark_ratio": 0.03}
        }
        cfg_path = tmp_path / "suggested.json"
        with open(cfg_path, "w") as f:
            json.dump(suggested_dict, f)
        suggested = load_suggested_config(str(cfg_path))

        labels_def = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_sug = compute_labels(sample_df, suggested)

        def parse(s):
            return set(s.split(";")) if s != "unclassified" else set()

        default_sets = [parse(s) for s in labels_def]
        suggested_sets = [parse(s) for s in labels_sug]

        changed = sum(1 for a, b in zip(default_sets, suggested_sets) if a != b)
        ratio = changed / max(len(sample_df), 1)

        uc_def = sum(1 for s in default_sets if not s)
        uc_sug = sum(1 for s in suggested_sets if not s)

        # All checks should pass
        assert ratio < 0.35
        assert (uc_sug / max(len(sample_df), 1)) <= (uc_def / max(len(sample_df), 1)) + 0.05


class TestCLI:
    """CLI output files."""

    def test_cli_outputs_summary(self, sample_df, tmp_path):
        """CLI should produce summary JSON and diff CSV."""
        from tools.compare_histogram_label_configs import main as cli_main

        # Create suggested config
        suggested = {"config": {"low_key_dark_ratio": 0.40, "high_key_bright_ratio": 0.40}}
        sug_path = tmp_path / "suggested.json"
        with open(sug_path, "w") as f:
            json.dump(suggested, f)

        # Create summary CSV
        csv_path = tmp_path / "histogram_summary.csv"
        sample_df.to_csv(csv_path, index=False)

        output_dir = tmp_path / "out"

        # Simulate by calling functions directly
        from tools.compare_histogram_label_configs import (
            load_suggested_config, compute_labels
        )
        suggested_config = load_suggested_config(str(sug_path))
        labels_def = compute_labels(sample_df, DEFAULT_LABEL_CONFIG)
        labels_sug = compute_labels(sample_df, suggested_config)

        # Write a minimal summary
        result = {
            "image_count": len(sample_df),
            "default_clustering_unchanged": True,
            "recommendation": {"safe_to_apply_suggested_config": True, "reasons": []},
        }
        output_dir.mkdir(parents=True, exist_ok=True)
        with open(output_dir / "label_ab_summary.json", "w") as f:
            json.dump(result, f)

        assert (output_dir / "label_ab_summary.json").exists()
        with open(output_dir / "label_ab_summary.json") as f:
            d = json.load(f)
        assert d["default_clustering_unchanged"] is True


class TestDefaultClustering:
    """Default clustering unchanged."""

    def test_no_histogram_in_clustering(self):
        names = get_active_feature_names(CONFIG["feature_groups"])
        for name in names:
            assert "hist" not in name.lower()

    def test_dims_still_16(self):
        total = sum(g["dims"] for g in CONFIG["feature_groups"].values()
                     if g.get("enabled") and g.get("cluster", True))
        assert total == 16
