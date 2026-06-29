"""
path_resolver — 统一 output_root 路径解析

所有 router 不得自己拼路径。必须通过此模块解析。

输出目录结构：
  <output_root>/
    exports/<export_name>/         # 用户导出图片（只放图片）
    _studio/                       # 软件内部分析数据
      features/                    #   特征 CSV
      clustering/                  #   聚类数据
      inspection/                  #   巡检数据
      export_records/              #   导出记录 manifest（不放在 exports/ 下）
      logs/                        #   运行日志
      reports/                     #   内部报告
    _cache/thumbnails/             # 缩略图缓存（可删除）
    reports/                       # 用户主动生成的报告
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("path_resolver")

# ============================================================
# output_root 解析
# ============================================================

# 项目根（用于旧路径 fallback）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _get_job_state(job_id: str) -> Optional[dict]:
    """从 jobs.py 内存状态或磁盘读取 job state"""
    try:
        import studio.api.routers.jobs as jobs_mod
        state = jobs_mod._jobs.get(job_id)
        if state:
            return state
    except Exception:
        pass
    # 磁盘扫描
    for root in [_PROJECT_ROOT, _PROJECT_ROOT.parent]:
        for d in root.iterdir():
            if not d.is_dir():
                continue
            state_path = d / ".job_state.json"
            if state_path.exists():
                try:
                    with open(state_path, encoding="utf-8") as f:
                        loaded = json.load(f)
                    if loaded.get("id") == job_id:
                        return loaded
                except Exception:
                    continue
    return None


def _get_output_folder_from_state(state: dict) -> Optional[str]:
    """从 state 中提取 output_folder"""
    if not state:
        return None
    cfg = state.get("config", {})
    return cfg.get("output_folder") or state.get("output_folder")


def resolve_output_root(job_id: str) -> Optional[Path]:
    """解析 job 的 output_root（输出目录根）"""
    state = _get_job_state(job_id)
    if not state:
        return None
    out = _get_output_folder_from_state(state)
    if out:
        return Path(out).resolve()
    return None


def resolve_job_dir(job_id: str) -> Optional[Path]:
    """解析 job 输出目录（兼容旧结构，返回 output_root）"""
    output_root = resolve_output_root(job_id)
    if output_root:
        return output_root
    # 旧结构 fallback: 项目根下直接以 job_id 命名的目录
    for root in [_PROJECT_ROOT, _PROJECT_ROOT.parent]:
        for suffix in ["", "_output_v7", "_output_v6", "_output"]:
            candidate = root / f"{job_id}{suffix}"
            if candidate.is_dir():
                return candidate
    return None


# ============================================================
# 内部分析数据目录 (_studio/)
# ============================================================


def resolve_internal_dir(job_id: str) -> Optional[Path]:
    """_studio/ 目录"""
    root = resolve_output_root(job_id)
    if not root:
        return None
    return root / "_studio"


def resolve_internal_file(job_id: str, filename: str) -> Optional[Path]:
    """
    解析内部分析文件，新结构优先，旧结构 fallback。

    新: <output_root>/_studio/<filename>
    旧: <output_root>/<filename>

    如果 filename 包含子路径（如 features/features.csv），先尝试完整新路径。
    """
    root = resolve_output_root(job_id)
    if not root:
        return None

    # 新结构（完整子路径）
    new_path = root / "_studio" / filename
    if new_path.exists():
        return new_path

    # 新结构（子路径简写，如 features.csv 可能就在 _studio/ 下）
    bare = Path(filename).name
    new_bare = root / "_studio" / bare
    if new_bare.exists():
        return new_bare

    # 旧结构（根目录）
    old = root / filename
    if old.exists():
        return old

    # 都不存在时，返回期望的新路径（调用方处理 404）
    return new_path


# ============================================================
# 导出目录 (exports/)
# ============================================================


def resolve_exports_dir(job_id: str) -> Optional[Path]:
    """exports/ 目录"""
    root = resolve_output_root(job_id)
    if not root:
        return None
    return root / "exports"


def resolve_export_dir(job_id: str, export_name: str) -> Optional[Path]:
    """exports/<export_name>/ 目录"""
    exports = resolve_exports_dir(job_id)
    if not exports:
        return None
    return exports / export_name


def unique_export_dir(job_id: str, export_name: str) -> Optional[Path]:
    """
    自动避免导出目录重名。
    exports/青蓝主题_top5/   → 如果已存在
    exports/青蓝主题_top5_001/
    """
    base = resolve_exports_dir(job_id)
    if not base:
        return None
    candidate = base / export_name
    if not candidate.exists():
        return candidate
    for i in range(1, 1000):
        candidate = base / f"{export_name}_{i:03d}"
        if not candidate.exists():
            return candidate
    return base / f"{export_name}_{999:03d}"


# ============================================================
# 导出记录目录 (_studio/export_records/)
# ============================================================


def resolve_export_records_dir(job_id: str) -> Optional[Path]:
    """_studio/export_records/ 目录"""
    internal = resolve_internal_dir(job_id)
    if not internal:
        return None
    return internal / "export_records"


# ============================================================
# 缓存目录 (_cache/)
# ============================================================


def resolve_cache_dir(job_id: str) -> Optional[Path]:
    """_cache/ 目录"""
    root = resolve_output_root(job_id)
    if not root:
        return None
    return root / "_cache"


def resolve_thumbnail_dir(job_id: str, size: int = 256) -> Optional[Path]:
    """
    缩略图缓存目录。
    新: <output_root>/_cache/thumbnails/<size>/
    旧: <output_root>/thumbnails/<size>/
        <output_root>/thumbnails/<stem>.jpg (旧平铺)
    """
    root = resolve_output_root(job_id)
    if not root:
        return None

    new_dir = root / "_cache" / "thumbnails" / str(size)
    if new_dir.exists():
        return new_dir

    old_dir = root / "thumbnails" / str(size)
    if old_dir.exists():
        return old_dir

    # 都不存在时返回新路径
    return new_dir


def find_thumbnail_file(job_id: str, stem: str, size: int = 256) -> Optional[Path]:
    """
    查找缩略图文件，新结构优先。
    新: <output_root>/_cache/thumbnails/<size>/<stem>.jpg
    旧: <output_root>/thumbnails/<size>/<stem>.jpg
        <output_root>/thumbnails/<stem>.jpg (256px 预生成)
    """
    root = resolve_output_root(job_id)
    if not root:
        return None

    # 新结构
    new_path = root / "_cache" / "thumbnails" / str(size) / f"{stem}.jpg"
    if new_path.exists():
        return new_path

    # 旧结构
    old_path = root / "thumbnails" / str(size) / f"{stem}.jpg"
    if old_path.exists():
        return old_path

    # 旧平铺
    flat = root / "thumbnails" / f"{stem}.jpg"
    if flat.exists():
        return flat

    return None


# ============================================================
# 用户报告目录 (reports/)
# ============================================================


def resolve_reports_dir(job_id: str) -> Optional[Path]:
    """reports/ 目录"""
    root = resolve_output_root(job_id)
    if not root:
        return None
    return root / "reports"


# ============================================================
# 工具函数
# ============================================================


def unique_filename(dst: Path) -> Path:
    """
    自动避免文件重名。
    cat.jpg → cat_1.jpg → cat_2.jpg
    """
    if not dst.exists():
        return dst
    stem = dst.stem
    ext = dst.suffix or ""
    for i in range(1, 10000):
        candidate = dst.parent / f"{stem}_{i}{ext}"
        if not candidate.exists():
            return candidate
    return dst  # fallback


def sanitize_filename(name: str, max_len: int = 120, fallback: str = "export") -> str:
    """
    清理文件名/文件夹名：
    1. 中文、英文、数字保留
    2. 空格→单下划线
    3. 多个 _ 合并成一个
    4. 去掉首尾 _
    5. Windows 非法字符 → _
    6. 不允许 __
    """
    raw = str(name or fallback).strip() or fallback
    # Replace illegal Windows chars with _
    cleaned = "".join("_" if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in raw)
    # Space to single underscore
    cleaned = cleaned.replace(" ", "_")
    # Collapse multiple underscores
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    # Strip leading/trailing underscores
    cleaned = cleaned.strip("_")
    if not cleaned:
        return fallback
    return cleaned[:max_len]


def write_export_record(job_id: str, record: dict) -> Optional[Path]:
    """
    写入导出记录到 _studio/export_records/<export_id>.json
    """
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir:
        return None
    records_dir.mkdir(parents=True, exist_ok=True)
    export_id = record.get("export_id", "unknown")
    path = records_dir / f"{export_id}.json"
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        return path
    except OSError as e:
        logger.warning("Failed to write export record %s: %s", export_id, e)
        return None


def read_export_record(job_id: str, export_id: str) -> Optional[dict]:
    """读取导出记录"""
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir:
        return None
    path = records_dir / f"{export_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def list_export_records(job_id: str) -> list[dict]:
    """列出所有导出记录"""
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir or not records_dir.exists():
        return []
    records = []
    for p in sorted(records_dir.glob("*.json")):
        try:
            with open(p, encoding="utf-8") as f:
                records.append(json.load(f))
        except Exception:
            continue
    return records
