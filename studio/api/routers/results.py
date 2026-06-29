"""Results router — serve pipeline output data as REST API.

Minimal v2: 简洁, 多根扫描, 全部依赖 .job_state.json 风格的输出目录。
"""

from __future__ import annotations

import io
import json
import base64
from collections import Counter
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from studio.api.organize_state import (
    apply_organized_state,
    load_cluster_catalog,
    load_layout,
    load_manual_order,
    load_organized_rows,
    parse_cluster_id,
    read_csv,
    read_json,
    save_layout,
    save_manual_order,
)

router = APIRouter(prefix="/results", tags=["results"])

# 4 层 parent: routers/ → api/ → studio/ → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_OUTPUTS_BASE = _PROJECT_ROOT

# 颜色
_CLUSTER_COLORS = [
    "#46f1c5", "#ffd93d", "#ff6b9d", "#78d6ce",
    "#bc99ff", "#ff9b6b", "#6bcb77", "#ffa3d2"
]


def _resolve_job_dir(job_id: str) -> Path:
    """解析 job_id 到输出目录。

    优先级:
    1. jobs.py in-memory 状态 (output_folder)
    2. 磁盘扫描: 直接匹配 / _output 后缀 / 包含子串
    3. 扫描多个根
    """
    if not job_id:
        raise HTTPException(status_code=404, detail="Empty job_id")
    from light_analysis_engine.workspace.compatibility import resolve_output_root
    resolved_root = resolve_output_root(job_id, roots=[_OUTPUTS_BASE, _OUTPUTS_BASE.parent])
    if resolved_root:
        return resolved_root

    # 1. jobs.py 内存状态
    try:
        import studio.api.routers.jobs as jobs_mod
        state = jobs_mod._jobs.get(job_id) or {}
        out = state.get("config", {}).get("output_folder") or state.get("output_folder")
        if out:
            p = Path(out)
            if p.is_dir():
                return p
    except Exception:
        pass

    # 2. 磁盘扫描
    roots = [_OUTPUTS_BASE, _OUTPUTS_BASE.parent]
    for root in roots:
        d = root / job_id
        if d.is_dir():
            return d
        for suffix in ["_output", "_output_v7", "_output_v6"]:
            candidate = root / f"{job_id}{suffix}"
            if candidate.is_dir():
                return candidate
        for p in root.iterdir():
            if not p.is_dir():
                continue
            if p.name.startswith("test_") and p.name not in job_id:
                continue
            if job_id in p.name:
                return p
    raise HTTPException(status_code=404, detail=f"Job output not found: {job_id}")


def _assign_color(cid: int) -> str:
    return _CLUSTER_COLORS[abs(cid) % len(_CLUSTER_COLORS)]


def _image_id_from_path(value: str) -> str:
    raw = str(value or "").replace("\\", "/")
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _decode_image_id(value: str) -> str:
    padding = "=" * (-len(value or "") % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")
    except Exception:
        return value


def _load_edits(path: Path) -> dict:
    return read_json(path, "cluster_edits.json")


def _load_moves(path: Path) -> dict:
    return read_json(path, "cluster_moves.json")


# ============================================================
# Endpoints
# ============================================================

@router.get("/jobs")
async def list_jobs():
    """List all known jobs (in-memory + from disk)."""
    jobs = []
    seen = set()
    # In-memory jobs
    for j_id in list_jobs._known_ids():
        if j_id in seen:
            continue
        seen.add(j_id)
        d = _resolve_job_dir_safe(j_id)
        if d:
            jobs.append({
                "id": j_id,
                "output_folder": str(d),
                "from_memory": True
            })
    # Disk scan
    skip = {"studio", "lighting_engine", "docs", "tests", "node_modules",
            ".git", "__pycache__", "depth-anything-3", "DA3Small",
            "exports", "lighting_outputs", ".cache", "backup",
            "Pictures", "Documents", "Downloads", "Desktop", "AppData"}
    for root in [_PROJECT_ROOT, _PROJECT_ROOT.parent]:
        if not root.exists():
            continue
        for d in root.iterdir():
            if not d.is_dir():
                continue
            if d.name in skip or d.name.startswith("."):
                continue
            # 找 .job_state.json
            state = read_json(d, ".job_state.json")
            if not state:
                continue
            j_id = state.get("id")
            if not j_id or j_id in seen:
                continue
            seen.add(j_id)
            jobs.append({
                "id": j_id,
                "status": state.get("status", "unknown"),
                "created_at": state.get("created_at"),
                "completed_at": state.get("completed_at"),
                "output_folder": str(d),
                "stage": state.get("stage"),
                "progress": state.get("progress"),
                "error": state.get("error"),
                "result_summary": state.get("result_summary"),
            })
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"jobs": jobs}


def _resolve_job_dir_safe(job_id: str) -> Optional[Path]:
    """Safe version - returns None instead of raising."""
    try:
        return _resolve_job_dir(job_id)
    except HTTPException:
        return None


# 用于兼容 jobs.py 的 in-memory 状态
list_jobs._known_ids = lambda: []
# Patch: 把 jobs.py 的 in-memory 状态合并进来
def _patch_in_memory():
    try:
        import studio.api.routers.jobs as jobs_mod
        # 合并 in-memory
        original = list_jobs._known_ids
        def merged():
            ids = set()
            try:
                for j_id in jobs_mod._jobs:
                    ids.add(j_id)
            except Exception:
                pass
            return list(ids)
        list_jobs._known_ids = merged
    except Exception:
        pass

_patch_in_memory()


@router.get("/{job_id}/summary")
async def get_summary(job_id: str):
    """Top-level result summary."""
    d = _resolve_job_dir(job_id)
    report = read_json(d, "report.json")
    if not report:
        # Fallback: read cluster_summary for totals
        cs = read_json(d, "cluster_summary.json")
        if cs:
            total = sum(v.get("count", 0) for k, v in cs.items() if k != "noise")
            noise = cs.get("noise", {}).get("count", 0)
            return {
                "total_images": total + noise,
                "clusters": len([k for k in cs.keys() if k != "noise"]),
                "noise_count": noise,
                "from_cluster_summary": True
            }
        raise HTTPException(404, "report.json not found")
    return report


@router.get("/{job_id}/clusters")
async def list_clusters(job_id: str):
    """List all clusters with counts, names, colors."""
    try:
        from light_analysis_engine.workspace import get_workspace_runtime
        return get_workspace_runtime(job_id).clusters_json()
    except HTTPException:
        pass
    except Exception:
        pass
    d = _resolve_job_dir(job_id)
    rows = load_organized_rows(d)
    cluster_catalog = load_cluster_catalog(d)
    counts = Counter(str(row.get("cluster_id", -1)) for row in rows)

    cluster_ids = {
        cid for cid in cluster_catalog.keys()
        if cid.lstrip("-").isdigit() and int(cid) >= 0
    }
    cluster_ids.update(
        cid for cid in counts.keys()
        if cid.lstrip("-").isdigit() and int(cid) >= 0
    )

    items = []
    for cid_str in sorted(cluster_ids, key=lambda value: int(value)):
        cid = int(cid_str)
        info = cluster_catalog.get(cid_str) or {}
        name = info.get("display_name") or info.get("suggested_name") or f"Cluster {cid}"
        items.append({
            "id": cid_str,
            "name": name,
            "count": counts.get(cid_str, 0),
            "color": _assign_color(cid),
            "confidence": info.get("confidence", 0),
            "label_key": info.get("label_key", ""),
            "components": info.get("components", []),
            "suggested_name": info.get("suggested_name", name),
        })

    noise_count = counts.get("-1", 0)
    if noise_count or "-1" in cluster_catalog:
        noise_info = cluster_catalog.get("-1") or {}
        items.append({
            "id": "-1",
            "name": noise_info.get("display_name", "noise"),
            "count": noise_count,
            "color": "#404040",
            "confidence": noise_info.get("confidence", 0),
            "label_key": noise_info.get("label_key", "noise"),
            "components": noise_info.get("components", ["noise"]),
            "suggested_name": noise_info.get("suggested_name", "noise"),
        })

    return {"clusters": items}


@router.get("/{job_id}/images")
async def list_images(job_id: str, cluster_id: Optional[str] = None,
                    limit: int = Query(200, ge=1, le=2000),
                    offset: int = Query(0, ge=0)):
    """List images, optionally filtered by cluster."""
    d = _resolve_job_dir(job_id)
    rows = load_organized_rows(d)
    if not rows:
        return {"images": [], "total": 0}

    items = []
    requested_cluster_id = None if cluster_id is None else parse_cluster_id(cluster_id)
    for row in rows:
        cid_int = parse_cluster_id(row.get("cluster_id", -1))
        if requested_cluster_id is not None and cid_int != requested_cluster_id:
            continue
        items.append({
            "filename": row.get("filename") or Path(row.get("image_path", "")).name,
            "image_path": row.get("image_path", ""),
            "image_id": row.get("image_id") or _image_id_from_path(row.get("image_path") or row.get("filename") or ""),
            "cluster_id": cid_int,
            "cluster_name": row.get("cluster_name", ""),
            "original_cluster_id": parse_cluster_id(row.get("original_cluster_id", -1)),
        })

    total = len(items)
    items = items[offset:offset + limit]
    return {"images": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{job_id}/embeddings")
async def get_embeddings(job_id: str, format: str = Query("atlas")):
    """Get UMAP coordinates."""
    d = _resolve_job_dir(job_id)
    if format == "atlas":
        rows = read_csv(d, "atlas_points.csv") or read_csv(d, "umap_points_3d.csv")
    else:
        rows = read_csv(d, "umap_points_3d.csv") or read_csv(d, "atlas_points.csv")
    atlas = apply_organized_state(d, rows) if rows else []
    return {"points": atlas, "format": format}


@router.get("/{job_id}/features")
async def get_features(job_id: str):
    """Get feature metadata (names, importance)."""
    d = _resolve_job_dir(job_id)
    fi = read_json(d, "feature_importance.json")
    return fi


@router.get("/{job_id}/health")
async def get_health(job_id: str):
    """Get cluster health assessment."""
    d = _resolve_job_dir(job_id)
    return read_json(d, "cluster_health.json")


@router.get("/{job_id}/image")
@router.get("/{job_id}/original")
async def get_original_image(job_id: str, image_id: str = Query(...)):
    """Serve original image by image_id (aliased at /image and /original).

    image_id is the url-safe base64 of the original relative path.
    Returns the original image file, not a thumbnail.
    Security: only serves files registered in the job's input directory.
    """
    try:
        from light_analysis_engine.workspace import get_workspace_runtime
        return get_workspace_runtime(job_id).media.get_original_response(image_id)
    except HTTPException:
        raise
    except Exception:
        pass
    d = _resolve_job_dir(job_id)
    decoded = _decode_image_id(image_id)
    decoded_name = Path(decoded).name
    candidates = [decoded]
    if decoded_name and decoded_name not in candidates:
        candidates.append(decoded_name)
    for row in load_organized_rows(d):
        if row.get("image_id") == image_id or _image_id_from_path(row.get("image_path") or row.get("filename") or "") == image_id:
            for key in ("image_path", "filename"):
                value = str(row.get(key) or "")
                if value and value not in candidates:
                    candidates.append(value)
                name = Path(value).name
                if name and name not in candidates:
                    candidates.append(name)

    # Try to find the image in job input folders
    exp = read_json(d, "experiment.json")
    input_folders = exp.get("input_folders", [])
    for folder in input_folders:
        folder_path = Path(folder)
        for rel in candidates:
            for cand in (folder_path / rel, folder_path / Path(rel).name):
                if cand.exists() and cand.is_file():
                    try:
                        resolved = cand.resolve()
                        folder_resolved = folder_path.resolve()
                        if not str(resolved).startswith(str(folder_resolved)):
                            continue
                    except (OSError, ValueError):
                        continue
                    with open(cand, "rb") as f:
                        content = f.read()
                    import mimetypes
                    mime = mimetypes.guess_type(str(cand))[0] or "image/jpeg"
                    return Response(content=content, media_type=mime,
                                    headers={"Cache-Control": "public, max-age=3600"})

    for rel in candidates:
        cand = d / rel
        if cand.exists() and cand.is_file():
            try:
                resolved = cand.resolve()
                job_resolved = d.resolve()
                if not str(resolved).startswith(str(job_resolved)):
                    continue
            except (OSError, ValueError):
                continue
            with open(cand, "rb") as f:
                content = f.read()
            import mimetypes
            mime = mimetypes.guess_type(str(cand))[0] or "image/jpeg"
            return Response(content=content, media_type=mime,
                            headers={"Cache-Control": "public, max-age=3600"})

    raise HTTPException(
        404,
        f"Original image not found for image_id={image_id}. Tried decoded path '{decoded}' and filename '{decoded_name}'.",
    )


@router.get("/{job_id}/images/{image_id}/meta")
async def get_image_meta(job_id: str, image_id: str):
    """Return image metadata (exists, source_path, thumbnail_url, original_url).

    Unified image reference endpoint.
    """
    try:
        from light_analysis_engine.workspace import get_workspace_runtime
        return get_workspace_runtime(job_id).media.get_image_ref(image_id).to_json()
    except HTTPException:
        raise
    except Exception:
        pass
    d = _resolve_job_dir(job_id)
    from urllib.parse import quote

    decoded = _decode_image_id(image_id)
    decoded_name = Path(decoded).name

    # Try to find source file
    source_path = None
    exists = False
    exp = read_json(d, "experiment.json")
    input_folders = exp.get("input_folders", [])
    candidates = [decoded]
    if decoded_name and decoded_name not in candidates:
        candidates.append(decoded_name)

    for folder in input_folders:
        folder_path = Path(folder)
        for rel in candidates:
            for cand in (folder_path / rel, folder_path / Path(rel).name):
                if cand.exists() and cand.is_file():
                    source_path = str(cand)
                    exists = True
                    break
            if exists:
                break
        if exists:
            break

    if not exists:
        for rel in candidates:
            cand = d / rel
            if cand.exists() and cand.is_file():
                source_path = str(cand)
                exists = True
                break

    from ..path_resolver import sanitize_filename

    response_data = {
        "image_id": image_id,
        "exists": exists,
        "source_path": source_path or "",
        "reason": "" if exists else "source file missing",
        "thumbnail_url": f"/api/v1/results/{job_id}/thumbnail?image_id={image_id}&size=384",
        "original_url": f"/api/v1/results/{job_id}/original?image_id={image_id}",
    }
    return response_data


@router.get("/{job_id}/thumbnail")
async def get_thumbnail(job_id: str, path: str = Query(default=None),
                        image_id: str = Query(default=None),
                        size: int = Query(256, ge=64, le=2048)):
    """Serve image thumbnail. Supports configurable size. Caches per size.

    Accepts either `path` (raw file path) or `image_id` (base64 encoded path).
    RELEASE-002R: cache to <output_root>/_cache/thumbnails/<size>/
    Old fallback: <output_root>/thumbnails/
    """
    if image_id:
        try:
            from light_analysis_engine.workspace import get_workspace_runtime
            return get_workspace_runtime(job_id).media.get_thumbnail_response(image_id, size=size)
        except HTTPException:
            raise
        except Exception:
            pass
    from ..path_resolver import find_thumbnail_file, resolve_output_root, resolve_thumbnail_dir

    d = _resolve_job_dir(job_id)
    stem = Path(path or image_id or "image").stem

    # Try new cache path _cache/thumbnails/, then old thumbnails/
    cached = find_thumbnail_file(job_id, stem, size)
    if cached:
        with open(cached, "rb") as f:
            return Response(content=f.read(), media_type="image/jpeg")

    # Try the default 256px pregen (new or old location)
    for base in [d / "_cache" / "thumbnails", d / "thumbnails"]:
        pregen = base / f"{stem}.jpg"
        if size == 256 and pregen.exists():
            with open(pregen, "rb") as f:
                return Response(content=f.read(), media_type="image/jpeg")

        # Resize on-demand from pregen
        if pregen.exists():
            try:
                from PIL import Image
                import io
                img = Image.open(pregen)
                w, h = img.size
                if w > size or h > size:
                    ratio = size / max(w, h)
                    img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
                elif w < size and h < size:
                    with open(pregen, "rb") as f:
                        return Response(content=f.read(), media_type="image/jpeg")
                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="JPEG", quality=85 if size <= 512 else 78)
                # Cache to new structure
                thumb_dir = resolve_thumbnail_dir(job_id, size)
                if thumb_dir:
                    thumb_dir.mkdir(parents=True, exist_ok=True)
                    with open(thumb_dir / f"{stem}.jpg", "wb") as f:
                        f.write(buf.getvalue())
                return Response(content=buf.getvalue(), media_type="image/jpeg",
                               headers={"Cache-Control": "public, max-age=86400"})
            except ImportError:
                with open(pregen, "rb") as f:
                    return Response(content=f.read(), media_type="image/jpeg")

    # On-demand resize from source
    # Resolve source path from `path` (raw) or `image_id` (base64)
    if path:
        img_path = None
        p = Path(path)
        if p.is_absolute() and p.exists():
            img_path = p
        else:
            cand = d / path
            if cand.exists():
                img_path = cand
        if not img_path:
            exp = read_json(d, "experiment.json")
            for folder in exp.get("input_folders", []):
                cand = Path(folder) / path
                if cand.exists():
                    img_path = cand
                    break
                cand2 = Path(folder) / Path(path).name
                if cand2.exists():
                    img_path = cand2
                    break
    elif image_id:
        # Resolve via image_id (base64 encoded path)
        decoded = _decode_image_id(image_id)
        decoded_name = Path(decoded).name
        candidates = [decoded]
        if decoded_name and decoded_name not in candidates:
            candidates.append(decoded_name)
        img_path = None
        exp = read_json(d, "experiment.json")
        for folder in exp.get("input_folders", []):
            folder_path = Path(folder)
            for rel in candidates:
                for cand in (folder_path / rel, folder_path / Path(rel).name):
                    if cand.exists() and cand.is_file():
                        img_path = cand
                        break
                if img_path:
                    break
            if img_path:
                break
        if not img_path:
            for rel in candidates:
                cand = d / rel
                if cand.exists() and cand.is_file():
                    img_path = cand
                    break
    else:
        img_path = None

    if not img_path or not img_path.exists():
        detail = f"Image not found: path={path or '(none)'} image_id={image_id or '(none)'}"
        raise HTTPException(404, detail)
    try:
        from PIL import Image
        import io
        img = Image.open(img_path)
        w, h = img.size
        if w > size or h > size:
            ratio = size / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=85 if size <= 512 else 78)
        # Cache to new structure _cache/thumbnails/<size>/
        from ..path_resolver import resolve_thumbnail_dir
        thumb_dir = resolve_thumbnail_dir(job_id, size)
        if thumb_dir:
            thumb_dir.mkdir(parents=True, exist_ok=True)
            with open(thumb_dir / f"{stem}.jpg", "wb") as f:
                f.write(buf.getvalue())
        return Response(content=buf.getvalue(), media_type="image/jpeg",
                       headers={"Cache-Control": "public, max-age=86400"})
    except ImportError:
        with open(img_path, "rb") as f:
            return Response(content=f.read(), media_type="image/jpeg")

@router.patch("/{job_id}/clusters/{cluster_id}")
async def patch_cluster(job_id: str, cluster_id: str, body: dict):
    """Update cluster metadata (display_name, color, tags)."""
    d = _resolve_job_dir(job_id)
    edits_path = d / "cluster_edits.json"
    edits = read_json(d, "cluster_edits.json")
    if "display_name" not in edits or not isinstance(edits.get("display_name"), dict):
        edits["display_name"] = {}
    changed = []
    if "display_name" in body:
        edits["display_name"][cluster_id] = body["display_name"]
        changed.append("display_name")
    if "color" in body:
        if "color" not in edits:
            edits["color"] = {}
        edits["color"][cluster_id] = body["color"]
        changed.append("color")
    try:
        with open(edits_path, "w", encoding="utf-8") as f:
            json.dump(edits, f, indent=2, ensure_ascii=False)
    except OSError:
        raise HTTPException(500, "Failed to save cluster edits")
    return {"cluster_id": cluster_id, "updated": changed, "entry": body}


@router.post("/{job_id}/images/move")
async def move_images(job_id: str, body: dict):
    """Move images to another cluster (legacy endpoint)."""
    d = _resolve_job_dir(job_id)
    moves_path = d / "cluster_moves.json"
    existing = read_json(d, "cluster_moves.json")
    moved = 0
    for m in body.get("moves", []):
        fn = m.get("filename", "")
        target = str(m.get("target_cluster_id", ""))
        if fn and target:
            existing[fn] = target
            moved += 1
    try:
        with open(moves_path, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
    except OSError:
        raise HTTPException(500, "Failed to save moves")
    return {"moved": moved, "job_id": job_id}


@router.post("/{job_id}/organize/save")
async def save_organize_changes(job_id: str, body: dict):
    """批量保存所有用户编辑 (moves + renames + layout + manual_order)

    Body:
    {
      "moves":   [{"filename": "x.jpg", "target_cluster_id": "1"}, ...],
      "renames": [{"cluster_id": "0", "display_name": "My Name"}, ...],
      "layout":  {"0": {"x": 100, "y": 200}, "1": {"x": 300, "y": 400}},  // optional
      "manual_order": {"0": ["img_a.jpg", "img_b.jpg"], ...}              // optional
    }

    写入 (合并模式，保留历史):
    - {output_dir}/cluster_moves.json
    - {output_dir}/cluster_edits.json
    - {output_dir}/cluster_layout.json
    - {output_dir}/manual_order.json
    """
    d = _resolve_job_dir(job_id)
    moves = body.get("moves", []) or []
    renames = body.get("renames", []) or []
    layout = body.get("layout")
    manual_order = body.get("manual_order")

    # === moves ===
    moves_path = d / "cluster_moves.json"
    existing_moves = read_json(d, "cluster_moves.json")
    moved_count = 0
    for m in moves:
        fn = m.get("filename", "")
        target = str(m.get("target_cluster_id", ""))
        if fn and target:
            existing_moves[fn] = target
            moved_count += 1
    try:
        with open(moves_path, "w", encoding="utf-8") as f:
            json.dump(existing_moves, f, indent=2, ensure_ascii=False)
    except OSError as e:
        raise HTTPException(500, f"Failed to save moves: {e}")

    # === renames ===
    edits_path = d / "cluster_edits.json"
    existing_edits = read_json(d, "cluster_edits.json")
    if "display_name" not in existing_edits or not isinstance(existing_edits.get("display_name"), dict):
        existing_edits["display_name"] = {}
    renamed_count = 0
    for r in renames:
        cid = str(r.get("cluster_id", ""))
        name = r.get("display_name", "")
        if cid and name:
            existing_edits["display_name"][cid] = name
            renamed_count += 1
    try:
        with open(edits_path, "w", encoding="utf-8") as f:
            json.dump(existing_edits, f, indent=2, ensure_ascii=False)
    except OSError as e:
        raise HTTPException(500, f"Failed to save renames: {e}")

    # === layout (optional) ===
    if layout is not None:
        if not save_layout(d, layout):
            # Don't fail the whole request; log and continue
            print(f"[WARN] Failed to save layout for job {job_id}")

    # === manual_order (optional) ===
    if manual_order is not None:
        if not save_manual_order(d, manual_order):
            print(f"[WARN] Failed to save manual_order for job {job_id}")

    return {
        "ok": True,
        "moved": moved_count,
        "renamed": renamed_count,
        "job_id": job_id
    }


@router.get("/{job_id}/organize/state")
async def get_organize_state(job_id: str):
    """Get the full organize state including layout and manual_order."""
    d = _resolve_job_dir(job_id)
    layout = load_layout(d)
    manual_order = load_manual_order(d)
    return {
        "ok": True,
        "layout": layout,
        "manual_order": manual_order,
    }
