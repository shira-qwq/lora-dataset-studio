"""配置兼容层 — 自动生成/升级/迁移配置 — v5

处理场景：
1. 首次运行 → 生成默认 config_saved.json
2. 旧版 config_saved.json 缺少新字段 → 自动填入默认值
3. 旧版 config_saved.json 有过期字段 → 自动删除
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("LightingEngine")

# 完整的最新默认配置（作为迁移基准）
_LATEST_DEFAULTS = {
    "preset": "full",
    "model": "DA3-SMALL",
    "feature_groups": {},
    "umap_neighbors": 50,
    "cluster_size_ratio": 0.015,
    "cluster_granularity": 1.0,
    "plotly_mode": "3d",
    "plotly_show_thumbnails": False,
    "color_weight": 1.0,
    "output_folder": "",
}

# 已废弃的键（会在迁移时删除）
_OBSOLETE_KEYS = {
    "clip_percentile",      # v5 refactor: removed
    "scaler_type",          # v5 refactor: RobustScaler only
    "save_umap_html",       # always True
    "auto_name_clusters",   # always True
    "input_folders",        # not persisted
}

# 需要从 CONFIG 读取默认值的字段（非 GUI 保存的配置）
_CONFIG_FALLBACK_KEYS = {
    "output_folder",
}


def get_config_save_path() -> Path:
    """返回 config_saved.json 的路径"""
    return Path(__file__).resolve().parent.parent.parent / "config_saved.json"


def load_merged_config() -> Dict[str, Any]:
    """加载保存的配置，合并到最新默认值，删除过期键"""
    from ..core.config import CONFIG as core_config

    config_path = get_config_save_path()
    saved: Dict = {}

    # 读取保存的配置
    if config_path.is_file():
        try:
            saved = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"读取保存的配置失败: {e}，使用默认配置")

    # 删除过期键
    for k in _OBSOLETE_KEYS:
        saved.pop(k, None)

    # 用最新默认值填充缺失字段
    merged = dict(_LATEST_DEFAULTS)
    for k, v in saved.items():
        merged[k] = v

    # 从 core_config 补充缺失的默认值
    for k in _CONFIG_FALLBACK_KEYS:
        if k not in saved or not saved.get(k):
            merged[k] = core_config.get(k, _LATEST_DEFAULTS.get(k, ""))

    # 如果 feature_groups 为空，从 core_config 获取
    if not merged.get("feature_groups"):
        merged["feature_groups"] = _serialize_groups(core_config.get("feature_groups", {}))

    # 自动写入升级后的配置
    try:
        config_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning(f"写入升级后的配置失败: {e}")

    return merged


def save_config(config: Dict[str, Any]):
    """保存配置到文件（仅保存 GUI 可修改的字段）"""
    config_path = get_config_save_path()
    # 只保存需要的字段
    saveable = {k: v for k, v in config.items() if k in _LATEST_DEFAULTS or k == "feature_groups"}
    try:
        config_path.write_text(json.dumps(saveable, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning(f"保存配置失败: {e}")


def _serialize_groups(groups: Dict) -> Dict:
    """将 feature_groups 序列化为可保存的格式"""
    result = {}
    for name, group in groups.items():
        result[name] = {
            "enabled": group.get("enabled", True),
            "weight": group.get("weight", 1.0),
        }
    return result
