from pathlib import Path

from PIL import Image

from light_analysis_engine.workspace import (
    ImageIndexEntry,
    MediaResolver,
    WorkspaceLayout,
    stable_image_id,
)


def test_media_resolver_urls_and_thumbnail_cache(tmp_path: Path):
    source = tmp_path / "source.png"
    Image.new("RGB", (16, 12), "red").save(source)
    layout = WorkspaceLayout.from_output_root(tmp_path / "job")
    entry = ImageIndexEntry(
        image_id=stable_image_id("source.png"),
        source_path=source,
        relative_path="source.png",
        filename="source.png",
        width=16,
        height=12,
    )
    resolver = MediaResolver("job-a", layout, [entry])

    ref = resolver.get_image_ref(entry.image_id)
    assert ref.thumbnail_url != ref.original_url
    assert ref.original_url.endswith(f"/images/{entry.image_id}/original")
    response = resolver.get_thumbnail_response(entry.image_id, size=128)
    assert response.media_type == "image/jpeg"
    assert any(layout.thumbnail_size_dir(128).glob("*.jpg"))


def test_media_resolver_missing_source_has_no_urls(tmp_path: Path):
    layout = WorkspaceLayout.from_output_root(tmp_path / "job")
    entry = ImageIndexEntry(
        image_id="missing",
        source_path=tmp_path / "missing.jpg",
        relative_path="missing.jpg",
        filename="missing.jpg",
        exists=False,
    )
    resolver = MediaResolver("job-a", layout, [entry])

    ref = resolver.get_image_ref("missing")

    assert ref.exists is False
    assert ref.thumbnail_url is None
    assert ref.original_url is None
    assert ref.missing_reason == "source file missing"
