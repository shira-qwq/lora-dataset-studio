"""Jobs router — 完整重构 v2

特性:
- 持久化：每个 job 状态写入 {output_dir}/.job_state.json
- 日志持久化：每个 job 日志写入 {output_dir}/job.log
- 启动恢复：服务启动时从磁盘恢复所有 jobs
- 断线友好：客户端可以从 log 任意 offset 读取
- Restart：失败/取消的 job 可以重新跑
- 动态 config：完全接受任意 dict（通过 ConfigProxy 映射到 CONFIG）
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/jobs", tags=["jobs"])

# jobs.py 位于 studio/api/routers/jobs.py
# __file__ = .../studio/api/routers/jobs.py
# .parent = .../studio/api/routers/
# .parent.parent = .../studio/api/
# .parent.parent.parent = .../studio/
# .parent.parent.parent.parent = .../ (项目根)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


# ==============================================================================
# 常量
# ==============================================================================

STAGES = ["scan", "preprocess", "assemble", "diagnose", "umap", "cluster", "name", "output"]
STAGE_LABELS = {
    "scan":       "扫描图片",
    "preprocess": "预处理",
    "assemble":   "特征装配",
    "diagnose":   "特征诊断",
    "umap":       "UMAP 降维",
    "cluster":    "聚类",
    "name":       "命名",
    "output":     "写产物",
}

# ==============================================================================
# 内存状态（启动时从磁盘恢复）
# ==============================================================================

# job_id -> Job state (in-memory cache, source of truth for live SSE)
_jobs: Dict[str, dict] = {}
# job_id -> asyncio.Queue (live SSE)
_event_queues: Dict[str, asyncio.Queue] = {}
# job_id -> threading.Event (cancellation)
_cancel_flags: Dict[str, threading.Event] = {}


# ==============================================================================
# 持久化
# ==============================================================================

def _job_state_path(output_dir: str) -> Path:
    """Job state path. New jobs write to _studio/. Old jobs at root."""
    p = Path(output_dir)
    from light_analysis_engine.workspace import WorkspaceLayout
    layout = WorkspaceLayout.from_output_root(p)
    new_path = layout.studio_dir / ".job_state.json"
    old_path = p / ".job_state.json"
    if new_path.exists() or not old_path.exists():
        return new_path
    return old_path


def _job_log_path(output_dir: str) -> Path:
    """Job log path. New jobs write to _studio/logs/. Old jobs at root."""
    p = Path(output_dir)
    from light_analysis_engine.workspace import WorkspaceLayout
    layout = WorkspaceLayout.from_output_root(p)
    new_path = layout.logs_dir / "job.log"
    old_path = p / "job.log"
    if new_path.exists() or not old_path.exists():
        return new_path
    return old_path


def _get_output_dir(state: dict) -> Optional[str]:
    """从 state 中提取 output_dir（兼容多种 key）"""
    if not state:
        return None
    cfg = state.get("config", {})
    return (cfg.get("output_folder") or cfg.get("output_dir")
            or state.get("output_folder") or state.get("output_dir"))


def _save_state(job_id: str):
    """Persist current job state to disk"""
    state = _jobs.get(job_id)
    if not state:
        return
    out = _get_output_dir(state)
    if not out:
        return
    try:
        Path(out).mkdir(parents=True, exist_ok=True)
        # Don't include non-serializable fields
        save = {k: v for k, v in state.items() if k not in ("_unsubscribe",)}
        # Convert sets
        with open(_job_state_path(out), "w", encoding="utf-8") as f:
            json.dump(save, f, indent=2, ensure_ascii=False, default=str)
    except Exception as e:
        print(f"[WARN] save_state failed for {job_id}: {e}")


def _load_state(output_dir: str) -> Optional[dict]:
    """Load job state from disk"""
    p = _job_state_path(output_dir)
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _log(job_id: str, msg: str, level: str = "info"):
    """Write log message to file + memory queue"""
    state = _jobs.get(job_id)
    if not state:
        return
    out = _get_output_dir(state)
    if not out:
        return
    timestamp = datetime.now().isoformat(timespec="seconds")
    line = f"[{timestamp}] [{level.upper()}] {msg}\n"
    # Write to file
    try:
        Path(out).mkdir(parents=True, exist_ok=True)
        with open(_job_log_path(out), "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        print(f"[WARN] log write failed: {e}")
    # Send to live queue
    q = _event_queues.get(job_id)
    if q:
        try:
            q.put_nowait({"event": "log", "data": {"message": msg, "level": level}})
        except Exception:
            pass


def _put_event(job_id: str, event: str, data: dict):
    """Send event to live SSE queue (and log to file)"""
    if event == "log":
        _log(job_id, data.get("message", ""), data.get("level", "info"))
    q = _event_queues.get(job_id)
    if q:
        try:
            q.put_nowait({"event": event, "data": data})
        except Exception:
            pass


def _put_stage_event(job_id: str, stage: str, progress: float, log: str = ""):
    """Emit stage progress event + save state + log to file"""
    cancel = _cancel_flags.get(job_id)
    if cancel and cancel.is_set():
        raise InterruptedError("Cancelled by user")
    if stage not in STAGES:
        return
    state = _jobs.get(job_id)
    if state:
        state["stage"] = stage
        state["stage_index"] = STAGES.index(stage)
        state["progress"] = progress
        if log:
            state["last_log"] = log
        state["updated_at"] = datetime.now().isoformat()
        _save_state(job_id)
    # Always log to file (even if no log msg, show stage transition)
    if log:
        _log(job_id, f"[{STAGE_LABELS.get(stage, stage)}] {log}", "info")
    else:
        _log(job_id, f"[{STAGE_LABELS.get(stage, stage)}] {progress*100:.0f}%", "info")
    _put_event(job_id, "progress", {
        "stage": stage,
        "stage_index": STAGES.index(stage),
        "stage_total": len(STAGES),
        "progress": progress,
        "log": log
    })


# ==============================================================================
# 启动恢复
# ==============================================================================

def _recover_jobs_on_startup():
    """扫描 PROJECT_ROOT (及父目录) 下所有子目录，找到 .job_state.json 恢复 jobs"""
    recovered = 0
    # 扫描多个候选根（项目根 + 父目录，因为用户可能把 output 放到父目录）
    roots_to_scan = [_PROJECT_ROOT]
    parent = _PROJECT_ROOT.parent
    if parent != _PROJECT_ROOT:
        roots_to_scan.append(parent)

    skip_names = {
        "studio", "lighting_engine", "docs", "tests", "node_modules",
        ".git", "__pycache__", "depth-anything-3", "DA3Small",
        "exports", "lighting_outputs", ".cache", "backup",
        "venv", ".venv", "env",
        # 用户目录（避免扫整硬盘）
        "Pictures", "Documents", "Downloads", "Desktop",
        # 可能误包含的其他
        "AppData", "Program Files"
    }

    for root in roots_to_scan:
        for d in root.iterdir():
            if not d.is_dir():
                continue
            if d.name in skip_names:
                continue
            if d.name.startswith("."):
                continue
            # 检查 .job_state.json
            state = _load_state(str(d))
            if not state:
                continue
            job_id = state.get("id")
            if not job_id:
                continue
            if job_id in _jobs:
                continue
            _jobs[job_id] = state
            status = state.get("status", "unknown")
            if status in ("running", "queued", "cancelling"):
                state["status"] = "interrupted"
                state["error"] = "服务器重启中断"
                _save_state(job_id)
                status = "interrupted"
            recovered += 1
            print(f"[RECOVER] job={job_id} status={status} dir={d.name}")
    return recovered


# ==============================================================================
# 后台 worker
# ==============================================================================

def _generate_job_id() -> str:
    return f"job_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def _build_cfg_from_request(config: dict) -> dict:
    """Build complete CONFIG dict from user request + defaults"""
    from lighting_engine.core.config import CONFIG
    cfg = dict(CONFIG)  # shallow copy
    cfg["input_folders"] = config.get("input_folders") or config.get("input_dir")
    if isinstance(cfg["input_folders"], str):
        cfg["input_folders"] = [cfg["input_folders"]]
    cfg["output_folder"] = config.get("output_folder") or config.get("output_dir")
    # Override with explicit fields
    if "feature_groups" in config:
        cfg["feature_groups"] = {**CONFIG["feature_groups"], **config["feature_groups"]}
    for k in ["umap_neighbors", "cluster_size_ratio", "color_weight", "metric",
              "umap_min_dist", "min_samples_ratio", "max_size", "num_workers", "device"]:
        if k in config and config[k] is not None:
            cfg[k] = config[k]
    # Pass run_config clustering params to pipeline config (P11-002)
    run_config = config.get("run_config", {})
    if isinstance(run_config, dict):
        clustering = run_config.get("clustering", {})
        if isinstance(clustering, dict):
            if "feature_weights" in clustering:
                cfg["feature_weights"] = clustering["feature_weights"]
            umap = clustering.get("umap", {})
            if isinstance(umap, dict):
                if "n_neighbors" in umap:
                    cfg["umap_neighbors"] = umap["n_neighbors"]
                if "min_dist" in umap:
                    cfg["umap_min_dist"] = umap["min_dist"]
            hdbscan = clustering.get("hdbscan", {})
            if isinstance(hdbscan, dict):
                if "min_cluster_size" in hdbscan:
                    cfg["min_cluster_size"] = hdbscan["min_cluster_size"]
                if "min_samples" in hdbscan and hdbscan["min_samples"] is not None:
                    cfg["min_samples"] = hdbscan["min_samples"]
                if "cluster_selection_method" in hdbscan:
                    cfg["cluster_selection_method"] = hdbscan["cluster_selection_method"]
    return cfg


def _background_worker(job_id: str, config: dict):
    """Run pipeline in background, with logging + persistence"""
    try:
        cfg = _build_cfg_from_request(config)
        input_folders = cfg["input_folders"]
        output_folder = cfg["output_folder"]
        Path(output_folder).mkdir(parents=True, exist_ok=True)

        state = _jobs.get(job_id)
        if state:
            state["status"] = "running"
            state["updated_at"] = datetime.now().isoformat()
            _save_state(job_id)

        from lighting_engine.core.config import CONFIG as _CONFIG
        from lighting_engine.core.pipeline import run_pipeline
        result = run_pipeline(
            input_folders=input_folders,
            output_folder=output_folder,
            feature_groups=cfg["feature_groups"],
            progress_callback=lambda stage, progress, message="": _put_stage_event(job_id, stage, progress, message),
            umap_neighbors=cfg.get("umap_neighbors", 50),
            cluster_size_ratio=cfg.get("cluster_size_ratio", _CONFIG["cluster_size_ratio"]),
            new_structure=True,
        )
        _put_stage_event(job_id, "output", 1.0, "Outputs written")

        # Write run_config.json (P11-002) — new structure
        state = _jobs.get(job_id)
        if state and state.get("run_config"):
            import json as _json
            from light_analysis_engine.workspace import WorkspaceLayout
            layout = WorkspaceLayout.from_output_root(output_folder)
            layout.ensure_runtime_dirs()
            rc_path = layout.run_config_path
            try:
                with open(rc_path, "w", encoding="utf-8") as f:
                    _json.dump(state["run_config"], f, indent=2, ensure_ascii=False)
            except OSError:
                _put_event(job_id, "log", {"message": "Failed to write run_config.json", "level": "warning"})

        # Mark completed
        state = _jobs.get(job_id)
        if state:
            state["status"] = "completed"
            state["completed_at"] = datetime.now().isoformat()
            state["result_summary"] = {
                "total_images": len(result.get("filenames", [])),
                "clusters": result.get("n_clusters", 0),
                "noise_count": result.get("noise_count", 0),
                "feature_dim": result.get("feature_dim"),
                "silhouette": result.get("quality", {}).get("silhouette_score"),
            }
            _save_state(job_id)

        _put_event(job_id, "complete", {
            "job_id": job_id,
            "output_folder": output_folder,
            "total_images": len(result.get("filenames", [])),
            "clusters": result.get("n_clusters", 0),
        })
        _put_event(job_id, "done", {})

    except InterruptedError:
        state = _jobs.get(job_id)
        if state:
            state["status"] = "cancelled"
            _save_state(job_id)
        _put_event(job_id, "log", {"message": "用户取消", "level": "warning"})
        _put_event(job_id, "done", {"cancelled": True})

    except Exception as e:
        tb = traceback.format_exc()
        _put_event(job_id, "log", {"message": f"错误: {e}", "level": "error"})
        _put_event(job_id, "log", {"message": tb, "level": "error"})
        _put_event(job_id, "failed", {"message": str(e), "traceback": tb})
        state = _jobs.get(job_id)
        if state:
            state["status"] = "failed"
            state["error"] = str(e)
            state["traceback"] = tb
            _save_state(job_id)
    finally:
        # Close SSE queue
        q = _event_queues.get(job_id)
        if q:
            try:
                # Signal close
                pass
            except Exception:
                pass


# ==============================================================================
# Schema discovery
# ==============================================================================

def get_config_schema() -> dict:
    """动态读取 config.py，返回完整 schema"""
    from lighting_engine.core.config import CONFIG
    schema = {
        "presets": ["full", "lighting", "color", "geometry", "custom"],
        "feature_groups": {},
        "params": {
            "umap_neighbors": {
                "type": "int", "min": 5, "max": 200, "default": 50,
                "label": "UMAP 邻居数", "description": "越小越关注局部结构"
            },
            "cluster_size_ratio": {
                "type": "float", "min": 0.005, "max": 0.1, "default": CONFIG["cluster_size_ratio"], "step": 0.005,
                "label": "最小簇比例", "description": "占总图片数的比例"
            },
            "color_weight": {
                "type": "float", "min": 0.0, "max": 2.0, "default": 1.0, "step": 0.1,
                "label": "颜色权重", "description": "颜色特征权重"
            },
            "umap_min_dist": {
                "type": "float", "min": 0.0, "max": 0.5, "default": 0.05, "step": 0.01,
                "label": "UMAP min_dist", "description": "簇内紧凑度"
            },
            "min_samples_ratio": {
                "type": "float", "min": 0.05, "max": 1.0, "default": 0.3, "step": 0.05,
                "label": "min_samples 比例", "description": "HDBSCAN 核心点比例"
            },
            "max_size": {
                "type": "int", "min": 256, "max": 2048, "default": 1024, "step": 64,
                "label": "图片最大边", "description": "预处理缩放"
            },
            "num_workers": {
                "type": "int", "min": 1, "max": 16, "default": 4,
                "label": "并行 workers"
            },
        }
    }
    # Feature groups
    for name, conf in CONFIG["feature_groups"].items():
        schema["feature_groups"][name] = {
            "enabled": conf.get("enabled", True),
            "dims": conf.get("dims", 0),
            "weight": conf.get("weight", 1.0),
            "cluster": conf.get("cluster", True),
            "label": conf.get("label", name),
        }
    return schema


# ==============================================================================
# Pydantic models
# ==============================================================================

class JobSubmit(BaseModel):
    """Job submission - accepts any config"""
    input_folders: list[str] = Field(..., min_length=1, description="输入文件夹列表")
    output_folder: str = Field(..., description="输出目录")
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, description="自定义配置（可覆盖任何参数）")
    # 顶层常用字段（方便直接传）
    umap_neighbors: Optional[int] = None
    cluster_size_ratio: Optional[float] = None
    color_weight: Optional[float] = None


# ─── Default run_config (balanced) ──────────────────────────────────────────

_DEFAULT_FEATURE_KEYS = [
    "brightness_mean", "brightness_std", "brightness_p10", "brightness_p90", "brightness_skewness",
    "contrast", "highlight_threshold", "edge_strength_mean", "edge_strength_std",
    "warm_cool_bias", "saturation_mean", "saturation_std", "warm_cool_bias_weighted",
    "low_saturation_ratio", "high_saturation_ratio", "dominant_hue_strength",
]

def _default_run_config(input_folders: list[str]) -> dict:
    return {
        "version": 1,
        "clustering_preset_id": "balanced",
        "clustering": {
            "feature_weights": {k: 1.0 for k in _DEFAULT_FEATURE_KEYS},
            "umap": {"n_neighbors": 15, "min_dist": 0.1},
            "hdbscan": {"min_cluster_size": 6, "min_samples": 3, "cluster_selection_method": "eom"},
            "postprocess": {"min_cluster_images": 3, "max_noise_ratio": 0.3},
        },
        "analysis_channels": {
            "basic_metadata": True, "histogram": True,
            "quality_edge": True, "duplicate_detection": True,
        },
        "output": {"generate_thumbnails": True, "thumbnail_long_edge": 384, "write_run_config": True},
    }


def _normalize_run_config(config: dict, input_folders: list[str]) -> dict:
    """Normalize and validate run_config. Return merged config with defaults."""
    if not config or not isinstance(config, dict):
        return _default_run_config(input_folders)

    defaults = _default_run_config(input_folders)
    merged = dict(defaults)

    # Merge top-level fields
    for key in ("version", "clustering_preset_id", "output"):
        if key in config:
            merged[key] = config[key]
    if "clustering" in config and isinstance(config["clustering"], dict):
        for sub_key in ("umap", "hdbscan", "postprocess", "feature_weights"):
            if sub_key in config["clustering"] and config["clustering"][sub_key] is not None:
                merged["clustering"][sub_key] = config["clustering"][sub_key]
    if "analysis_channels" in config and isinstance(config["analysis_channels"], dict):
        merged["analysis_channels"] = config["analysis_channels"]

    # Validate feature_weights keys
    fw = merged.get("clustering", {}).get("feature_weights", {})
    if fw:
        unknown = [k for k in fw if k not in _DEFAULT_FEATURE_KEYS]
        if unknown:
            raise HTTPException(400, f"Unknown feature keys in feature_weights: {unknown}. "
                                      f"Valid keys: {_DEFAULT_FEATURE_KEYS}")

    return merged


class ScanFolderRequest(BaseModel):
    path: str


# ==============================================================================
# Endpoints
# ==============================================================================

@router.get("/schema")
async def get_schema():
    """Get dynamic config schema for form building"""
    return get_config_schema()


@router.post("/scan-folder")
async def scan_folder(req: ScanFolderRequest):
    """Scan a folder and return image count + format list"""
    p = Path(req.path)
    if not p.exists():
        return {"ok": False, "message": f"路径不存在: {req.path}"}
    if not p.is_dir():
        return {"ok": False, "message": f"不是目录: {req.path}"}
    formats = {".webp", ".jpg", ".jpeg", ".png", ".bmp"}
    files = []
    for f in p.rglob("*") if p.is_dir() else [p]:
        if f.is_file() and f.suffix.lower() in formats:
            files.append(f)
    return {
        "ok": True,
        "image_count": len(files),
        "formats": sorted(formats),
        "sample_files": [str(f.relative_to(p)) for f in files[:5]]
    }


@router.post("")
async def submit_job(req: JobSubmit):
    """Submit a new analysis job"""
    job_id = _generate_job_id()

    # Merge config
    config = dict(req.config or {})
    config["input_folders"] = req.input_folders
    config["output_folder"] = req.output_folder
    if req.umap_neighbors is not None: config["umap_neighbors"] = req.umap_neighbors
    if req.cluster_size_ratio is not None: config["cluster_size_ratio"] = req.cluster_size_ratio
    if req.color_weight is not None: config["color_weight"] = req.color_weight

    # Normalize run_config (P11-002)
    raw_run_config = config.get("run_config", {})
    if isinstance(raw_run_config, dict):
        run_config = _normalize_run_config(raw_run_config, req.input_folders)
    else:
        run_config = _default_run_config(req.input_folders)
    config["run_config"] = run_config

    # Log preset info
    preset_id = run_config.get("clustering_preset_id", "balanced")

    _jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "created_at": datetime.now().isoformat(),
        "config": config,
        "run_config": run_config,
        "clustering_preset_id": preset_id,
        "stage": "scan",
        "stage_index": 0,
        "progress": 0.0,
        "last_log": "",
    }
    try:
        from light_analysis_engine.workspace import JobManifest, WorkspaceLayout, write_job_manifest
        layout = WorkspaceLayout.from_output_root(req.output_folder)
        layout.ensure_runtime_dirs()
        write_job_manifest(layout, JobManifest(
            job_id=job_id,
            output_root=layout.output_root,
            input_roots=[Path(p).expanduser().resolve() for p in req.input_folders],
            created_at=_jobs[job_id]["created_at"],
            version="1",
            layout_version="workspace-v1",
        ))
    except Exception as e:
        print(f"[WARN] write job manifest failed for {job_id}: {e}")
    _event_queues[job_id] = asyncio.Queue()
    _cancel_flags[job_id] = threading.Event()
    _save_state(job_id)
    _log(job_id, f"Job {job_id} 提交, 配置: {preset_id}", "info")

    t = threading.Thread(target=_background_worker, args=(job_id, config), daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued", "clustering_preset": preset_id}


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Request cancellation"""
    if job_id not in _jobs:
        # Try to recover from disk
        raise HTTPException(404, f"Job not found: {job_id}")
    flag = _cancel_flags.get(job_id)
    if flag:
        flag.set()
    state = _jobs[job_id]
    state["status"] = "cancelling"
    _save_state(job_id)
    return {"ok": True, "message": "已请求取消"}


@router.post("/{job_id}/restart")
async def restart_job(job_id: str):
    """Restart a failed/cancelled/completed job"""
    state = _jobs.get(job_id) or _find_job_on_disk(job_id)
    if not state:
        raise HTTPException(404, f"Job not found: {job_id}")
    if job_id not in _jobs:
        _jobs[job_id] = state

    cfg = state.get("config", {})
    # Re-launch
    state["status"] = "queued"
    state["stage"] = "scan"
    state["progress"] = 0.0
    state["last_log"] = ""
    state["error"] = None
    state["result_summary"] = None
    _event_queues[job_id] = asyncio.Queue()
    _cancel_flags[job_id] = threading.Event()
    _save_state(job_id)
    _log(job_id, f"Job {job_id} 重新启动", "info")
    t = threading.Thread(target=_background_worker, args=(job_id, cfg), daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued"}


def _find_job_on_disk(job_id: str) -> Optional[dict]:
    """在磁盘上找 job state（多根扫描）"""
    roots = [_PROJECT_ROOT, _PROJECT_ROOT.parent]
    for root in roots:
        for d in root.iterdir():
            if not d.is_dir():
                continue
            if d.name.startswith("."):
                continue
            if d.name in {"studio", "lighting_engine", "docs", "tests", "node_modules",
                         ".git", "__pycache__", "depth-anything-3", "DA3Small",
                         "exports", "lighting_outputs", ".cache", "backup",
                         "Pictures", "Documents", "Downloads", "Desktop",
                         "AppData", "Program Files", "venv", ".venv", "env"}:
                continue
            loaded = _load_state(str(d))
            if loaded and loaded.get("id") == job_id:
                return loaded
    return None


@router.get("")
async def list_jobs(include_disk: bool = True):
    """List all known jobs (in-memory + from disk)"""
    jobs = list(_jobs.values())
    if include_disk:
        # Scan for dirs with state
        seen = {j["id"] for j in jobs}
        skip = {"studio", "lighting_engine", "docs", "tests", "node_modules",
                ".git", "__pycache__", "depth-anything-3", "DA3Small",
                "exports", "lighting_outputs", ".cache", "backup"}
        for d in _PROJECT_ROOT.iterdir():
            if not d.is_dir():
                continue
            if d.name in skip or d.name.startswith("test_"):
                continue
            loaded = _load_state(str(d))
            if loaded and loaded.get("id") not in seen:
                jobs.append(loaded)
                seen.add(loaded["id"])
    return {"jobs": [
        {
            "id": j["id"],
            "status": j.get("status", "unknown"),
            "created_at": j.get("created_at"),
            "completed_at": j.get("completed_at"),
            "output_folder": _get_output_dir(j),
            "stage": j.get("stage"),
            "progress": j.get("progress"),
            "error": j.get("error"),
        } for j in sorted(jobs, key=lambda x: x.get("created_at", ""), reverse=True)
    ]}


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Get job status (always available, even after server restart)"""
    state = _jobs.get(job_id)
    if not state:
        state = _find_job_on_disk(job_id)
        if state:
            _jobs[job_id] = state  # cache in memory
    if not state:
        raise HTTPException(404, f"Job not found: {job_id}")
    return state


@router.get("/{job_id}/manifest")
async def get_job_manifest(job_id: str):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).manifest_json()


@router.get("/{job_id}/images")
async def get_job_images(job_id: str, size: int = Query(384, ge=64, le=2048)):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).images_json(size=size)


@router.get("/{job_id}/images/{image_id}/meta")
async def get_job_image_meta(job_id: str, image_id: str, size: int = Query(384, ge=64, le=2048)):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).media.get_image_ref(image_id, size=size).to_json()


@router.get("/{job_id}/images/{image_id}/thumbnail")
async def get_job_image_thumbnail(job_id: str, image_id: str, size: int = Query(384, ge=64, le=2048)):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).media.get_thumbnail_response(image_id, size=size)


@router.get("/{job_id}/images/{image_id}/original")
async def get_job_image_original(job_id: str, image_id: str):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).media.get_original_response(image_id)


@router.get("/{job_id}/clusters")
async def get_job_clusters(job_id: str, size: int = Query(384, ge=64, le=2048)):
    from light_analysis_engine.workspace import get_workspace_runtime
    return get_workspace_runtime(job_id).clusters_json(size=size)


@router.post("/{job_id}/exports")
async def create_job_export(job_id: str, body: dict):
    from light_analysis_engine.workspace import ExportRequest, get_workspace_runtime
    runtime = get_workspace_runtime(job_id)
    result = runtime.exports.export_images(ExportRequest(
        image_ids=[str(v) for v in (body.get("image_ids") or []) if v],
        folder_name=body.get("folder_name") or body.get("export_name") or "export",
        rename_mode=body.get("rename_mode") or "keep_original",
        skip_duplicates=bool(body.get("skip_duplicates", False)),
    ))
    return result.__dict__


@router.get("/{job_id}/log")
async def get_log(job_id: str, offset: int = Query(0, ge=0),
                 limit: int = Query(1000, ge=1, le=10000)):
    """Read log file with offset. Used for reconnecting clients."""
    state = _jobs.get(job_id) or _find_job_on_disk(job_id)
    if not state:
        raise HTTPException(404, f"Job not found: {job_id}")
    out = _get_output_dir(state)
    if not out:
        return {"lines": [], "offset": offset, "has_more": False, "total": 0}
    log_path = _job_log_path(out)
    if not log_path.exists():
        return {"lines": [], "offset": offset, "has_more": False, "total": 0}
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(offset)
            chunk = f.read(limit * 200)  # rough char count
            lines = chunk.split("\n")[:limit]
            new_offset = offset + len(chunk.encode("utf-8"))
            # Check if more
            more_chunk = f.read(1)
            has_more = bool(more_chunk)
        return {"lines": lines, "offset": new_offset, "has_more": has_more}
    except Exception as e:
        raise HTTPException(500, f"Read log failed: {e}")


@router.get("/{job_id}/events")
async def stream_events(job_id: str, since_offset: int = Query(0, ge=0)):
    """SSE for live progress. If job already completed, returns all cached events first."""
    state = _jobs.get(job_id) or _find_job_on_disk(job_id)
    if not state:
        raise HTTPException(404, f"Job not found: {job_id}")
    if job_id not in _jobs:
        _jobs[job_id] = state  # cache in memory

    # If job already finished, send the final state and close
    if state.get("status") in ("completed", "failed", "cancelled", "interrupted"):
        async def completed_stream():
            data = json.dumps({
                "stage": state.get("stage", "output"),
                "stage_index": state.get("stage_index", 7),
                "stage_total": len(STAGES),
                "progress": 1.0 if state["status"] == "completed" else state.get("progress", 0),
            }, ensure_ascii=False)
            yield f"event: progress\ndata: {data}\n\n"
            done_data = json.dumps({
                "job_id": job_id,
                "output_folder": _get_output_dir(state),
                "status": state["status"]
            }, ensure_ascii=False)
            yield f"event: done\ndata: {done_data}\n\n"
        return StreamingResponse(completed_stream(), media_type="text/event-stream")

    # Active job - stream from queue
    q = _event_queues.get(job_id)
    if not q:
        q = asyncio.Queue()
        _event_queues[job_id] = q

    async def event_stream():
        try:
            # First send any backlog
            if since_offset > 0:
                out = _get_output_dir(state)
                if out:
                    log_path = _job_log_path(out)
                    if log_path.exists():
                        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                            f.seek(since_offset)
                            data = f.read()
                            if data:
                                for line in data.split("\n"):
                                    if line.strip():
                                        yield f"event: log\ndata: {json.dumps({'message': line, 'level': 'info'}, ensure_ascii=False)}\n\n"

            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=30)
                except asyncio.TimeoutError:
                    yield f": keepalive\n\n"
                    continue
                data_str = json.dumps(ev["data"], ensure_ascii=False, default=str)
                yield f"event: {ev['event']}\ndata: {data_str}\n\n"
                if ev["event"] in ("done", "error"):
                    break
        finally:
            pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# 启动时恢复 jobs（在模块加载时执行）
try:
    recovered = _recover_jobs_on_startup()
    if recovered:
        print(f"[RECOVER] Recovered {recovered} jobs from disk on startup")
except Exception as e:
    print(f"[WARN] Startup recovery failed: {e}")
