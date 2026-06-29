"""Tests for analysis API endpoints (v4.5-ui).

Covers:
1. GET /analysis/status — cache status reporting
2. POST /analysis/build  — channel building
3. GET /analysis/metadata-summary — metadata sort/paginate
4. GET /analysis/histogram-summary — histogram sort/filter/paginate
5. GET /analysis/quality-edge-summary — quality-edge sort/filter/paginate
"""

import base64
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
from studio.api.app import app


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def fake_job_dir(tmp_path):
    """Create a fake job directory with atlas_points.csv, features.csv and dummy images."""
    from PIL import Image
    rng = np.random.RandomState(42)
    n = 15

    # Create tiny dummy images so _resolve_image_paths can find them
    for i in range(n):
        img = Image.new("RGB", (4, 4), color=(rng.randint(0, 255),) * 3)
        img.save(tmp_path / f"img_{i:04d}.jpg")

    # atlas_points.csv
    atlas_df = pd.DataFrame({
        "image_path": [f"img_{i:04d}.jpg" for i in range(n)],
        "cluster_id": rng.randint(0, 3, n).tolist(),
        "umap_x": rng.randn(n),
        "umap_y": rng.randn(n),
    })
    atlas_df.to_csv(tmp_path / "atlas_points.csv", index=False)

    # features.csv
    features_df = pd.DataFrame({
        "filename": [f"img_{i:04d}.jpg" for i in range(n)],
        "brightness_mean": rng.rand(n),
        "brightness_std": rng.rand(n) * 0.3,
        "cluster_id": rng.randint(0, 3, n).tolist(),
    })
    features_df.to_csv(tmp_path / "features.csv", index=False)

    return tmp_path


@pytest.fixture
def mock_resolve_job_dir(monkeypatch, fake_job_dir):
    """Monkeypatch _resolve_job_dir_safe to return the fake job dir."""
    from studio.api.routers import results
    monkeypatch.setattr(results, "_PROJECT_ROOT", fake_job_dir.parent)
    monkeypatch.setattr(results, "_OUTPUTS_BASE", fake_job_dir.parent)


def _write_csv(job_dir: Path, rel_path: str, df: pd.DataFrame):
    """Write a CSV to a job dir, creating subdirs as needed."""
    full_path = job_dir / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(full_path, index=False)


def _write_json(job_dir: Path, rel_path: str, data: dict):
    """Write a JSON file to a job dir."""
    full_path = job_dir / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ============================================================
# Status API Tests
# ============================================================

class TestAnalysisStatus:
    """GET /analysis/status"""

    def test_status_no_channels(self, fake_job_dir, mock_resolve_job_dir):
        """No channel CSVs → all ready flags false."""
        client = TestClient(app)
        job_id = fake_job_dir.name
        resp = client.get(f"/api/v1/jobs/{job_id}/analysis/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["basic_metadata_ready"] is False
        assert data["histogram_ready"] is False
        assert data["quality_edge_ready"] is False
        assert data["available_metadata_sort_fields"] == []

    def test_status_basic_metadata_ready(self, fake_job_dir, mock_resolve_job_dir):
        """basic_metadata_summary.csv exists → ready."""
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({"image_path": ["a.jpg"], "width": [100]}))
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["basic_metadata_ready"] is True
        assert data["available_metadata_sort_fields"] != []

    def test_status_histogram_ready(self, fake_job_dir, mock_resolve_job_dir):
        """histogram_summary.csv exists → ready + sort fields."""
        _write_csv(fake_job_dir, "analysis/histogram_summary.csv",
                   pd.DataFrame({"image_id": ["a"], "brightness_dark_ratio": [0.5]}))
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/status")
        data = resp.json()
        assert data["histogram_ready"] is True
        assert "brightness_dark_ratio" in data["available_sort_fields"]

    def test_status_quality_edge_ready(self, fake_job_dir, mock_resolve_job_dir):
        """quality_edge_summary.csv exists → ready."""
        _write_csv(fake_job_dir, "analysis_channels/quality_edge_summary.csv",
                   pd.DataFrame({"image_path": ["a"], "sharpness_score": [0.5]}))
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/status")
        data = resp.json()
        assert data["quality_edge_ready"] is True

    def test_status_all_channels_ready(self, fake_job_dir, mock_resolve_job_dir):
        """All three CSVs → all ready."""
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({"image_path": ["a"], "width": [100]}))
        _write_csv(fake_job_dir, "analysis/histogram_summary.csv",
                   pd.DataFrame({"image_id": ["a"], "brightness_dark_ratio": [0.5]}))
        _write_csv(fake_job_dir, "analysis_channels/quality_edge_summary.csv",
                   pd.DataFrame({"image_path": ["a"], "sharpness_score": [0.5]}))
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/status")
        data = resp.json()
        assert data["basic_metadata_ready"] is True
        assert data["histogram_ready"] is True
        assert data["quality_edge_ready"] is True

    def test_status_job_not_found_graceful(self, tmp_path, monkeypatch):
        """Unknown job_id → 200 with all ready flags false (graceful)."""
        from studio.api.routers import results, jobs
        monkeypatch.setattr(results, "_PROJECT_ROOT", tmp_path)
        monkeypatch.setattr(results, "_OUTPUTS_BASE", tmp_path)
        monkeypatch.setattr(jobs, "_jobs", {})
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/zzz_definitely_nonexistent/analysis/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["basic_metadata_ready"] is False
        assert data["histogram_ready"] is False
        assert data["quality_edge_ready"] is False


# ============================================================
# Build API Tests
# ============================================================

class TestBuildChannel:
    """POST /analysis/build"""

    def test_build_basic_metadata(self, fake_job_dir, mock_resolve_job_dir):
        """Build basic_metadata channel → status=built."""
        client = TestClient(app)
        resp = client.post(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/build",
            params={"channel": "basic_metadata"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["channel"] == "basic_metadata"
        assert data["status"] == "built"
        assert data["image_count"] > 0

    def test_build_twice_returns_already_ready(self, fake_job_dir, mock_resolve_job_dir):
        """Building same channel twice → already_ready."""
        client = TestClient(app)
        job_id = fake_job_dir.name
        client.post(f"/api/v1/jobs/{job_id}/analysis/build", params={"channel": "basic_metadata"})
        resp2 = client.post(f"/api/v1/jobs/{job_id}/analysis/build", params={"channel": "basic_metadata"})
        assert resp2.status_code == 200
        assert resp2.json()["status"] == "already_ready"

    def test_build_force_rebuilds(self, fake_job_dir, mock_resolve_job_dir):
        """force=true → rebuild even if exists."""
        client = TestClient(app)
        job_id = fake_job_dir.name
        client.post(f"/api/v1/jobs/{job_id}/analysis/build", params={"channel": "basic_metadata"})
        resp = client.post(
            f"/api/v1/jobs/{job_id}/analysis/build",
            params={"channel": "basic_metadata", "force": True},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "built"

    def test_build_invalid_channel(self, fake_job_dir, mock_resolve_job_dir):
        """Invalid channel name → 422."""
        client = TestClient(app)
        resp = client.post(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/build",
            params={"channel": "invalid_channel"},
        )
        assert resp.status_code == 422

    def test_build_job_not_found(self):
        """Unknown job → 404."""
        client = TestClient(app)
        resp = client.post(
            "/api/v1/jobs/nonexistent/analysis/build",
            params={"channel": "basic_metadata"},
        )
        assert resp.status_code == 404


# ============================================================
# Metadata Summary API Tests
# ============================================================

class TestMetadataSummary:
    """GET /analysis/metadata-summary"""

    def test_metadata_not_found(self, fake_job_dir, mock_resolve_job_dir):
        """No CSV → 404."""
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/metadata-summary")
        assert resp.status_code == 404

    def test_metadata_default_sort(self, fake_job_dir, mock_resolve_job_dir):
        """Default (no params) returns records sorted by any field."""
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({
                       "image_path": [f"img_{i}.jpg" for i in range(5)],
                       "width": [100, 200, 300, 400, 500],
                       "height": [100, 150, 200, 250, 300],
                       "megapixels": [0.01, 0.03, 0.06, 0.1, 0.15],
                       "short_side": [100, 150, 200, 250, 300],
                       "long_side": [100, 200, 300, 400, 500],
                       "aspect_ratio": [1.0, 1.33, 1.5, 1.6, 1.67],
                       "clipping_ratio": [0.0, 0.01, 0.02, 0.03, 0.04],
                   }))
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/metadata-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["total"] == 5
        assert len(data["records"]) == 5

    def test_metadata_sort_by_megapixels(self, fake_job_dir, mock_resolve_job_dir):
        """Sort by megapixels descending."""
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({
                       "image_path": [f"img_{i}.jpg" for i in range(3)],
                       "megapixels": [0.1, 0.5, 0.3],
                       "width": [100, 200, 150],
                       "height": [100, 200, 150],
                       "short_side": [100, 200, 150],
                       "long_side": [100, 200, 150],
                       "aspect_ratio": [1.0, 1.0, 1.0],
                       "clipping_ratio": [0.0, 0.0, 0.0],
                   }))
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/metadata-summary",
            params={"sort_by": "megapixels", "sort_order": "desc"},
        )
        data = resp.json()
        mp = [r["megapixels"] for r in data["records"]]
        assert mp == sorted(mp, reverse=True)

    def test_metadata_invalid_sort_field(self, fake_job_dir, mock_resolve_job_dir):
        """Invalid sort_by → 400."""
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({"image_path": ["a.jpg"], "width": [100]}))
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/metadata-summary",
            params={"sort_by": "invalid_field"},
        )
        assert resp.status_code == 400

    def test_metadata_pagination(self, fake_job_dir, mock_resolve_job_dir):
        """Limit/offset pagination."""
        n = 20
        _write_csv(fake_job_dir, "analysis_channels/basic_metadata_summary.csv",
                   pd.DataFrame({
                       "image_path": [f"img_{i}.jpg" for i in range(n)],
                       "megapixels": [float(i) for i in range(n)],
                       "width": [100] * n,
                       "height": [100] * n,
                       "short_side": [100] * n,
                       "long_side": [100] * n,
                       "aspect_ratio": [1.0] * n,
                       "clipping_ratio": [0.0] * n,
                   }))
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/metadata-summary",
            params={"limit": 5, "offset": 3},
        )
        data = resp.json()
        assert len(data["records"]) == 5
        assert data["offset"] == 3
        assert data["limit"] == 5
        assert data["total"] == n


# ============================================================
# Histogram Summary API Tests
# ============================================================

class TestHistogramSummary:
    """GET /analysis/histogram-summary"""

    def test_not_found(self, fake_job_dir, mock_resolve_job_dir):
        """No CSV → 404."""
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/histogram-summary")
        assert resp.status_code == 404

    def test_sort_by_dark_ratio(self, fake_job_dir, mock_resolve_job_dir):
        """Sort by brightness_dark_ratio."""
        rng = np.random.RandomState(42)
        df = pd.DataFrame({
            "image_id": [f"img_{i:06d}" for i in range(10)],
            "image_path": [f"/path/img_{i}.jpg" for i in range(10)],
            "brightness_dark_ratio": rng.rand(10) * 0.6,
            "brightness_bright_ratio": rng.rand(10) * 0.5,
            "brightness_entropy": 2 + rng.rand(10) * 2,
            "saturation_low_ratio": rng.rand(10) * 0.8,
            "saturation_high_ratio": rng.rand(10) * 0.4,
            "hue_warm_ratio": rng.rand(10) * 0.7,
            "hue_cool_ratio": rng.rand(10) * 0.7,
            "histogram_outlier_score": rng.rand(10) * 3,
            "labels": ["unclassified"] * 10,
        })
        _write_csv(fake_job_dir, "analysis/histogram_summary.csv", df)
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/histogram-summary",
            params={"sort_by": "brightness_dark_ratio", "sort_order": "desc"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["total"] == 10
        vals = [r["brightness_dark_ratio"] for r in data["records"]]
        for i in range(len(vals) - 1):
            assert vals[i] >= vals[i + 1], "Not sorted descending"

    def test_filter_by_label(self, fake_job_dir, mock_resolve_job_dir):
        """Filter by label."""
        df = pd.DataFrame({
            "image_id": [f"img_{i:06d}" for i in range(10)],
            "image_path": [f"/path/img_{i}.jpg" for i in range(10)],
            "brightness_dark_ratio": [0.1] * 10,
            "brightness_bright_ratio": [0.2] * 10,
            "brightness_entropy": [2.0] * 10,
            "saturation_low_ratio": [0.3] * 10,
            "saturation_high_ratio": [0.4] * 10,
            "hue_warm_ratio": [0.5] * 10,
            "hue_cool_ratio": [0.6] * 10,
            "histogram_outlier_score": [1.0] * 10,
            "labels": ["low_key;muted"] * 5 + ["high_key;vivid"] * 5,
        })
        _write_csv(fake_job_dir, "analysis/histogram_summary.csv", df)
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/histogram-summary",
            params={"label": "low_key"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        for r in data["records"]:
            assert "low_key" in r["labels"]

    def test_invalid_sort_field(self, fake_job_dir, mock_resolve_job_dir):
        """Invalid sort_by → 400."""
        df = pd.DataFrame({"image_id": ["a"], "image_path": ["a.jpg"],
                           "labels": [""], "brightness_dark_ratio": [0.1],
                           "brightness_bright_ratio": [0.2], "brightness_entropy": [2.0],
                           "saturation_low_ratio": [0.3], "saturation_high_ratio": [0.4],
                           "hue_warm_ratio": [0.5], "hue_cool_ratio": [0.6],
                           "histogram_outlier_score": [1.0]})
        _write_csv(fake_job_dir, "analysis/histogram_summary.csv", df)
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/histogram-summary",
            params={"sort_by": "invalid"},
        )
        assert resp.status_code == 400


# ============================================================
# Quality-Edge Summary API Tests
# ============================================================

class TestQualityEdgeSummary:
    """GET /analysis/quality-edge-summary"""

    def test_not_found(self, fake_job_dir, mock_resolve_job_dir):
        """No CSV → 404."""
        client = TestClient(app)
        resp = client.get(f"/api/v1/jobs/{fake_job_dir.name}/analysis/quality-edge-summary")
        assert resp.status_code == 404

    def test_sort_by_sharpness(self, fake_job_dir, mock_resolve_job_dir):
        """Sort by sharpness_score descending."""
        df = pd.DataFrame({
            "image_path": [f"img_{i}.jpg" for i in range(5)],
            "sharpness_score": [0.1, 0.5, 0.3, 0.8, 0.2],
            "blur_laplacian_var": [10, 50, 30, 80, 20],
            "edge_density": [0.01, 0.05, 0.03, 0.08, 0.02],
            "edge_strength_p95": [0.1, 0.5, 0.3, 0.8, 0.2],
            "local_contrast_p95": [0.1, 0.5, 0.3, 0.8, 0.2],
            "hue_coverage": [0.1, 0.5, 0.3, 0.8, 0.2],
            "lineart_score_v2": [0.1, 0.5, 0.3, 0.8, 0.2],
            "high_contrast_score_v2": [0.1, 0.5, 0.3, 0.8, 0.2],
            "flat_color_score": [0.1, 0.5, 0.3, 0.8, 0.2],
        })
        _write_csv(fake_job_dir, "analysis/quality_edge_summary.csv", df)
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/quality-edge-summary",
            params={"sort_by": "sharpness_score", "sort_order": "desc"},
        )
        assert resp.status_code == 200
        data = resp.json()
        vals = [r["sharpness_score"] for r in data["records"]]
        for i in range(len(vals) - 1):
            assert vals[i] >= vals[i + 1]

    def test_invalid_sort_field(self, fake_job_dir, mock_resolve_job_dir):
        """Invalid sort_by → 400."""
        df = pd.DataFrame({
            "image_path": ["a.jpg"],
            "sharpness_score": [0.5],
            "blur_laplacian_var": [50],
            "edge_density": [0.05],
            "edge_strength_p95": [0.5],
            "local_contrast_p95": [0.5],
            "hue_coverage": [0.5],
            "lineart_score_v2": [0.5],
            "high_contrast_score_v2": [0.5],
            "flat_color_score": [0.5],
        })
        _write_csv(fake_job_dir, "analysis/quality_edge_summary.csv", df)
        client = TestClient(app)
        resp = client.get(
            f"/api/v1/jobs/{fake_job_dir.name}/analysis/quality-edge-summary",
            params={"sort_by": "invalid"},
        )
        assert resp.status_code == 400


# ============================================================
# Metadata-only isolation tests
# ============================================================

class TestMetadataIsolation:
    """Analysis channels must not affect default clustering."""

    def test_metadata_fields_not_in_feature_groups(self):
        """Metadata-only fields should not appear in default clustering feature_groups."""
        from lighting_engine.core.config import CONFIG
        meta_fields = {"brightness_skewness", "low_saturation_ratio",
                       "high_saturation_ratio", "dominant_hue_strength",
                       "warm_cool_bias_weighted", "blur_score"}
        for group_name, group in CONFIG["feature_groups"].items():
            if group.get("enabled") and group.get("cluster", True):
                group_label = (group.get("label") or group_name).lower()
                for mf in meta_fields:
                    assert mf not in group_label, f"{mf} found in clustering group {group_name}"


# ============================================================
# Analysis Export API Tests
# ============================================================

class TestAnalysisExport:
    """POST /analysis/export"""

    @staticmethod
    def _image_id(rel_path: str) -> str:
        raw = base64.urlsafe_b64encode(rel_path.encode("utf-8")).decode("ascii")
        return raw.rstrip("=")

    def test_explicit_image_ids_export_originals(self, fake_job_dir, mock_resolve_job_dir):
        """explicit_images copies originals and writes a manifest."""
        input_dir = fake_job_dir / "source_images"
        input_dir.mkdir()
        original = input_dir / "folder_a" / "original_a.png"
        original.parent.mkdir()
        original.write_bytes(b"original image bytes")
        _write_json(fake_job_dir, ".job_state.json", {
            "config": {"input_folders": [str(input_dir)]},
        })

        output_root = fake_job_dir / "exports_out"
        client = TestClient(app)
        image_id = self._image_id("folder_a/original_a.png")
        resp = client.post(f"/api/v1/jobs/{fake_job_dir.name}/analysis/export", json={
            "mode": "explicit_images",
            "export_name": "selected",
            "output_dir": str(output_root),
            "image_ids": [image_id],
            "copy_mode": "copy_originals",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["copied_count"] == 1
        exported = Path(data["export_dir"]) / "original_a.png"
        assert exported.read_bytes() == b"original image bytes"

        manifest = json.loads(Path(data["manifest_path"]).read_text(encoding="utf-8"))
        assert manifest["mode"] == "explicit_images"
        assert manifest["copy_mode"] == "copy_originals"
        assert manifest["items"][0]["image_id"] == image_id
        assert manifest["items"][0]["source_path"] == str(original.resolve())

    def test_explicit_image_ids_all_invalid_has_clear_error(self, fake_job_dir, mock_resolve_job_dir):
        """All invalid image_ids should not fall back to vague criteria errors."""
        _write_json(fake_job_dir, ".job_state.json", {
            "config": {"input_folders": [str(fake_job_dir)]},
        })
        client = TestClient(app)
        resp = client.post(f"/api/v1/jobs/{fake_job_dir.name}/analysis/export", json={
            "mode": "explicit_images",
            "export_name": "bad",
            "image_ids": ["missing_image_id"],
            "copy_mode": "copy_originals",
        })

        assert resp.status_code == 400
        assert resp.json()["detail"] == "No valid original images found for provided image_ids"

    def test_legacy_channel_image_id_resolves_via_analysis_summary(self, fake_job_dir, mock_resolve_job_dir):
        """Legacy histogram ids such as img_000000 should still resolve through summary CSVs."""
        input_dir = fake_job_dir / "source_images"
        input_dir.mkdir()
        original = input_dir / "legacy_a.jpg"
        original.write_bytes(b"legacy original bytes")
        _write_json(fake_job_dir, ".job_state.json", {
            "config": {"input_folders": [str(input_dir)]},
        })
        _write_csv(fake_job_dir, "analysis_channels/histogram_summary.csv", pd.DataFrame({
            "image_id": ["img_000000"],
            "image_path": ["legacy_a.jpg"],
            "brightness_dark_ratio": [0.5],
        }))

        output_root = fake_job_dir / "exports_legacy"
        client = TestClient(app)
        resp = client.post(f"/api/v1/jobs/{fake_job_dir.name}/analysis/export", json={
            "mode": "explicit_images",
            "export_name": "legacy",
            "output_dir": str(output_root),
            "image_ids": ["img_000000"],
            "copy_mode": "copy_originals",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["copied_count"] == 1
        assert (Path(data["export_dir"]) / "legacy_a.jpg").read_bytes() == b"legacy original bytes"
