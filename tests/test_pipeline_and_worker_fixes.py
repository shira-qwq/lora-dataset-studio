import sys
from types import SimpleNamespace

import numpy as np

from lighting_engine.core import pipeline
from lighting_engine.core import preprocess
from studio.api.routers import jobs


def test_pipeline_remaps_alive_indices_before_weighting_and_split(tmp_path, monkeypatch):
    features_raw = np.array([
        [10.0, 1.0, 5.0, 7.0],
        [10.0, 2.0, 6.0, 8.0],
        [10.0, 3.0, 7.0, 9.0],
    ])
    feature_groups = {
        "cluster_group": {"enabled": True, "dims": 2, "cluster": True, "weight": 2.0},
        "explain_group": {"enabled": True, "dims": 2, "cluster": False, "weight": 3.0},
    }
    progress = []

    monkeypatch.setattr(pipeline, "find_images", lambda folders: ["a.jpg", "b.jpg", "c.jpg"])
    monkeypatch.setattr(
        pipeline,
        "preprocess_all",
        lambda image_paths, max_workers: [(path, np.zeros((2, 2, 3), dtype=np.uint8)) for path in image_paths],
    )
    monkeypatch.setattr(pipeline, "assemble_batch", lambda *args, **kwargs: (features_raw, {}))
    monkeypatch.setattr(pipeline, "get_active_feature_names", lambda groups: ["g1_a", "g1_b", "g2_a", "g2_b"])

    def fake_compute_diagnostics(features, feature_names, labels=None, use_iqr_dead=True):
        if labels is None:
            return {}, [1, 2, 3], ["g1_a"]
        return {}, list(range(features.shape[1])), []

    monkeypatch.setattr(pipeline, "compute_diagnostics", fake_compute_diagnostics)
    monkeypatch.setattr(pipeline, "compute_quality", lambda embedding, labels: {"silhouette_score": 0.42})
    monkeypatch.setattr(pipeline, "analyze_clusters", lambda *args, **kwargs: {})
    monkeypatch.setattr(pipeline, "run_dual_comparison", lambda *args, **kwargs: {"selected_pipeline": "pipeline_b", "_best_labels": np.array([0, 1, 0])})
    monkeypatch.setattr(pipeline, "detect_redundant_pairs", lambda *args, **kwargs: [])
    monkeypatch.setattr(pipeline, "compute_health", lambda *args, **kwargs: {})
    monkeypatch.setattr(pipeline, "compute_stability", lambda *args, **kwargs: {})
    monkeypatch.setattr(pipeline, "generate_advice", lambda *args, **kwargs: {})
    monkeypatch.setattr(pipeline, "compute_reliability", lambda *args, **kwargs: {})

    class FakeUMAP:
        def __init__(self, n_components, **kwargs):
            self.n_components = n_components

        def fit_transform(self, values):
            rows = values.shape[0]
            return np.arange(rows * self.n_components, dtype=float).reshape(rows, self.n_components)

    class FakeHDBSCAN:
        def __init__(self, **kwargs):
            pass

        def fit_predict(self, values):
            return np.array([0, 1, 0])

    monkeypatch.setitem(sys.modules, "umap", SimpleNamespace(UMAP=FakeUMAP))
    monkeypatch.setitem(sys.modules, "hdbscan", SimpleNamespace(HDBSCAN=FakeHDBSCAN))

    import lighting_engine.core.output_writer as output_writer

    monkeypatch.setattr(output_writer, "write_all", lambda *args, **kwargs: None)

    result = pipeline.run_pipeline(
        input_folders=["inbox"],
        output_folder=str(tmp_path),
        feature_groups=feature_groups,
        progress_callback=lambda stage, pct, message="": progress.append((stage, pct, message)),
    )

    np.testing.assert_allclose(result["features_cluster"], np.array([[2.0], [4.0], [6.0]]))
    np.testing.assert_allclose(result["features_explanatory"], np.array([[5.0, 7.0], [6.0, 8.0], [7.0, 9.0]]))
    assert result["feature_names"] == ["g1_b", "g2_a", "g2_b"]
    assert result["feature_names_cluster"] == ["g1_b"]
    assert result["feature_names_explanatory"] == ["g2_a", "g2_b"]
    stages = [stage for stage, _, _ in progress]
    assert stages[:8] == [
        "scan",
        "scan",
        "preprocess",
        "preprocess",
        "assemble",
        "assemble",
        "diagnose",
        "diagnose",
    ]
    assert stages.count("cluster") == 2
    assert "name" in stages
    assert stages[-2:] == ["output", "output"]


def test_background_worker_delegates_pipeline_once(tmp_path, monkeypatch):
    job_id = "job_test_worker"
    events = []
    calls = []
    output_dir = tmp_path / "out"

    jobs._jobs[job_id] = {"id": job_id, "status": "queued"}

    monkeypatch.setattr(
        jobs,
        "_build_cfg_from_request",
        lambda config: {
            "input_folders": ["dataset"],
            "output_folder": str(output_dir),
            "feature_groups": {"cluster_group": {"enabled": True, "dims": 1, "cluster": True, "weight": 1.0}},
            "umap_neighbors": 15,
            "cluster_size_ratio": 0.1,
        },
    )
    monkeypatch.setattr(jobs, "_save_state", lambda job_id: None)
    monkeypatch.setattr(jobs, "_put_event", lambda job_id, event, data: events.append((event, data)))
    monkeypatch.setattr(jobs, "_put_stage_event", lambda job_id, stage, progress, log="": events.append((stage, progress, log)))
    monkeypatch.setattr(preprocess, "find_images", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("worker should not rescan manually")))
    monkeypatch.setattr(preprocess, "preprocess_all", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("worker should not preprocess manually")))

    def fake_run_pipeline(**kwargs):
        calls.append(kwargs)
        cb = kwargs["progress_callback"]
        cb("scan", 0.0, "start")
        cb("cluster", 1.0, "done")
        return {
            "filenames": ["a.jpg"],
            "n_clusters": 1,
            "noise_count": 0,
            "feature_dim": 1,
            "quality": {"silhouette_score": 0.5},
        }

    monkeypatch.setattr(pipeline, "run_pipeline", fake_run_pipeline)

    jobs._background_worker(job_id, {})
    
    assert len(calls) == 1
    assert jobs._jobs[job_id]["status"] == "completed"
    assert any(event[0] == "scan" for event in events)
    assert any(event[0] == "output" for event in events)


def test_get_config_schema_default_cluster_size_ratio():
    """R5: /api/v1/jobs/schema 返回 cluster_size_ratio.default == 0.015."""
    from lighting_engine.core.config import CONFIG
    schema = jobs.get_config_schema()
    csr = schema["params"]["cluster_size_ratio"]
    assert csr["default"] == 0.015, f"expected 0.015, got {csr['default']}"
    assert csr["default"] == CONFIG["cluster_size_ratio"], (
        f"schema default {csr['default']} != CONFIG {CONFIG['cluster_size_ratio']}"
    )


def test_get_config_schema_endpoint_returns_correct_default():
    """HTTP 层面验证 GET /api/v1/jobs/schema 返回 cluster_size_ratio.default == 0.015."""
    from fastapi.testclient import TestClient
    from studio.api.app import app

    client = TestClient(app)
    resp = client.get("/api/v1/jobs/schema")
    assert resp.status_code == 200, f"status {resp.status_code}: {resp.text}"
    data = resp.json()
    csr = data["params"]["cluster_size_ratio"]
    assert csr["default"] == 0.015, f"expected 0.015, got {csr['default']}"
