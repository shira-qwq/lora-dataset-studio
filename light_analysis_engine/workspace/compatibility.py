from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _state_output_dir(state: dict) -> Optional[Path]:
    cfg = state.get("config", {}) if isinstance(state.get("config"), dict) else {}
    raw = cfg.get("output_folder") or cfg.get("output_dir") or state.get("output_folder") or state.get("output_dir")
    return Path(raw).expanduser().resolve() if raw else None


def resolve_output_root(job_id: str, roots: list[Path] | None = None) -> Optional[Path]:
    try:
        import studio.api.routers.jobs as jobs_mod
        state = jobs_mod._jobs.get(job_id) or {}
        out = _state_output_dir(state)
        if out and out.is_dir():
            return out
    except Exception:
        pass

    search_roots = roots or [PROJECT_ROOT, PROJECT_ROOT.parent]
    for root in search_roots:
        if not root.exists():
            continue
        for suffix in ("", "_output_v7", "_output_v6", "_output"):
            candidate = root / f"{job_id}{suffix}"
            if candidate.is_dir():
                return candidate.resolve()
        for child in root.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            for state_name in ("_studio/.job_state.json", ".job_state.json"):
                state = _read_json(child / state_name)
                if state.get("id") == job_id:
                    return child.resolve()
            manifest = _read_json(child / "_studio" / "job_manifest.json")
            if manifest.get("job_id") == job_id:
                return child.resolve()
    return None
