from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .layout import WorkspaceLayout


@dataclass
class JobManifest:
    job_id: str
    output_root: Path
    input_roots: list[Path]
    created_at: str
    version: str = "1"
    layout_version: str = "workspace-v1"

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["output_root"] = str(self.output_root)
        data["input_roots"] = [str(p) for p in self.input_roots]
        return data


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _coerce_paths(value: Any) -> list[Path]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [Path(str(item)).expanduser().resolve() for item in value if item]


def infer_job_manifest(layout: WorkspaceLayout, job_id: str | None = None) -> JobManifest:
    state = _read_json(layout.studio_dir / ".job_state.json") or _read_json(layout.output_root / ".job_state.json")
    experiment = _read_json(layout.studio_dir / "experiment.json") or _read_json(layout.output_root / "experiment.json")
    cfg = state.get("config", {}) if isinstance(state.get("config"), dict) else {}
    input_roots = (
        _coerce_paths(experiment.get("input_folders") or experiment.get("input_dir"))
        or _coerce_paths(cfg.get("input_folders") or cfg.get("input_dir"))
    )
    created_at = str(state.get("created_at") or experiment.get("timestamp") or datetime.now().isoformat())
    return JobManifest(
        job_id=str(job_id or state.get("id") or layout.output_root.name),
        output_root=layout.output_root,
        input_roots=input_roots,
        created_at=created_at,
        version=str(state.get("version") or "1"),
        layout_version="workspace-v1",
    )


def load_job_manifest(layout: WorkspaceLayout, job_id: str | None = None) -> JobManifest:
    data = _read_json(layout.job_manifest_path)
    if data:
        return JobManifest(
            job_id=str(data.get("job_id") or job_id or layout.output_root.name),
            output_root=Path(data.get("output_root") or layout.output_root).expanduser().resolve(),
            input_roots=_coerce_paths(data.get("input_roots")),
            created_at=str(data.get("created_at") or datetime.now().isoformat()),
            version=str(data.get("version") or "1"),
            layout_version=str(data.get("layout_version") or "workspace-v1"),
        )
    return infer_job_manifest(layout, job_id=job_id)


def write_job_manifest(layout: WorkspaceLayout, manifest: JobManifest) -> Path:
    layout.ensure_runtime_dirs()
    with open(layout.job_manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest.to_json(), f, indent=2, ensure_ascii=False)
    return layout.job_manifest_path
