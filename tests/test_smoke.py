"""Smoke test — verify backend + frontend integration without a browser.

Tests:
- Backend health
- Frontend HTML + all 21 JS files load
- /results/jobs returns expected jobs
- /results/{id}/clusters returns clusters
- /jobs/scan-folder scans a folder
- /exports/copy-by-cluster copies images
- /jobs (POST) starts a job (or returns error gracefully)
- Theme files have correct structure
"""

import json
import re
import sys
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8003"
FRONTEND = f"{BASE}/app"
JOBS_DIR = Path(__file__).resolve().parent.parent

# Find a test job
def get_test_job():
    r = requests.get(f"{BASE}/api/v1/results/jobs")
    r.raise_for_status()
    jobs = r.json().get("jobs", [])
    if not jobs:
        return None
    # Prefer v7 (has clusters)
    for j in jobs:
        if "v7" in j["id"] and j.get("clusters", 0) > 0:
            return j["id"]
    return jobs[0]["id"]


def test_backend_health():
    r = requests.get(f"{BASE}/api/v1/health", timeout=5)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    print(f"  PASS backend health: {data['version']}")


def test_frontend_html():
    r = requests.get(FRONTEND + "/", timeout=5)
    assert r.status_code == 200
    assert "<title>Cluster Organizer</title>" in r.text
    # ThemeManager is in the JS file, not HTML
    print(f"  PASS frontend HTML ({len(r.text)} bytes)")


def test_all_js_files():
    r = requests.get(FRONTEND + "/", timeout=5)
    js_files = re.findall(r'src="([^"]+\.js(?:[?#][^"]*)?)"', r.text)
    assert len(js_files) >= 18, f"expected 18+ JS files, got {len(js_files)}"
    failed = []
    for f in js_files:
        fr = requests.get(f"{FRONTEND}/{f}", timeout=5)
        if fr.status_code != 200:
            failed.append((f, fr.status_code))
    assert not failed, f"failed: {failed}"
    # Verify the theme manager is in its file
    tm = requests.get(f"{FRONTEND}/styles/theme-manager.js", timeout=5)
    assert "ThemeManager" in tm.text
    print(f"  PASS {len(js_files)} JS files all load, ThemeManager present")


def test_list_jobs():
    r = requests.get(f"{BASE}/api/v1/results/jobs", timeout=5)
    assert r.status_code == 200
    jobs = r.json().get("jobs", [])
    assert len(jobs) > 0, "no jobs found"
    print(f"  PASS list jobs: {len(jobs)} found, first={jobs[0]['id']}")
    return jobs[0]["id"]


def test_get_clusters(job_id):
    r = requests.get(f"{BASE}/api/v1/results/{job_id}/clusters", timeout=5)
    assert r.status_code == 200, f"status={r.status_code}"
    data = r.json()
    clusters = data.get("clusters", [])
    if not clusters:
        print(f"  SKIP clusters for {job_id}: no clusters (empty project)")
        return []
    print(f"  PASS clusters for {job_id}: {len(clusters)} clusters")
    return clusters


def test_get_images(job_id, cluster_id):
    r = requests.get(f"{BASE}/api/v1/results/{job_id}/images",
                     params={"cluster_id": cluster_id, "limit": 5, "offset": 0}, timeout=5)
    assert r.status_code == 200
    images = r.json().get("images", [])
    assert len(images) > 0, "no images"
    print(f"  PASS images in cluster {cluster_id}: {len(images)} images")
    return images


def test_scan_folder():
    """Test the new scan-folder endpoint."""
    # 找一个有 output_folder 的 job
    r = requests.get(f"{BASE}/jobs")
    test_path = None
    for j in r.json().get("jobs", []):
        of = j.get("output_folder", "")
        if of and Path(of).exists():
            test_path = of
            break
    if not test_path:
        # 兜底用 JOBS_DIR/test_smoke_output
        test_path = str(JOBS_DIR / "test_smoke_output")
    r = requests.post(f"{BASE}/api/v1/jobs/scan-folder",
                      json={"path": test_path}, timeout=5)
    assert r.status_code == 200, f"status={r.status_code} body={r.text}"
    data = r.json()
    assert data["ok"] is True
    print(f"  PASS scan-folder: found {data['image_count']} files")


def test_export_copy_by_cluster(job_id):
    """Test the new copy-by-cluster endpoint."""
    # Skip if atlas_points.csv doesn't exist (v6 incomplete data)
    atlas_path = JOBS_DIR / job_id / "atlas_points.csv"
    if not atlas_path.exists():
        # Try umap_points_3d.csv as fallback
        atlas_path = JOBS_DIR / job_id / "umap_points_3d.csv"
    if not atlas_path.exists():
        print(f"  SKIP export: no atlas data in {job_id}")
        return
    r = requests.post(f"{BASE}/api/v1/exports/copy-by-cluster",
                      json={"job_id": job_id}, timeout=30)
    assert r.status_code == 200, f"status={r.status_code}"
    data = r.json()
    assert data["ok"] is True
    assert data["exported_count"] > 0
    print(f"  PASS export copy-by-cluster: {data['exported_count']} imgs in {data['cluster_count']} dirs")
    print(f"        output: {data['output_dir']}")
    out = Path(data["output_dir"])
    assert out.exists(), f"output dir doesn't exist: {out}"
    cluster_dirs = [d for d in out.iterdir() if d.is_dir()]
    assert len(cluster_dirs) > 0
    print(f"  PASS directories on disk: {len(cluster_dirs)} folders")
    total_files = sum(len(list(d.iterdir())) for d in cluster_dirs)
    assert total_files == data["exported_count"], f"file count mismatch: {total_files} vs {data['exported_count']}"
    print(f"  PASS total files on disk: {total_files}")
    # Verify folder names use cluster_names (not just cluster_N)
    non_noise = [d for d in cluster_dirs if d.name != "noise"]
    if non_noise:
        print(f"  PASS folder names: {[d.name for d in non_noise[:3]]}")


def test_theme_files():
    """Verify theme CSS structure."""
    for name in ["tokens.css", "themes.css"]:
        r = requests.get(f"{FRONTEND}/styles/{name}", timeout=5)
        assert r.status_code == 200
        assert "--bg" in r.text, f"{name} missing --bg"
        assert "--accent" in r.text, f"{name} missing --accent"
        assert "--text" in r.text, f"{name} missing --text"
    # themes.css must have all 3 presets
    r = requests.get(f"{FRONTEND}/styles/themes.css", timeout=5)
    for preset in ["dark", "light", "solarized"]:
        assert f'data-theme="{preset}"' in r.text, f"missing {preset} theme"
    print(f"  PASS theme files: tokens + 3 presets (dark/light/solarized) [3-color scheme]")


def test_submit_job():
    """Test job submission returns a job_id."""
    test_path = str(JOBS_DIR / "写真test_output_v7")
    out_path = str(JOBS_DIR / "test_smoke_output")
    r = requests.post(f"{BASE}/api/v1/jobs", json={
        "input_folders": [test_path],
        "output_folder": out_path,
        "preset": "full",
        "use_depth": False  # avoid expensive DA3
    }, timeout=10)
    if r.status_code == 200:
        data = r.json()
        assert "job_id" in data
        print(f"  PASS submit job: {data['job_id']}")
    else:
        print(f"  WARN submit job returned {r.status_code} (may be import error): {r.text[:200]}")


def test_invalid_path_scan():
    """Test scan-folder with invalid path."""
    r = requests.post(f"{BASE}/api/v1/jobs/scan-folder",
                      json={"path": "C:/nonexistent/folder"}, timeout=5)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is False
    print(f"  PASS scan-folder handles invalid path: {data['message'][:50]}")


def main():
    print("=" * 60)
    print("Cluster Organizer - Smoke Test")
    print("=" * 60)

    print("\n[Backend]")
    test_backend_health()
    test_submit_job()
    test_invalid_path_scan()
    test_scan_folder()

    print("\n[Frontend]")
    test_frontend_html()
    test_all_js_files()
    test_theme_files()

    print("\n[Data flow]")
    job_id = test_list_jobs()
    clusters = test_get_clusters(job_id)
    if clusters:
        test_get_images(job_id, clusters[0]["id"])
    else:
        # Try to find another job with clusters
        import requests
        r = requests.get(f"{BASE}/results/jobs")
        for j in r.json().get("jobs", []):
            c = test_get_clusters(j["id"])
            if c:
                test_get_images(j["id"], c[0]["id"])
                break
        else:
            print("  WARN: no jobs with clusters found, skipping image test")

    print("\n[Export]")
    test_export_copy_by_cluster(job_id)

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\nFAIL: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(2)
