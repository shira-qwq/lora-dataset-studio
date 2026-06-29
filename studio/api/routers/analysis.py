"""Analysis API endpoints (v4.4h + v4.4i + v4.5-ui).

GET  /api/v1/jobs/{job_id}/analysis/status
GET  /api/v1/jobs/{job_id}/analysis/histogram-summary
GET  /api/v1/jobs/{job_id}/analysis/quality-edge-summary
"""

import base64
import csv
import hashlib
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("AnalysisAPI")

router = APIRouter(prefix="/jobs/{job_id}/analysis", tags=["analysis"])


def _image_id_from_path(value: str) -> str:
    """Stable image_id fallback: url-safe base64 of the original/relative path."""
    raw = str(value or "").replace("\\", "/")
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def _ensure_record_identity(rec: dict) -> dict:
    """Ensure analysis summary records expose a stable image_id for the frontend."""
    source = rec.get("original_rel_path") or rec.get("source_rel_path") or rec.get("image_path") or rec.get("filename")
    if source:
        stable_id = _image_id_from_path(str(source))
        old_id = rec.get("image_id")
        if old_id and old_id != stable_id:
            rec["channel_image_id"] = old_id
        rec["image_id"] = stable_id
    elif not rec.get("image_id"):
        rec["image_id"] = _image_id_from_path("")
    if not rec.get("filename"):
        source = rec.get("image_path") or rec.get("original_rel_path") or rec.get("source_rel_path") or rec.get("image_id")
        rec["filename"] = Path(str(source)).name
    return rec


def _load_analysis_identity_index(job_dir: Path) -> dict[str, str]:
    """Map both stable and legacy channel image_ids to source image paths."""
    result: dict[str, str] = {}
    for sub in ["analysis_channels", "analysis"]:
        csv_dir = job_dir / sub
        if not csv_dir.exists():
            continue
        for csv_file in csv_dir.glob("*.csv"):
            try:
                df = pd.read_csv(csv_file, usecols=lambda c: c in {"image_id", "image_path", "filename"})
            except Exception:
                continue
            for _, row in df.iterrows():
                image_path = row.get("image_path") or row.get("filename")
                if not isinstance(image_path, str) or not image_path:
                    continue
                stable_id = _image_id_from_path(image_path)
                result.setdefault(stable_id, image_path)
                legacy_id = row.get("image_id")
                if isinstance(legacy_id, str) and legacy_id:
                    result.setdefault(legacy_id, image_path)
    return result


def _decode_image_id(image_id: str) -> str | None:
    padding = "=" * (-len(image_id) % 4)
    try:
        return base64.urlsafe_b64decode((image_id + padding).encode("ascii")).decode("utf-8")
    except Exception:
        return None


def _safe_resolve_existing(candidate: Path, allowed_roots: list[Path]) -> Path | None:
    """Return candidate if it exists and stays inside one allowed root."""
    try:
        resolved = candidate.resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    if not resolved.exists() or not resolved.is_file():
        return None
    for root in allowed_roots:
        try:
            resolved.relative_to(root.resolve())
            return resolved
        except (OSError, ValueError):
            continue
    return None


def _get_job_input_folders(job_dir: Path) -> list[Path]:
    folders: list[Path] = []

    def _extend(raw):
        if isinstance(raw, str):
            raw = [raw]
        if isinstance(raw, list):
            for item in raw:
                if item:
                    try:
                        folders.append(Path(item).resolve())
                    except (OSError, RuntimeError, ValueError):
                        pass

    exp = {}
    try:
        exp_path = job_dir / "experiment.json"
        if exp_path.exists():
            with open(exp_path, encoding="utf-8") as f:
                exp = json.load(f)
    except Exception:
        exp = {}
    _extend(exp.get("input_folders") or exp.get("input_dir"))

    try:
        state_path = job_dir / ".job_state.json"
        if state_path.exists():
            with open(state_path, encoding="utf-8") as f:
                state = json.load(f)
            cfg = state.get("config", {})
            _extend(cfg.get("input_folders") or cfg.get("input_dir"))
    except Exception:
        pass

    deduped: list[Path] = []
    seen = set()
    for folder in folders:
        key = str(folder).lower()
        if key not in seen and folder.exists():
            seen.add(key)
            deduped.append(folder)
    return deduped


def _safe_export_folder_name(value: str) -> str:
    from ..path_resolver import sanitize_filename
    return sanitize_filename(value, max_len=120, fallback="export")


def _safe_export_filename(value: str, fallback: str) -> str:
    from ..path_resolver import sanitize_filename
    return sanitize_filename(value, max_len=180, fallback=fallback or "file")


def _render_rename_template(template: str, *, folder: str, index: int, original_stem: str,
                            original_name: str, ext: str) -> str:
    mapping = {
        "folder": folder,
        "index": index,
        "original_stem": original_stem,
        "original_name": original_name,
        "ext": ext.lstrip("."),
    }
    try:
        return template.format(**mapping)
    except (KeyError, ValueError):
        return f"{folder}_{index:04d}"

ALLOWED_SORT_FIELDS = {
    "histogram_outlier_score", "brightness_dark_ratio", "brightness_bright_ratio",
    "brightness_entropy", "saturation_low_ratio", "saturation_high_ratio",
    "hue_warm_ratio", "hue_cool_ratio",
}

ALLOWED_LABELS = {
    "low_key", "high_key", "high_contrast", "flat_light",
    "muted", "vivid", "warm", "cool", "mixed_color", "lineart_like_candidate",
}

# ============================================================
# Analysis Status (v4.5-ui)
# ============================================================


from .results import _resolve_job_dir_safe


def _check_csv_exists(job_id: str, filename: str) -> tuple:
    """Check if a CSV file exists in the job output directory.

    Uses _resolve_job_dir_safe to find the actual job output path.
    Returns (exists: bool, path: Path).
    """
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir is None:
        return False, None
    for sub in ["analysis_channels", "analysis"]:
        p = job_dir / sub / filename
        if p.exists():
            return True, p
    return False, None


@router.get("/status")
def get_analysis_status(job_id: str):
    """Return analysis cache status and available sort/filter options."""
    hist_exists, hist_path = _check_csv_exists(job_id, "histogram_summary.csv")
    qe_exists, qe_path = _check_csv_exists(job_id, "quality_edge_summary.csv")

    # Check basic metadata
    md_exists, _ = _check_csv_exists(job_id, "basic_metadata_summary.csv")

    # Check duplicate groups
    dup_exists, _ = _check_csv_exists(job_id, "duplicate_groups.json")

    # Determine available sort fields
    available_sort = []
    available_labels = []

    if hist_exists:
        available_sort.extend(sorted(ALLOWED_SORT_FIELDS))
        available_labels.extend(sorted(ALLOWED_LABELS))

    if qe_exists:
        available_sort.extend(sorted(QE_ALLOWED_SORT_FIELDS))

    # Metadata sort fields (always available if metadata exists)
    METADATA_SORT_FIELDS = [
        "megapixels", "short_side", "long_side", "aspect_ratio",
        "clipping_ratio", "overexposed_ratio", "underexposed_ratio",
        "file_size_mb", "width", "height",
    ]

    return {
        "ok": True,
        "histogram_ready": hist_exists,
        "quality_edge_ready": qe_exists,
        "histogram_summary_exists": hist_exists,
        "quality_edge_summary_exists": qe_exists,
        "basic_metadata_ready": md_exists,
        "basic_metadata_exists": md_exists,
        "available_sort_fields": sorted(set(available_sort)),
        "available_filter_labels": sorted(set(available_labels)),
        "available_metadata_sort_fields": METADATA_SORT_FIELDS if md_exists else [],
        "capability": {
            "channels": {
                "basic_metadata": {
                    "built": md_exists,
                    "buildable": True,
                    "field_count": len(METADATA_SORT_FIELDS),
                    "sort_fields": sorted(METADATA_SORT_FIELDS),
                    "filter_fields": [],
                    "debug_only_fields": ["transparent_ratio"],
                },
                "histogram": {
                    "built": hist_exists,
                    "buildable": True,
                    "field_count": len(ALLOWED_SORT_FIELDS),
                    "sort_fields": sorted(ALLOWED_SORT_FIELDS),
                    "filter_fields": sorted(ALLOWED_LABELS),
                    "debug_only_fields": ["histogram_outlier_score"],
                },
                "quality_edge": {
                    "built": qe_exists,
                    "buildable": True,
                    "field_count": len(QE_ALLOWED_SORT_FIELDS),
                    "sort_fields": sorted(QE_ALLOWED_SORT_FIELDS),
                    "filter_fields": [],
                    "debug_only_fields": ["lineart_score_v2", "high_contrast_score_v2", "flat_color_score"],
                },
                "duplicate_groups": {
                    "built": _check_csv_exists(job_id, "duplicate_groups.json")[0],
                    "buildable": True,
                    "field_count": 0,
                    "sort_fields": [],
                    "filter_fields": [],
                    "debug_only_fields": [],
                },
                "model_plugins": {
                    "built": False,
                    "buildable": False,
                    "field_count": 0,
                    "sort_fields": [],
                    "filter_fields": [],
                    "debug_only_fields": [],
                },
            },
            "total_built": sum([md_exists, hist_exists, qe_exists, dup_exists]),
            "total_buildable": 4,
        },
        "plugin_channels": _detect_plugins(),
    }


def _detect_plugins() -> dict:
    """Run environment probes for all registered optional plugins.

    Returns dict keyed by plugin_id, each value is the probe result.
    Catches all exceptions so a failing probe never breaks /analysis/status.
    """
    plugins = {}
    try:
        from lighting_engine.core.analysis_channels.plugins.wd14_probe import probe as wd14_probe
        plugins["wd14_tagger"] = wd14_probe()
    except Exception as exc:
        logger.warning("WD14 probe failed: %s", exc)
        plugins["wd14_tagger"] = {
            "plugin_id": "wd14_tagger",
            "name_zh": "WD14 标签器",
            "installed": False,
            "available": False,
            "buildable": False,
            "buildable_note": f"探测失败: {exc}",
        }
    return plugins


def _find_csv(job_id: str) -> Path:
    """Find histogram_summary.csv in job output."""
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir:
        for sub in ["analysis_channels", "analysis"]:
            p = job_dir / sub / "histogram_summary.csv"
            if p.exists():
                return p
        return job_dir / "analysis_channels" / "histogram_summary.csv"
    # fallback — callers handle FileNotFoundError gracefully
    return Path(job_id) / "analysis_channels" / "histogram_summary.csv"


@router.get("/histogram-summary")
def get_histogram_summary(
    job_id: str,
    sort_by: str = Query(None, description="Sort field"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    label: str = Query(None, description="Filter by label"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Get histogram summary with optional sort/filter."""
    csv_path = _find_csv(job_id)
    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": "histogram_summary_not_found",
                "message": "Run tools/build_histogram_channel.py --job-output <job> first.",
            },
        )

    df = pd.read_csv(csv_path)

    # ── Label filter ──
    if label:
        if label not in ALLOWED_LABELS:
            raise HTTPException(status_code=400, detail=f"Invalid label: {label}. Allowed: {sorted(ALLOWED_LABELS)}")
        df = df[df["labels"].str.contains(label, na=False)]

    # ── Sort ──
    if sort_by:
        if sort_by not in ALLOWED_SORT_FIELDS:
            raise HTTPException(status_code=400, detail=f"Invalid sort_by: {sort_by}. Allowed: {sorted(ALLOWED_SORT_FIELDS)}")
        ascending = sort_order == "asc"
        df = df.sort_values(sort_by, ascending=ascending)

    # ── Paginate ──
    total = len(df)
    df = df.iloc[offset:offset + limit]

    # ── Build response ──
    records = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            val = row[col]
            if isinstance(val, (np.integer, np.floating)):
                val = val.item()
            elif pd.isna(val):
                val = None
            rec[col] = val
        _ensure_record_identity(rec)
        records.append(rec)

    return {
        "ok": True,
        "total": total,
        "offset": offset,
        "limit": limit,
        "records": records,
    }


@router.get("/histogram-labels")
def get_histogram_labels_list():
    """Return list of allowed sort fields and labels."""
    return {
        "ok": True,
        "sortable_fields": sorted(ALLOWED_SORT_FIELDS),
        "filterable_labels": sorted(ALLOWED_LABELS),
    }


# ============================================================
# Quality-Edge Summary API (v4.4i)
# ============================================================

QE_ALLOWED_SORT_FIELDS = {
    "sharpness_score", "blur_laplacian_var", "edge_density",
    "edge_strength_p95", "local_contrast_p95", "hue_coverage",
    "lineart_score_v2", "high_contrast_score_v2", "flat_color_score",
}


def _find_qe_csv(job_id: str) -> Path:
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir:
        for sub in ["analysis_channels", "analysis"]:
            p = job_dir / sub / "quality_edge_summary.csv"
            if p.exists():
                return p
        return job_dir / "analysis_channels" / "quality_edge_summary.csv"
    return Path(job_id) / "analysis_channels" / "quality_edge_summary.csv"


@router.get("/quality-edge-summary")
def get_quality_edge_summary(
    job_id: str,
    sort_by: str = Query(None, description="Sort field"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    label: str = Query(None, description="Filter by quality-edge label"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Get quality-edge summary with optional sort/filter."""
    csv_path = _find_qe_csv(job_id)
    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": "quality_edge_summary_not_found",
                "message": "Run tools/build_quality_edge_channel.py first.",
            },
        )

    df = pd.read_csv(csv_path)

    # Label filter
    if label:
        df = df[df.get("quality_edge_labels", "").str.contains(label, na=False)]

    # Sort
    if sort_by:
        if sort_by not in QE_ALLOWED_SORT_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Invalid sort_by: {sort_by}. Allowed: {sorted(QE_ALLOWED_SORT_FIELDS)}")
        ascending = sort_order == "asc"
        df = df.sort_values(sort_by, ascending=ascending)

    total = len(df)
    df = df.iloc[offset:offset + limit]

    records = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            val = row[col]
            if isinstance(val, (np.integer, np.floating)):
                val = val.item()
            elif pd.isna(val):
                val = None
            rec[col] = val
        _ensure_record_identity(rec)
        records.append(rec)

    return {
        "ok": True,
        "total": total,
        "offset": offset,
        "limit": limit,
        "records": records,
    }


@router.get("/quality-edge-fields")
def get_quality_edge_fields():
    """Return list of allowed sort fields."""
    return {
        "ok": True,
        "sortable_fields": sorted(QE_ALLOWED_SORT_FIELDS),
    }


# ============================================================
# Basic Metadata Summary API (v4.5-ui)
# ============================================================


def _find_metadata_csv(job_id: str) -> Path:
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir:
        for sub in ["analysis_channels", "analysis"]:
            p = job_dir / sub / "basic_metadata_summary.csv"
            if p.exists():
                return p
        return job_dir / "analysis_channels" / "basic_metadata_summary.csv"
    return Path(job_id) / "analysis_channels" / "basic_metadata_summary.csv"


METADATA_SORT_FIELDS = {
    "megapixels", "short_side", "long_side", "aspect_ratio",
    "clipping_ratio", "overexposed_ratio", "underexposed_ratio",
    "file_size_mb", "width", "height", "orientation",
    "original_width", "original_height", "original_megapixels",
    "original_file_size_bytes",
}


@router.get("/metadata-summary")
def get_metadata_summary(
    job_id: str,
    sort_by: str = Query(None, description="Sort field"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    """Get basic metadata summary with optional sort."""
    csv_path = _find_metadata_csv(job_id)
    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": "basic_metadata_summary_not_found",
                "message": "Run tools/build_basic_metadata_channel.py --job-output <job> first.",
            },
        )

    df = pd.read_csv(csv_path)

    # Sort
    if sort_by:
        if sort_by not in METADATA_SORT_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Invalid sort_by: {sort_by}. Allowed: {sorted(METADATA_SORT_FIELDS)}")
        ascending = sort_order == "asc"
        df = df.sort_values(sort_by, ascending=ascending)

    total = len(df)
    df = df.iloc[offset:offset + limit]

    records = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            val = row[col]
            if isinstance(val, (np.integer, np.floating)):
                val = val.item()
            elif pd.isna(val):
                val = None
            rec[col] = val
        _ensure_record_identity(rec)
        records.append(rec)

    return {
        "ok": True,
        "total": total,
        "offset": offset,
        "limit": limit,
        "records": records,
    }


# ============================================================
# Build analysis channels (v4.5-ui)
# ============================================================


def _resolve_image_paths(job_dir) -> list:
    """Resolve image paths from a job directory using atlas_points.csv or features.csv.
    
    Resolution order (thumbnail paths are NEVER used for metadata analysis):
    1. Original input folders from job config (input_folders)
    2. job_dir / filename (the pipeline-resized copy, may be 1024px)
    3. job_dir.parent / filename (project root fallback)
    """
    paths = []
    raw_names = []

    # Try atlas_points.csv (image_path column)
    atlas_path = job_dir / "atlas_points.csv"
    if atlas_path.exists():
        df = pd.read_csv(atlas_path)
        if "image_path" in df.columns:
            raw_names = df["image_path"].tolist()

    # Fallback to features.csv (filename column)
    if not raw_names:
        csv_path = job_dir / "features.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            if "filename" in df.columns:
                raw_names = df["filename"].tolist()

    # Read input_folders from job state for original source resolution
    input_folders = []
    try:
        state_path = job_dir / ".job_state.json"
        if state_path.exists():
            with open(state_path, encoding="utf-8") as f:
                state = json.load(f)
            cfg = state.get("config", {})
            raw = cfg.get("input_folders") or cfg.get("input_dir") or []
            if isinstance(raw, str):
                raw = [raw]
            input_folders = [Path(p).resolve() for p in raw if p]
    except Exception:
        pass

    # Try to resolve each name against known locations
    for name in raw_names:
        resolved = None
        path_obj = Path(name)

        # 0a. If name is already absolute and exists, use it directly
        if path_obj.is_absolute() and path_obj.exists():
            resolved = path_obj
        # 0b. Try original input folders first (full-resolution originals)
        if resolved is None:
            for folder in input_folders:
                cand = folder / path_obj.name
                if cand.exists():
                    resolved = cand
                    break
        # 1. name as-is relative to job_dir (pipeline-resized copy)
        if resolved is None:
            cand = job_dir / name
            if cand.exists():
                resolved = cand
        # 2. name relative to project root via job_dir.parent
        if resolved is None:
            cand = job_dir.parent / name
            if cand.exists():
                resolved = cand
        # 3. name relative to parent of parent (deeper project root)
        if resolved is None:
            cand = job_dir.parent.parent / name
            if cand.exists():
                resolved = cand
        if resolved is not None:
            paths.append(str(resolved))

    return paths


def _resolve_original_paths(job_dir, filenames: list) -> dict:
    """Resolve original image paths from job's input_folders.
    
    Returns a dict mapping str(job_dir / filename) -> original Path.
    Only includes filenames that were successfully resolved to an original source.
    """
    result = {}
    input_folders = []
    try:
        state_path = job_dir / ".job_state.json"
        if state_path.exists():
            with open(state_path, encoding="utf-8") as f:
                state = json.load(f)
            cfg = state.get("config", {})
            raw = cfg.get("input_folders") or cfg.get("input_dir") or []
            if isinstance(raw, str):
                raw = [raw]
            input_folders = [Path(p).resolve() for p in raw if p]
    except Exception:
        pass

    if not input_folders:
        return result

    for name in filenames:
        path_obj = Path(name)
        for folder in input_folders:
            cand = folder / path_obj.name
            if cand.exists():
                result[str(job_dir / name)] = cand
                break

    return result


@router.post("/build")
def build_channel(
    job_id: str,
    channel: str = Query(..., pattern="^(basic_metadata|histogram|quality_edge|duplicate_groups)$"),
    force: bool = Query(False),
):
    """构建 analysis channel (basic_metadata / histogram / quality_edge / duplicate_groups)。

    不参与默认聚类，仅用于排序/筛选/review。
    如果缓存已存在且 force=false，直接返回 already_ready。
    """
    t0 = datetime.now()
    job_dir = _resolve_job_dir_safe(job_id)
    if job_dir is None:
        raise HTTPException(status_code=404, detail="job_dir_not_found")

    out_dir = job_dir / "analysis_channels"
    csv_name = f"{channel}_summary.csv"
    csv_path = out_dir / csv_name

    # Duplicate groups uses JSON, not CSV
    dup_json_path = out_dir / "duplicate_groups.json"

    if channel == "duplicate_groups":
        if dup_json_path.exists() and not force:
            import json as _json
            with open(dup_json_path) as f:
                dup_data = _json.load(f)
            return {
                "ok": True,
                "channel": channel,
                "status": "already_ready",
                "path": str(dup_json_path),
                "image_count": dup_data.get("stats", {}).get("total_duplicate_images", 0),
                "duration_sec": 0.0,
            }
    elif csv_path.exists() and not force:
        return {
            "ok": True,
            "channel": channel,
            "status": "already_ready",
            "path": str(csv_path),
            "image_count": len(pd.read_csv(csv_path)),
            "duration_sec": 0.0,
        }

    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        if channel == "basic_metadata":
            from lighting_engine.core.analysis_channels.basic_metadata import (
                build_metadata_summary, find_images, write_csv,
            )
            image_paths = _resolve_image_paths(job_dir)
            if not image_paths:
                image_root = job_dir
                image_paths = [str(p) for p in find_images(image_root)]
            img_paths = [Path(p) for p in image_paths]
            # Resolve original source paths for original_* fields
            filenames = [Path(p).name for p in image_paths]
            orig_map = _resolve_original_paths(job_dir, filenames)
            results = build_metadata_summary(img_paths, job_dir, max_workers=4, original_path_map=orig_map)
            write_csv(results, csv_path)
            image_count = len(results)

        elif channel == "histogram":
            from lighting_engine.core.analysis_channels.histogram_residual import (
                build_histogram_matrix, compute_histogram_residuals,
                compute_histogram_summary,
            )
            import numpy as np
            image_paths = _resolve_image_paths(job_dir)
            if not image_paths:
                raise HTTPException(status_code=400, detail={
                    "error": "image_paths_not_found",
                    "hint": "Use CLI: tools/build_histogram_channel.py --job-output <dir>",
                })
            img_paths = [Path(p) for p in image_paths]
            image_ids, valid_paths, skipped, b_mat, s_mat, h_mat, info_list = \
                build_histogram_matrix(img_paths, max_side=512)
            if b_mat.shape[0] == 0:
                raise ValueError("No valid images processed")
            b_res = compute_histogram_residuals(b_mat)
            s_res = compute_histogram_residuals(s_mat)
            h_res = compute_histogram_residuals(h_mat)
            summary_df = compute_histogram_summary(
                image_ids, valid_paths, b_mat, s_mat, h_mat, info_list,
                b_res, s_res, h_res,
            )
            summary_df.to_csv(csv_path, index=False)
            npz_path = out_dir / "histogram_bank.npz"
            np.savez_compressed(
                npz_path,
                image_ids=image_ids,
                image_paths=[str(p) for p in valid_paths],
                brightness_hist_16=b_mat,
                saturation_hist_16=s_mat,
                hue_hist_24=h_mat,
                brightness_residual_16=b_res["residual"],
                saturation_residual_16=s_res["residual"],
                hue_residual_24=h_res["residual"],
                brightness_z_residual_16=b_res["z_residual"],
                saturation_z_residual_16=s_res["z_residual"],
                hue_z_residual_24=h_res["z_residual"],
            )
            image_count = len(valid_paths)

        elif channel == "quality_edge":
            from lighting_engine.core.analysis_channels.quality_edge import (
                build_quality_edge_matrix,
            )
            image_paths = _resolve_image_paths(job_dir)
            if not image_paths:
                raise HTTPException(status_code=400, detail={
                    "error": "image_paths_not_found",
                    "hint": "Use CLI: tools/build_quality_edge_channel.py --job-output <dir>",
                })
            img_paths = [Path(p) for p in image_paths]
            hist_path = out_dir / "histogram_summary.csv"
            hist_summary = pd.read_csv(hist_path) if hist_path.exists() else None
            iids, vpaths, skipped, df, manifest_data = build_quality_edge_matrix(
                img_paths, max_side=512, histogram_summary=hist_summary,
            )
            if df.empty:
                raise ValueError("No valid images")
            df.to_csv(csv_path, index=False)
            image_count = len(df)

        elif channel == "duplicate_groups":
            from lighting_engine.core.quality.hash_duplicate import build_duplicate_groups as _build_dup
            image_paths = _resolve_image_paths(job_dir)
            if not image_paths:
                raise HTTPException(status_code=400, detail={
                    "error": "image_paths_not_found",
                    "hint": "Ensure atlas_points.csv or features.csv exists in job output.",
                })
            dup_result = _build_dup(image_paths)
            json_path = out_dir / "duplicate_groups.json"
            import json as _json
            with open(json_path, "w", encoding="utf-8") as f:
                _json.dump(dup_result, f, indent=2, ensure_ascii=False)
            image_count = dup_result["stats"]["total_duplicate_images"]

        else:
            raise HTTPException(status_code=400, detail=f"Unknown channel: {channel}")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Build {channel} failed for job {job_id}")
        raise HTTPException(status_code=500, detail={
            "error": "build_failed",
            "channel": channel,
            "message": str(e),
        })

    duration = (datetime.now() - t0).total_seconds()
    result_path = str(dup_json_path) if channel == "duplicate_groups" else str(csv_path)
    return {
        "ok": True,
        "channel": channel,
        "status": "built",
        "path": result_path,
        "image_count": image_count,
        "duration_sec": round(duration, 1),
    }


# ─── Analysis Export (RELEASE-002R) ─────────────────────────────────────────

@router.post("/export")
async def export_analysis(job_id: str, body: dict):
    """Export images from analysis slices / selection.

    RELEASE-002R:
      - 导出到 <output_root>/exports/<export_name>/（只放图片）
      - manifest 写入 _studio/export_records/<export_id>.json
      - 子文件夹重名自动顺延
      - 文件重名自动顺延

    Body:
    {
      "export_name": "青蓝主题_top5",
      "image_ids": ["..."],
      "slice_ids": ["color_cyan_blue"],
      "top_n": 5,
      "rename_mode": "template" | "keep_original" | "index_original",
      "rename_template": "{folder}_{index:04d}"
    }
    """
    from ..path_resolver import (
        resolve_output_root, resolve_job_dir,
        unique_filename,
    )
    from .results import read_json

    mode = body.get("mode", "current_slice")
    export_name = body.get("export_name") or "analysis_export"
    safe_export_name = _safe_export_folder_name(export_name)
    image_ids = body.get("image_ids") or []
    slice_ids = body.get("slice_ids") or []
    top_n = body.get("top_n") or 0
    copy_mode = body.get("copy_mode", "copy_originals")
    rename_mode = body.get("rename_mode", "keep_original")
    skip_duplicates = body.get("skip_duplicates", False)
    rename_template = body.get("rename_template") or "{folder}_{index:04d}"
    slice_name = body.get("slice_name") or export_name
    export_folder_name = body.get("export_folder_name") or export_name

    rename_aliases = {
        "preserve": "keep_original", "keep": "keep_original",
        "rank_rename": "template", "sequential": "template",
        "sequence_original": "index_original", "custom_template": "template",
    }
    rename_mode = rename_aliases.get(rename_mode, rename_mode)
    if rename_mode not in {"keep_original", "template", "index_original"}:
        raise HTTPException(400, "rename_mode must be keep_original, template, or index_original")
    if copy_mode not in {"copy_originals", "manifest_only"}:
        raise HTTPException(400, "copy_mode must be copy_originals or manifest_only")

    # ── Resolve output root ─────────────────────────────────────────────
    output_root = resolve_output_root(job_id)
    if not output_root:
        try:
            from .results import _resolve_job_dir as _old_resolve
            old_dir = _old_resolve(job_id)
            if old_dir:
                output_root = old_dir
        except Exception:
            pass
    if not output_root:
        job_dir = resolve_job_dir(job_id)
        if not job_dir:
            raise HTTPException(404, f"Job output not found: {job_id}")
        output_root = job_dir

    # Allow explicit output_dir override (backward compat + test support)
    base_output_dir = body.get("output_dir") or body.get("base_output_dir") or ""
    if base_output_dir:
        out_root = Path(base_output_dir)
    else:
        out_root = output_root
    d = output_root  # job output dir (for reading image_index etc.)

    input_folders = _get_job_input_folders(d)

    # ── Determine images to export ──────────────────────────────────────
    export_image_ids = []
    for image_id in image_ids:
        if isinstance(image_id, str) and image_id and image_id not in export_image_ids:
            export_image_ids.append(image_id)

    if not export_image_ids and slice_ids:
        # Try inspection_manifest.json
        manifest = read_json(d, "inspection_manifest.json") or read_json(d / "_studio" / "inspection", "inspection_manifest.json")
        if isinstance(manifest, dict):
            all_images_from_manifest = []
            slice_data = manifest.get("slices", manifest)
            if isinstance(slice_data, dict):
                for sid, items in slice_data.items():
                    if isinstance(items, list):
                        for item in items:
                            iid = item.get("image_id") if isinstance(item, dict) else None
                            if iid and iid not in all_images_from_manifest:
                                all_images_from_manifest.append(iid)
            for sid in slice_ids:
                if sid == "all":
                    for iid in all_images_from_manifest:
                        if iid not in export_image_ids:
                            export_image_ids.append(iid)
                else:
                    items = slice_data.get(sid, []) if isinstance(slice_data, dict) else []
                    if isinstance(items, list):
                        for item in items:
                            iid = item.get("image_id") if isinstance(item, dict) else item
                            if isinstance(iid, str) and iid not in export_image_ids:
                                export_image_ids.append(iid)

        # Fallback: image_index.json
        if not export_image_ids:
            for sub in ["_studio", ""]:
                idx = read_json(d / sub, "image_index.json") if sub else read_json(d, "image_index.json")
                if not idx and sub:
                    idx = read_json(d, "image_index.json")
                if isinstance(idx, dict):
                    images_data = idx.get("images", idx)
                    if isinstance(images_data, dict):
                        export_image_ids = list(images_data.keys())
                        break

        # Last resort: features.csv
        if not export_image_ids:
            for root_candidate in [d / "_studio" / "features", d]:
                for f in root_candidate.glob("features.csv"):
                    try:
                        import pandas as pd
                        df = pd.read_csv(f, usecols=lambda c: c in ("image_id", "filename"))
                        col = "image_id" if "image_id" in df.columns else "filename"
                        export_image_ids = df[col].dropna().unique().tolist()
                    except Exception:
                        continue
                    if export_image_ids:
                        break

    # Apply top_n
    if top_n > 0 and len(export_image_ids) > top_n:
        export_image_ids = export_image_ids[:top_n]

    if not export_image_ids:
        if mode == "explicit_images":
            raise HTTPException(400, "No image_ids were provided for explicit_images export")
        raise HTTPException(400, "No images matched the export criteria")

    # ── Determine export directory ──────────────────────────────────────
    if base_output_dir:
        # Explicit override (test compat): use directly
        out_dir = Path(base_output_dir) / safe_export_name
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        # New structure: exports/<name>/ with auto conflict avoidance
        exports_base = out_root / "exports"
        exports_base.mkdir(parents=True, exist_ok=True)
        candidate = exports_base / safe_export_name
        if not candidate.exists():
            out_dir = candidate
        else:
            for i in range(1, 1000):
                candidate = exports_base / f"{safe_export_name}_{i:03d}"
                if not candidate.exists():
                    out_dir = candidate
                    break
            else:
                out_dir = exports_base / f"{safe_export_name}_{999:03d}"
        out_dir.mkdir(parents=True, exist_ok=True)

    # ── Build lookup indices ────────────────────────────────────────────
    image_index = read_json(d, "image_index.json") or read_json(d / "_studio", "image_index.json") or {}
    images_data = image_index.get("images", {}) if isinstance(image_index, dict) else {}
    analysis_identity_index = _load_analysis_identity_index(d)

    # ── Copy files (with optional de-dup) ──────────────────────────────
    copied = 0
    skipped = 0
    dup_skipped = 0
    warnings = []
    manifest_items = []
    export_id = f"analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(str(export_image_ids).encode()).hexdigest()[:6]}"
    seen_image_ids: set[str] = set()  # for skip_duplicates

    def _find_original(image_id: str) -> tuple[Path | None, str | None]:
        if isinstance(images_data, dict):
            info = images_data.get(image_id, {})
            if isinstance(info, dict):
                for key in ("original_path", "source_path", "path", "image_path"):
                    orig_path = info.get(key) or ""
                    if orig_path:
                        p = _safe_resolve_existing(Path(orig_path), input_folders)
                        if p:
                            return p, key
        indexed_path = analysis_identity_index.get(image_id)
        if indexed_path:
            indexed = Path(indexed_path)
            if indexed.is_absolute():
                p = _safe_resolve_existing(indexed, input_folders)
                if p:
                    return p, "analysis_summary_absolute"
            for folder in input_folders:
                p = _safe_resolve_existing(folder / indexed, [folder])
                if p:
                    return p, "analysis_summary_relative"
                p = _safe_resolve_existing(folder / indexed.name, [folder])
                if p:
                    return p, "analysis_summary_filename"
        decoded = _decode_image_id(image_id)
        if decoded:
            decoded_path = Path(decoded)
            if decoded_path.is_absolute():
                p = _safe_resolve_existing(decoded_path, input_folders)
                if p:
                    return p, "decoded_absolute"
            for folder in input_folders:
                p = _safe_resolve_existing(folder / decoded_path, [folder])
                if p:
                    return p, "decoded_relative"
                p = _safe_resolve_existing(folder / decoded_path.name, [folder])
                if p:
                    return p, "decoded_filename"
        for folder in input_folders:
            p = _safe_resolve_existing(folder / image_id, [folder])
            if p:
                return p, "direct_filename"
        return None, None

    for img_id in export_image_ids:
        src, source_kind = _find_original(img_id)
        if src is None or not src.exists():
            warnings.append(f"Original not found: {img_id}")
            skipped += 1
            continue

        # Skip duplicate images in same export batch
        if skip_duplicates:
            if img_id in seen_image_ids:
                dup_skipped += 1
                manifest_items.append({
                    "image_id": img_id,
                    "original_filename": src.name,
                    "export_filename": "",
                    "source_path": str(src),
                    "source_path_rel": _try_relpath(str(src), str(out_root)),
                    "export_path": "",
                    "export_path_rel": "",
                    "matched_slices": slice_ids,
                    "rank": 0,
                    "slice_key": slice_ids[0] if slice_ids else None,
                    "slice_name": slice_name,
                    "export_folder_name": safe_export_name,
                    "rename_mode": rename_mode,
                    "rename_template": rename_template if rename_mode == "template" else None,
                    "source_reason": "skipped_duplicate",
                    "identity_source": source_kind,
                })
                continue
            seen_image_ids.add(img_id)

        rank = len(manifest_items) + 1
        original_filename = src.name

        # Determine filename from rename mode
        if rename_mode == "template":
            rendered = _render_rename_template(
                rename_template,
                folder=safe_export_name,
                index=rank,
                original_stem=src.stem,
                original_name=src.name,
                ext=src.suffix,
            )
            filename = _safe_export_filename(f"{Path(rendered).stem}{src.suffix}", src.name)
        elif rename_mode == "index_original":
            filename = _safe_export_filename(f"{rank:04d}_{src.name}", src.name)
        else:  # keep_original
            filename = src.name

        # Avoid file name conflicts
        dst = unique_filename(out_dir / filename)
        if copy_mode == "copy_originals":
            try:
                shutil.copy2(str(src), str(dst))
                copied += 1
            except OSError as e:
                warnings.append(f"Failed to copy {img_id}: {e}")
                skipped += 1
                continue
        else:
            copied += 1

        manifest_items.append({
            "image_id": img_id,
            "original_filename": original_filename,
            "export_filename": dst.name,
            "source_path": str(src),
            "source_path_rel": _try_relpath(str(src), str(output_root)),
            "export_path": str(dst),
            "export_path_rel": _try_relpath(str(dst), str(output_root)),
            "matched_slices": slice_ids,
            "rank": rank,
            "slice_key": slice_ids[0] if slice_ids else None,
            "slice_name": slice_name,
            "export_folder_name": safe_export_name,
            "rename_mode": rename_mode,
            "rename_template": rename_template if rename_mode == "template" else None,
            "source_reason": body.get("source_reason") or "cart_item",
            "identity_source": source_kind,
        })

    if not manifest_items:
        raise HTTPException(400, "No valid original images found for provided image_ids")

    # ── Write manifest to _studio/export_records/ (not in exports/) ─────
    manifest_data = {
        "version": 2,
        "export_id": export_id,
        "job_id": job_id,
        "export_type": "analysis",
        "created_at": datetime.now().isoformat(),
        "output_root": str(out_root),
        "export_name": safe_export_name,
        "slice_name": slice_name,
        "export_folder_name": safe_export_name,
        "export_dir": str(out_dir),
        "export_dir_rel": _try_relpath(str(out_dir), str(out_root)),
        "rename_mode": rename_mode,
        "rename_template": rename_template if rename_mode == "template" else None,
        "mode": mode,
        "copy_mode": copy_mode,
        "slice_ids": slice_ids if slice_ids else None,
        "skip_duplicates": skip_duplicates,
        "skipped_duplicate_count": dup_skipped,
        "count": copied,
        "skipped": skipped,
        "items": manifest_items,
        "warnings": warnings[:200],
    }
    # Write record directly to avoid re-resolving path (which may fail in tests)
    records_dir = out_root / "_studio" / "export_records"
    record_path = None
    try:
        records_dir.mkdir(parents=True, exist_ok=True)
        record_path = records_dir / f"{export_id}.json"
        with open(record_path, "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, indent=2, ensure_ascii=False)
    except OSError as e:
        warnings.append(f"Failed to write export record: {e}")

    # Also write CSV to _studio/export_records/
    csv_records_path = None
    try:
        csv_path = records_dir / f"{export_id}.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "image_id", "original_filename", "export_filename",
                "source_path", "source_path_rel", "export_path", "export_path_rel",
                "matched_slices", "rank", "slice_key", "slice_name",
                "export_folder_name", "rename_mode", "rename_template",
            ])
            for item in manifest_items:
                writer.writerow([
                    item["image_id"], item["original_filename"], item["export_filename"],
                    item["source_path"], item.get("source_path_rel", ""),
                    item["export_path"], item.get("export_path_rel", ""),
                    ";".join(item["matched_slices"]), item["rank"],
                    item["slice_key"], item["slice_name"],
                    item["export_folder_name"], item["rename_mode"],
                    item["rename_template"] or "",
                ])
        csv_records_path = str(csv_path)
    except OSError as e:
        warnings.append(f"Failed to write CSV record: {e}")

    return {
        "ok": True,
        "export_id": export_id,
        "export_dir": str(out_dir),
        "export_dir_rel": _try_relpath(str(out_dir), str(out_root)),
        "manifest_path": str(record_path) if record_path else "",
        "copied_count": copied,
        "skipped_count": skipped,
        "duplicate_skipped_count": dup_skipped,
        "warnings": warnings[:20],
    }


def _try_relpath(path: str, base: str) -> str:
    """Try to compute relative path, return absolute if not possible."""
    try:
        return str(Path(path).relative_to(Path(base)))
    except (ValueError, OSError):
        return path
