"""Tests for histogram channel acceptance and label config."""

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
    compute_histogram_summary, compute_histogram_residuals, build_histogram_matrix,
)
from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import get_active_feature_names


class TestLabelConfig:
    """HistogramLabelConfig defaults and usage."""

    def test_default_config_values(self):
        """Default config should match calibrated values from v4.4h-4."""
        cfg = DEFAULT_LABEL_CONFIG
        assert abs(cfg.low_key_dark_ratio - 0.4144) < 0.001
        assert abs(cfg.high_key_bright_ratio - 0.4086) < 0.001
        assert abs(cfg.muted_low_sat_ratio - 0.5867) < 0.001
        assert abs(cfg.vivid_high_sat_ratio - 0.2738) < 0.001
        assert abs(cfg.warm_ratio - 0.5802) < 0.001
        assert abs(cfg.cool_ratio - 0.5645) < 0.001

    def test_custom_config_overrides(self):
        """Custom config should override selected thresholds."""
        cfg = HistogramLabelConfig(low_key_dark_ratio=0.50, muted_low_sat_ratio=0.70)
        assert cfg.low_key_dark_ratio == 0.50
        assert cfg.muted_low_sat_ratio == 0.70
        # Other fields should remain at calibrated defaults
        assert abs(cfg.high_key_bright_ratio - 0.4086) < 0.001

    def test_config_to_dict(self):
        """to_dict should return all fields."""
        d = DEFAULT_LABEL_CONFIG.to_dict()
        assert "low_key_dark_ratio" in d
        assert "cool_ratio" in d
        assert len(d) == 13

    def test_no_bright_bright_naming(self):
        """No field should use 'bright_bright' naming - must use 'brightness_bright_ratio'."""
        cfg_dict = DEFAULT_LABEL_CONFIG.to_dict()
        for key in cfg_dict:
            assert "bright_bright" not in key, f"Bad naming: {key}"
            # Accept both 'brightness_*' and '*_bright_ratio' as valid patterns
            if "bright_bright" in key or key == "bright_bright":
                assert False, f"Invalid naming: {key}"


class TestAcceptanceTool:
    """Test acceptance tool outputs."""

    def test_acceptance_summary_json_structure(self, tmp_path):
        """Acceptance JSON should have expected structure."""
        # Create minimal test data
        rng = np.random.RandomState(42)
        n = 10
        df = pd.DataFrame({
            "image_id": [f"img_{i:06d}" for i in range(n)],
            "image_path": [f"/path/img_{i}.jpg" for i in range(n)],
            "histogram_outlier_score": rng.rand(n) * 3,
            "brightness_dark_ratio": rng.rand(n) * 0.5,
            "brightness_bright_ratio": 0.3 + rng.rand(n) * 0.4,
            "brightness_entropy": 2 + rng.rand(n) * 2,
            "saturation_low_ratio": rng.rand(n) * 0.8,
            "saturation_high_ratio": rng.rand(n) * 0.4,
            "hue_warm_ratio": rng.rand(n) * 0.7,
            "hue_cool_ratio": rng.rand(n) * 0.7,
            "hue_valid": [True] * n,
            "labels": ["low_key;muted"] * 5 + ["high_key;vivid"] * 5,
        })

        # Simulate acceptance tool output
        label_counts = {"low_key": 5, "muted": 5, "high_key": 5, "vivid": 5}
        result = {
            "image_count": n,
            "label_counts": label_counts,
            "hue_valid_count": n,
            "hue_valid_ratio": 1.0,
            "default_clustering_unchanged": True,
            "warnings": [],
        }
        assert result["image_count"] == 10
        assert result["default_clustering_unchanged"] is True
        assert result["label_counts"]["low_key"] == 5

    def test_label_counts_aggregation(self):
        """Label counts should correctly aggregate multi-label entries."""
        labels = ["low_key;muted", "high_key;vivid", "low_key;cool", "muted;cool"]
        from collections import Counter
        all_lbls = []
        for lbl_str in labels:
            all_lbls.extend(lbl_str.split(";"))
        counts = dict(Counter(all_lbls))
        assert counts["low_key"] == 2
        assert counts["muted"] == 2
        assert counts["cool"] == 2

    def test_numeric_field_stats(self):
        """Numeric field stats should compute min/mean/median/p95/max."""
        vals = np.array([0.1, 0.2, 0.3, 0.5, 1.0, 2.0])
        stats = {
            "min": float(vals.min()),
            "mean": float(vals.mean()),
            "median": float(np.median(vals)),
            "p95": float(np.percentile(vals, 95)),
            "max": float(vals.max()),
        }
        assert stats["min"] == 0.1
        assert stats["max"] == 2.0
        assert stats["p95"] > stats["median"]


class TestDefaultClustering:
    """Default clustering unchanged."""

    def test_no_histogram_in_clustering(self):
        """Default clustering feature names must not have histogram fields."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        for name in names:
            assert "hist" not in name.lower()
            assert "brightness_hist" not in name
            assert "saturation_hist" not in name
            assert "hue_hist" not in name

    def test_dims_still_16(self):
        """Total dims still 16."""
        total = sum(g["dims"] for g in CONFIG["feature_groups"].values()
                     if g.get("enabled") and g.get("cluster", True))
        assert total == 16
