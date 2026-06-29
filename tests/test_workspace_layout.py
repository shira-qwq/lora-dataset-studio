from pathlib import Path

from light_analysis_engine.workspace import WorkspaceLayout


def test_workspace_layout_paths(tmp_path: Path):
    layout = WorkspaceLayout.from_output_root(tmp_path / "job")

    assert layout.studio_dir == layout.output_root / "_studio"
    assert layout.cache_dir == layout.output_root / "_cache"
    assert layout.exports_dir == layout.output_root / "exports"
    assert layout.reports_dir == layout.output_root / "reports"
    assert layout.image_index_path == layout.studio_dir / "image_index.json"
    assert layout.thumbnails_dir == layout.cache_dir / "thumbnails"

    layout.ensure_runtime_dirs()
    assert layout.export_records_dir.is_dir()
    assert layout.thumbnail_size_dir(384).parent.is_dir()
