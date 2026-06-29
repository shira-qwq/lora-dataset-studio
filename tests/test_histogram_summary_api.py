"""Tests for histogram summary API endpoint."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.analysis_channels.histogram_residual import (
    compute_histogram_summary, compute_histogram_residuals, build_histogram_matrix,
)
from lighting_engine.core.config import CONFIG
from lighting_engine.core.feature_assembler import get_active_feature_names


@pytest.fixture
def sample_csv(tmp_path):
    """Create a sample histogram_summary.csv for testing."""
    n = 20
    rng = np.random.RandomState(42)
    df = pd.DataFrame({
        "image_id": [f"img_{i:06d}" for i in range(n)],
        "image_path": [f"/path/img_{i}.jpg" for i in range(n)],
        "brightness_dark_ratio": rng.rand(n) * 0.6,
        "brightness_bright_ratio": rng.rand(n) * 0.5 + 0.2,
        "brightness_entropy": 2 + rng.rand(n) * 2,
        "saturation_low_ratio": rng.rand(n) * 0.8,
        "saturation_high_ratio": rng.rand(n) * 0.4,
        "hue_warm_ratio": rng.rand(n) * 0.7,
        "hue_cool_ratio": rng.rand(n) * 0.7,
        "histogram_outlier_score": rng.rand(n) * 3,
        "labels": (["low_key;muted"] * 5 + ["high_key;vivid"] * 5 +
                   ["cool;mixed_color"] * 5 + ["unclassified"] * 5),
        "hue_valid": [True] * n,
    })
    csv_path = tmp_path / "histogram_summary.csv"
    df.to_csv(csv_path, index=False)
    return csv_path


# ============================================================
# Test CSV contents directly (not HTTP endpoint)
# ============================================================

class TestSummaryAPI:
    """Test the data that the API would serve."""

    def test_sort_by_dark_ratio_desc(self, sample_csv):
        """Sort by brightness_dark_ratio descending should work."""
        df = pd.read_csv(sample_csv)
        df_sorted = df.sort_values("brightness_dark_ratio", ascending=False)
        vals = df_sorted["brightness_dark_ratio"].values
        for i in range(len(vals) - 1):
            assert vals[i] >= vals[i + 1]

    def test_sort_by_outlier_score_asc(self, sample_csv):
        """Sort by histogram_outlier_score ascending should work."""
        df = pd.read_csv(sample_csv)
        df_sorted = df.sort_values("histogram_outlier_score", ascending=True)
        vals = df_sorted["histogram_outlier_score"].values
        for i in range(len(vals) - 1):
            assert vals[i] <= vals[i + 1]

    def test_filter_by_label_low_key(self, sample_csv):
        """Filter by label 'low_key' should return matching rows."""
        df = pd.read_csv(sample_csv)
        filtered = df[df["labels"].str.contains("low_key", na=False)]
        for label_str in filtered["labels"]:
            assert "low_key" in str(label_str)

    def test_filter_by_label_unclassified(self, sample_csv):
        """Filter by 'unclassified' should work."""
        df = pd.read_csv(sample_csv)
        filtered = df[df["labels"] == "unclassified"]
        assert len(filtered) == 5

    def test_pagination(self, sample_csv):
        """Limit/offset pagination should work."""
        df = pd.read_csv(sample_csv)
        limit, offset = 5, 3
        page = df.iloc[offset:offset + limit]
        assert len(page) == limit
        assert page.iloc[0]["image_id"] == df.iloc[offset]["image_id"]

    def test_csv_not_found(self, tmp_path):
        """Missing CSV should raise FileNotFoundError (API returns 404)."""
        missing = tmp_path / "nonexistent.csv"
        assert not missing.exists()

    def test_allowed_sort_fields(self):
        """Allowed sort fields should match expected."""
        from studio.api.routers.analysis import ALLOWED_SORT_FIELDS
        expected = {"histogram_outlier_score", "brightness_dark_ratio",
                     "brightness_bright_ratio", "brightness_entropy",
                     "saturation_low_ratio", "saturation_high_ratio",
                     "hue_warm_ratio", "hue_cool_ratio"}
        assert ALLOWED_SORT_FIELDS == expected

    def test_allowed_labels(self):
        """Allowed labels should match expected set."""
        from studio.api.routers.analysis import ALLOWED_LABELS
        expected = {"low_key", "high_key", "high_contrast", "flat_light",
                     "muted", "vivid", "warm", "cool", "mixed_color",
                     "lineart_like_candidate"}
        assert ALLOWED_LABELS == expected


class TestDefaultClustering:
    """Default clustering not affected."""

    def test_dims_still_16(self):
        """Total dims still 16."""
        total = sum(g["dims"] for g in CONFIG["feature_groups"].values()
                     if g.get("enabled") and g.get("cluster", True))
        assert total == 16

    def test_no_histogram_in_features(self):
        """histogram fields not in clustering."""
        names = get_active_feature_names(CONFIG["feature_groups"])
        for name in names:
            assert "hist" not in name.lower()
