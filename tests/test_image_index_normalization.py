import json
from pathlib import Path

from light_analysis_engine.workspace import WorkspaceLayout, load_image_index, load_job_manifest, write_job_manifest
from light_analysis_engine.workspace.manifest import JobManifest


def test_image_index_normalizes_legacy_fields(tmp_path: Path):
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "a.jpg"
    source.write_bytes(b"image")
    layout = WorkspaceLayout.from_output_root(tmp_path / "job")
    write_job_manifest(layout, JobManifest(
        job_id="job-a",
        output_root=layout.output_root,
        input_roots=[input_root],
        created_at="2026-06-29T00:00:00",
    ))
    layout.studio_dir.mkdir(parents=True, exist_ok=True)
    layout.image_index_path.write_text(json.dumps({
        "images": [{"image_path": "a.jpg", "width": 10, "height": 20}]
    }), encoding="utf-8")

    index = load_image_index(layout, load_job_manifest(layout))

    assert len(index.entries) == 1
    entry = index.entries[0]
    assert entry.source_path == source.resolve()
    assert entry.relative_path == "a.jpg"
    assert entry.exists is True
    assert index.get(entry.image_id) == entry
