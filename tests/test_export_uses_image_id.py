from pathlib import Path

from light_analysis_engine.workspace import (
    ExportRequest,
    ExportResolver,
    ImageIndexEntry,
    MediaResolver,
    WorkspaceLayout,
    stable_image_id,
)


def test_export_uses_image_id_to_copy_original(tmp_path: Path):
    source = tmp_path / "input" / "original.jpg"
    source.parent.mkdir()
    source.write_bytes(b"original bytes")
    layout = WorkspaceLayout.from_output_root(tmp_path / "job")
    image_id = stable_image_id("original.jpg")
    media = MediaResolver("job-a", layout, [
        ImageIndexEntry(
            image_id=image_id,
            source_path=source,
            relative_path="original.jpg",
            filename="original.jpg",
        )
    ])
    resolver = ExportResolver("job-a", layout, media)

    result = resolver.export_images(ExportRequest(image_ids=[image_id], folder_name="picked"))

    exported = Path(result.export_dir) / "original.jpg"
    assert exported.read_bytes() == b"original bytes"
    assert Path(result.manifest_path).is_file()
