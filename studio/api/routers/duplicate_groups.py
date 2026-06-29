"""Duplicate Groups API — P05-002

Endpoints for building, browsing, and reviewing duplicate groups.

Results are stored in:
  {output_dir}/analysis_channels/duplicate_groups.json  (read-only results)
  {output_dir}/duplicate_reviews.json                    (user overlay)

User actions allowed: keep / mark / move (no auto-delete).
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .results import _resolve_job_dir_safe

logger = logging.getLogger("DuplicateGroupsAPI")

router = APIRouter(prefix="/jobs/{job_id}/analysis/duplicate-groups", tags=["duplicate_groups"])

# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════


def _get_channels_dir(job_id: str) -> Path:
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir is None:
        raise HTTPException(status_code=404, detail="job_dir_not_found")
    return job_dir / "analysis_channels"


def _results_path(job_id: str) -> Path:
    return _get_channels_dir(job_id) / "duplicate_groups.json"


def _reviews_path(job_id: str) -> Path:
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir is None:
        raise HTTPException(status_code=404, detail="job_dir_not_found")
    return job_dir / "duplicate_reviews.json"


def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _resolve_image_paths(job_dir: Path) -> list:
    """Resolve image paths from a job directory (same logic as analysis.py)."""
    import pandas as pd
    paths = []
    raw_names = []

    atlas_path = job_dir / "atlas_points.csv"
    if atlas_path.exists():
        df = pd.read_csv(atlas_path)
        if "image_path" in df.columns:
            raw_names = df["image_path"].tolist()

    if not raw_names:
        csv_path = job_dir / "features.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            if "filename" in df.columns:
                raw_names = df["filename"].tolist()

    for name in raw_names:
        resolved = None
        cand = job_dir / name
        if cand.exists():
            resolved = cand
        if resolved is None:
            cand = job_dir / "thumbnails" / name
            if cand.exists():
                resolved = cand
        if resolved is None:
            cand = job_dir.parent / name
            if cand.exists():
                resolved = cand
        if resolved is not None:
            paths.append(str(resolved))

    return paths


# ═══════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════


@router.post("/build")
def build_duplicate_groups(job_id: str):
    """Build duplicate groups (exact + perceptual hash) for this job.

    Stores results in analysis_channels/duplicate_groups.json.
    """
    t0 = datetime.now()
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir is None:
        raise HTTPException(status_code=404, detail="job_dir_not_found")

    image_paths = _resolve_image_paths(job_dir)
    if not image_paths:
        raise HTTPException(status_code=400, detail={
            "error": "image_paths_not_found",
            "message": "No image paths found in job output. Ensure atlas_points.csv or features.csv exists.",
        })

    from lighting_engine.core.quality.hash_duplicate import build_duplicate_groups as _build

    try:
        result = _build(image_paths)
    except Exception as e:
        logger.exception("Build duplicate groups failed for job %s", job_id)
        raise HTTPException(status_code=500, detail={
            "error": "build_failed",
            "message": str(e),
        })

    duration = (datetime.now() - t0).total_seconds()
    result["build_info"]["duration_sec"] = round(duration, 1)

    out_path = _results_path(job_id)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save_json(out_path, result)

    return {
        "ok": True,
        "channel": "duplicate_groups",
        "status": "built",
        "path": str(out_path),
        "stats": result["stats"],
        "duration_sec": round(duration, 1),
        "blake3_note": result["build_info"]["blake3_note"],
    }


@router.get("")
def list_duplicate_groups(
    job_id: str,
    group_type: str = None,
):
    """List all duplicate groups, optionally filtered by type (exact / perceptual).

    Returns groups with review actions merged from duplicate_reviews.json.
    """
    data = _load_json(_results_path(job_id))
    if not data:
        raise HTTPException(status_code=404, detail={
            "error": "duplicate_groups_not_found",
            "message": "Build duplicate groups first via POST .../duplicate-groups/build.",
        })

    reviews = _load_json(_reviews_path(job_id))
    groups = data.get("groups", [])

    if group_type:
        groups = [g for g in groups if g["group_type"] == group_type]

    # Merge review actions
    for g in groups:
        gid = g["group_id"]
        review = reviews.get(gid, {})
        g["review"] = review

    return {
        "ok": True,
        "groups": groups,
        "stats": data.get("stats", {}),
        "build_info": data.get("build_info", {}),
    }


@router.get("/{group_id}")
def get_duplicate_group(job_id: str, group_id: str):
    """Get a single duplicate group detail with member info."""
    data = _load_json(_results_path(job_id))
    if not data:
        raise HTTPException(status_code=404, detail="duplicate_groups_not_found")

    for g in data.get("groups", []):
        if g["group_id"] == group_id:
            reviews = _load_json(_reviews_path(job_id))
            g["review"] = reviews.get(group_id, {})
            return {"ok": True, "group": g}

    raise HTTPException(status_code=404, detail=f"group '{group_id}' not found")


@router.post("/review")
def review_duplicate_group(job_id: str, body: dict):
    """Apply a review action to a duplicate group.

    Body:
    {
        "group_id": "dup_exact_0000",
        "action": "keep" | "mark" | "move",
        "note": "optional note"
    }

    Actions:
      - keep: confirm these are duplicates, keep as-is
      - mark: flag for manual review later
      - move: mark as potential move candidates (logical only, no file movement)
    """
    group_id = body.get("group_id")
    action = body.get("action")
    note = body.get("note", "")

    if not group_id:
        raise HTTPException(status_code=422, detail="group_id is required")
    if action not in ("keep", "mark", "move"):
        raise HTTPException(status_code=422, detail=f"Invalid action '{action}'. Must be keep|mark|move")

    reviews = _load_json(_reviews_path(job_id))
    reviews[group_id] = {
        "action": action,
        "note": note,
        "updated_at": datetime.now().isoformat(),
    }
    _save_json(_reviews_path(job_id), reviews)

    return {
        "ok": True,
        "group_id": group_id,
        "action": action,
        "note": note,
    }
