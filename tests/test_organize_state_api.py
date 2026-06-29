import csv
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from studio.api.app import app
from studio.api.routers import exports, jobs, results


def _write_json(path: Path, name: str, payload: dict) -> None:
    (path / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _write_csv(path: Path, name: str, rows: list[dict]) -> None:
    with open(path / name, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["image_path", "cluster_id", "cluster_name", "umap_x", "umap_y", "filename"],
        )
        writer.writeheader()
        writer.writerows(rows)


def _build_job(tmp_path: Path, job_id: str) -> Path:
    job_dir = tmp_path / job_id
    images_dir = job_dir / "images"
    images_dir.mkdir(parents=True)
    (images_dir / "a.jpg").write_bytes(b"a")
    (images_dir / "b.jpg").write_bytes(b"b")

    _write_csv(
        job_dir,
        "atlas_points.csv",
        [
            {
                "image_path": "images/a.jpg",
                "filename": "a.jpg",
                "cluster_id": "0",
                "cluster_name": "cluster_zero_base",
                "umap_x": "1.0",
                "umap_y": "1.5",
            },
            {
                "image_path": "images/b.jpg",
                "filename": "b.jpg",
                "cluster_id": "1",
                "cluster_name": "cluster_one_base",
                "umap_x": "2.0",
                "umap_y": "2.5",
            },
        ],
    )
    _write_json(
        job_dir,
        "cluster_analysis.json",
        {
            "0": {"suggested_name": "cluster_zero_base", "name_confidence": 0.9},
            "1": {"suggested_name": "cluster_one_base", "name_confidence": 0.8},
        },
    )
    _write_json(
        job_dir,
        "cluster_summary.json",
        {
            "cluster_0": {"count": 1, "name": "cluster_zero_base"},
            "cluster_1": {"count": 1, "name": "cluster_one_base"},
        },
    )
    _write_json(job_dir, "cluster_names.json", {"0": "cluster_zero_base", "1": "cluster_one_base"})
    _write_json(
        job_dir,
        "report.json",
        {
            "total_images": 2,
            "clusters": 2,
            "noise_count": 0,
            "cluster_info": {
                "0": {"count": 1, "name": "cluster_zero_base"},
                "1": {"count": 1, "name": "cluster_one_base"},
            },
        },
    )
    _write_json(job_dir, "experiment.json", {"input_folders": [str(images_dir)]})
    return job_dir


def test_organize_changes_flow(tmp_path, monkeypatch):
    job_id = "job_case"
    _build_job(tmp_path, job_id)

    monkeypatch.setattr(results, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(results, "_OUTPUTS_BASE", tmp_path)
    monkeypatch.setattr(exports, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(jobs, "_jobs", {})

    client = TestClient(app)

    save_resp = client.post(
        f"/api/v1/results/{job_id}/organize/save",
        json={
            "moves": [{"filename": "b.jpg", "target_cluster_id": "0"}],
            "renames": [{"cluster_id": "0", "display_name": "hero warm"}],
        },
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["ok"] is True

    clusters_resp = client.get(f"/api/v1/results/{job_id}/clusters")
    assert clusters_resp.status_code == 200
    clusters = {item["id"]: item for item in clusters_resp.json()["clusters"]}
    assert clusters["0"]["name"] == "hero warm"
    assert clusters["0"]["count"] == 2
    assert clusters["1"]["count"] == 0

    images_resp = client.get(f"/api/v1/results/{job_id}/images", params={"cluster_id": "0"})
    assert images_resp.status_code == 200
    images = images_resp.json()["images"]
    assert {img["filename"] for img in images} == {"a.jpg", "b.jpg"}
    assert all(img["cluster_name"] == "hero warm" for img in images)
    moved_image = next(img for img in images if img["filename"] == "b.jpg")
    assert moved_image["original_cluster_id"] == 1

    embeddings_resp = client.get(f"/api/v1/results/{job_id}/embeddings", params={"format": "atlas"})
    assert embeddings_resp.status_code == 200
    moved_point = next(point for point in embeddings_resp.json()["points"] if point["filename"] == "b.jpg")
    assert moved_point["cluster_id"] == 0
    assert moved_point["cluster_name"] == "hero warm"

    manifest_resp = client.post(
        "/api/v1/exports",
        json={
            "job_id": job_id,
            "selector": {"type": "by_cluster", "cluster_ids": ["0"]},
            "format": "manifest",
            "filename": "picked",
        },
    )
    assert manifest_resp.status_code == 200
    manifest_files = manifest_resp.json()["manifest"]["files"]
    assert {Path(item["image_path"]).name for item in manifest_files} == {"a.jpg", "b.jpg"}

    export_resp = client.post(
        "/api/v1/exports/copy-by-cluster",
        json={"job_id": job_id, "include_user_moves": True},
    )
    assert export_resp.status_code == 200
    payload = export_resp.json()
    assert payload["ok"] is True
    assert payload["exported_count"] == 2
    output_dir = Path(payload["output_dir"])
    assert sorted(p.name for p in (output_dir / "hero_warm").iterdir()) == ["a.jpg", "b.jpg"]


def test_save_then_refresh_consistency(tmp_path, monkeypatch):
    """测试保存后重新加载（模拟前端 handleSave → loadData 流程）能获得一致结果"""
    job_id = "job_consistency"
    _build_job(tmp_path, job_id)

    monkeypatch.setattr(results, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(results, "_OUTPUTS_BASE", tmp_path)
    monkeypatch.setattr(exports, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(jobs, "_jobs", {})

    client = TestClient(app)

    # === Save 1: 移动 b.jpg 到 cluster 0，重命名 cluster 0 ===
    save1 = client.post(
        f"/api/v1/results/{job_id}/organize/save",
        json={
            "moves": [{"filename": "b.jpg", "target_cluster_id": "0"}],
            "renames": [{"cluster_id": "0", "display_name": "hero warm"}],
        },
    )
    assert save1.status_code == 200

    # === Refresh 1: 重新加载（模拟页面刷新） ===
    clusters1 = client.get(f"/api/v1/results/{job_id}/clusters").json()["clusters"]
    clusters1_map = {c["id"]: c for c in clusters1}
    assert clusters1_map["0"]["name"] == "hero warm"
    assert clusters1_map["0"]["count"] == 2  # a.jpg + b.jpg

    images1 = client.get(f"/api/v1/results/{job_id}/images", params={"cluster_id": "0"}).json()["images"]
    assert {img["filename"] for img in images1} == {"a.jpg", "b.jpg"}

    # === Save 2: 追加移动，再重命名 ===
    save2 = client.post(
        f"/api/v1/results/{job_id}/organize/save",
        json={
            "moves": [{"filename": "a.jpg", "target_cluster_id": "1"}],
            "renames": [{"cluster_id": "1", "display_name": "cool tone"}],
        },
    )
    assert save2.status_code == 200

    # === Refresh 2: 再次重新加载 ===
    clusters2 = client.get(f"/api/v1/results/{job_id}/clusters").json()["clusters"]
    clusters2_map = {c["id"]: c for c in clusters2}
    # cluster 0 现在只有 b.jpg（a.jpg 被移走了）
    assert clusters2_map["0"]["name"] == "hero warm"  # 重命名保留
    assert clusters2_map["0"]["count"] == 1
    assert clusters2_map["1"]["name"] == "cool tone"
    assert clusters2_map["1"]["count"] == 1

    images2 = client.get(f"/api/v1/results/{job_id}/images", params={"cluster_id": "1"}).json()["images"]
    assert {img["filename"] for img in images2} == {"a.jpg"}

    # === 验证两次保存是累计效果（非覆盖） ===
    images0 = client.get(f"/api/v1/results/{job_id}/images", params={"cluster_id": "0"}).json()["images"]
    assert {img["filename"] for img in images0} == {"b.jpg"}

    # === 验证后端 export 也反映最新状态 ===
    export_resp = client.post(
        "/api/v1/exports/copy-by-cluster",
        json={"job_id": job_id, "include_user_moves": True},
    )
    assert export_resp.status_code == 200
    export_resp = export_resp.json()

    assert export_resp["ok"]
    assert export_resp["exported_count"] == 2

    output_dir = Path(export_resp["output_dir"])
    assert (output_dir / "hero_warm").exists()
    assert (output_dir / "cool_tone").exists()
    assert sorted(p.name for p in (output_dir / "hero_warm").iterdir()) == ["b.jpg"]
    assert sorted(p.name for p in (output_dir / "cool_tone").iterdir()) == ["a.jpg"]
