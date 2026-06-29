from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkspaceLayout:
    output_root: Path

    @classmethod
    def from_output_root(cls, output_root: str | Path) -> "WorkspaceLayout":
        return cls(Path(output_root).expanduser().resolve())

    @property
    def studio_dir(self) -> Path:
        return self.output_root / "_studio"

    @property
    def cache_dir(self) -> Path:
        return self.output_root / "_cache"

    @property
    def exports_dir(self) -> Path:
        return self.output_root / "exports"

    @property
    def reports_dir(self) -> Path:
        return self.output_root / "reports"

    @property
    def image_index_path(self) -> Path:
        return self.studio_dir / "image_index.json"

    @property
    def job_manifest_path(self) -> Path:
        return self.studio_dir / "job_manifest.json"

    @property
    def run_config_path(self) -> Path:
        return self.studio_dir / "run_config.json"

    @property
    def feature_schema_path(self) -> Path:
        return self.studio_dir / "feature_schema.json"

    @property
    def visual_taxonomy_path(self) -> Path:
        return self.studio_dir / "visual_taxonomy.json"

    @property
    def clustering_dir(self) -> Path:
        return self.studio_dir / "clustering"

    @property
    def features_dir(self) -> Path:
        return self.studio_dir / "features"

    @property
    def inspection_dir(self) -> Path:
        return self.studio_dir / "inspection"

    @property
    def export_records_dir(self) -> Path:
        return self.studio_dir / "export_records"

    @property
    def logs_dir(self) -> Path:
        return self.studio_dir / "logs"

    @property
    def thumbnails_dir(self) -> Path:
        return self.cache_dir / "thumbnails"

    def thumbnail_size_dir(self, size: int) -> Path:
        return self.thumbnails_dir / str(size)

    def ensure_runtime_dirs(self) -> None:
        for path in [
            self.output_root,
            self.exports_dir,
            self.studio_dir,
            self.cache_dir,
            self.reports_dir,
            self.features_dir,
            self.clustering_dir,
            self.inspection_dir,
            self.export_records_dir,
            self.logs_dir,
            self.thumbnails_dir,
        ]:
            path.mkdir(parents=True, exist_ok=True)

    def internal_file(self, filename: str) -> Path:
        return self.studio_dir / filename

    def read_file_candidates(self, filename: str) -> list[Path]:
        rel = Path(filename)
        return [
            self.studio_dir / rel,
            self.studio_dir / rel.name,
            self.features_dir / rel.name,
            self.clustering_dir / rel.name,
            self.inspection_dir / rel.name,
            self.output_root / rel,
            self.output_root / rel.name,
        ]
