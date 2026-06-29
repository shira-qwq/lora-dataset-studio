"""Recluster preview API endpoints (v4.5).

POST /api/v1/jobs/{job_id}/recluster/preview  — create preview
GET  /api/v1/jobs/{job_id}/recluster/previews  — list previews
GET  /api/v1/jobs/{job_id}/recluster/previews/{preview_id} — get preview
POST /api/v1/jobs/{job_id}/recluster/previews/{preview_id}/apply — apply preview
"""

import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lighting_engine.core.recipe import (
    get_builtin_recipe, get_builtin_recipe_names, validate_recipe,
)
from lighting_engine.core.recluster import create_preview

logger = logging.getLogger("ReclusterAPI")

router = APIRouter(prefix="/jobs/{job_id}/recluster", tags=["recluster"])


class PreviewRequest(BaseModel):
    recipe_name: Optional[str] = None
    recipe: Optional[dict] = None


class ApplyRequest(BaseModel):
    force: bool = False


def _get_job_dir(job_id: str) -> Path:
    """Resolve job output directory (uses same logic as results.py)."""
    from .results import _resolve_job_dir_safe
    d = _resolve_job_dir_safe(job_id)
    if d is not None:
        return d
    raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")


def _get_current_labels(job_dir: Path, filenames) -> Optional[list]:
    """Read current cluster labels from atlas_points.csv."""
    import pandas as pd
    atlas_path = job_dir / "atlas_points.csv"
    if atlas_path.exists():
        df = pd.read_csv(atlas_path)
        if "cluster_id" in df.columns:
            return df["cluster_id"].tolist()
    # Fallback: features.csv cluster_id column
    csv_path = job_dir / "features.csv"
    if csv_path.exists():
        df = pd.read_csv(csv_path)
        if "cluster_id" in df.columns:
            return df["cluster_id"].tolist()
    return None


def _has_manual_edits(job_dir: Path) -> bool:
    """Check if the job has user manual edits.

    Checks multiple possible storage locations:
    - organized_state.json (moves / renames)
    - cluster_moves.json (moves dict)
    - cluster_edits.json (display_name dict)
    """
    # 1. organized_state.json (legacy format)
    state_path = job_dir / "organized_state.json"
    if state_path.exists():
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        moves = state.get("moves", {})
        renames = state.get("renames", {})
        if moves or renames:
            return True

    # 2. cluster_moves.json (current format — image → cluster_id mapping)
    moves_path = job_dir / "cluster_moves.json"
    if moves_path.exists():
        with open(moves_path, "r", encoding="utf-8") as f:
            moves = json.load(f)
        if moves and isinstance(moves, dict) and any(moves.values()):
            return True

    # 3. cluster_edits.json (display_name changes)
    edits_path = job_dir / "cluster_edits.json"
    if edits_path.exists():
        with open(edits_path, "r", encoding="utf-8") as f:
            edits = json.load(f)
        display_names = edits.get("display_name", {})
        if display_names and isinstance(display_names, dict) and any(display_names.values()):
            return True

    return False


@router.post("/preview")
def create_preview_endpoint(job_id: str, req: PreviewRequest):
    """Create a recluster preview."""
    # Resolve recipe
    if req.recipe_name and req.recipe:
        raise HTTPException(status_code=400, detail="Provide either recipe_name or recipe, not both")
    if req.recipe_name:
        recipe = get_builtin_recipe(req.recipe_name)
        if recipe is None:
            raise HTTPException(status_code=404, detail=f"Unknown recipe: {req.recipe_name}. Available: {get_builtin_recipe_names()}")
    elif req.recipe:
        recipe = req.recipe
        errors = validate_recipe(recipe)
        if errors:
            raise HTTPException(status_code=400, detail=f"Invalid recipe: {errors}")
    else:
        raise HTTPException(status_code=400, detail="Provide recipe_name or recipe")

    # Get job directory
    try:
        job_dir = _get_job_dir(job_id)
    except HTTPException:
        raise

    # Get current labels for diff
    current_labels = _get_current_labels(job_dir, None)

    # Create preview
    try:
        result = create_preview(
            str(job_dir),
            recipe,
            current_labels=current_labels,
        )
    except Exception as e:
        logger.exception(f"Preview failed for job {job_id}")
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")

    return {
        "ok": True,
        "preview_id": result["preview_id"],
        "output_path": result["output_path"],
        "metrics": result["metrics"],
        "diff_summary": result["diff_summary"],
        "alive_feature_names": result.get("alive_feature_names", []),
        "dead_features": result.get("dead_features", []),
    }


@router.get("/previews")
def list_previews(job_id: str):
    """List all recluster previews for a job."""
    try:
        job_dir = _get_job_dir(job_id)
    except HTTPException:
        raise

    previews_dir = job_dir / "recluster_previews"
    if not previews_dir.exists():
        return {"ok": True, "previews": []}

    previews = []
    for p in sorted(previews_dir.iterdir()):
        if p.is_dir():
            metrics_path = p / "preview_metrics.json"
            recipe_path = p / "recipe.json"
            diff_path = p / "diff_vs_current.json"
            info = {"preview_id": p.name}
            if metrics_path.exists():
                with open(metrics_path, "r", encoding="utf-8") as f:
                    info["metrics"] = json.load(f)
            if recipe_path.exists():
                with open(recipe_path, "r", encoding="utf-8") as f:
                    info["recipe_name"] = json.load(f).get("recipe_name", "unknown")
            if diff_path.exists():
                with open(diff_path, "r", encoding="utf-8") as f:
                    diff = json.load(f)
                    info["diff_summary"] = {k: v for k, v in diff.items() if k != "per_image_changes"}
            previews.append(info)

    return {"ok": True, "previews": previews}


@router.get("/previews/{preview_id}")
def get_preview(job_id: str, preview_id: str):
    """Get preview details."""
    try:
        job_dir = _get_job_dir(job_id)
    except HTTPException:
        raise

    preview_dir = job_dir / "recluster_previews" / preview_id
    if not preview_dir.exists():
        raise HTTPException(status_code=404, detail=f"Preview not found: {preview_id}")

    result = {"preview_id": preview_id}

    for fname in ["preview_metrics.json", "recipe.json", "diff_vs_current.json",
                    "cluster_summary.json", "cluster_names.json"]:
        fp = preview_dir / fname
        if fp.exists():
            with open(fp, "r", encoding="utf-8") as f:
                result[fname.replace(".json", "")] = json.load(f)

    return {"ok": True, "preview": result}


@router.post("/previews/{preview_id}/apply")
def apply_preview(job_id: str, preview_id: str, req: ApplyRequest):
    """Apply a preview as the active clustering result.

    Will refuse if the job has manual edits, unless force=True.
    Before applying, backs up the current cluster state.
    """
    try:
        job_dir = _get_job_dir(job_id)
    except HTTPException:
        raise

    preview_dir = job_dir / "recluster_previews" / preview_id
    if not preview_dir.exists():
        raise HTTPException(status_code=404, detail=f"Preview not found: {preview_id}")

    # Check for manual edits
    if _has_manual_edits(job_dir) and not req.force:
        raise HTTPException(
            status_code=409,
            detail="This job has manual edits (moves/renames). "
                   "Applying a preview would overwrite them. "
                   "Use force=true to override.",
        )

    # Backup current state (comprehensive: includes user edits)
    backup_dir = job_dir / "recluster_previews" / f"_backup_before_apply_{preview_id}"
    if not backup_dir.exists():
        backup_dir.mkdir(parents=True)
        for fname in ["atlas_points.csv", "cluster_summary.json", "cluster_names.json",
                       "cluster_moves.json", "cluster_edits.json", "features.csv",
                       "cluster_analysis.json", "report.json"]:
            src = job_dir / fname
            if src.exists():
                shutil.copy2(str(src), str(backup_dir / fname))

    # Apply preview files
    preview_atlas = preview_dir / "atlas_points.csv"
    preview_summary = preview_dir / "cluster_summary.json"
    preview_names = preview_dir / "cluster_names.json"

    if preview_atlas.exists():
        shutil.copy2(str(preview_atlas), str(job_dir / "atlas_points.csv"))
    if preview_summary.exists():
        shutil.copy2(str(preview_summary), str(job_dir / "cluster_summary.json"))
    if preview_names.exists():
        shutil.copy2(str(preview_names), str(job_dir / "cluster_names.json"))

    # Clear stale user edits — after apply the old cluster IDs may no longer be valid.
    # User edits are backed up above and can be restored if needed.
    for stale_file in ["cluster_moves.json", "cluster_edits.json", "organized_state.json"]:
        stale_path = job_dir / stale_file
        if stale_path.exists():
            stale_path.unlink()

    return {
        "ok": True,
        "message": f"Preview {preview_id} applied to job {job_id}",
        "backup_path": str(backup_dir),
        "note": "Backup includes atlas, summary, names, features, moves, edits, analysis, and report. "
                "Stale moves/edits have been cleared. Restore from backup if needed.",
    }
