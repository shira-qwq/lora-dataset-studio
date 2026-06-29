"""版本化缓存系统 — v4

.cache/
  ├── meta.json               # 版本、特征组、模型信息
  ├── {image_hash}.npz        # 单图缓存（非深度特征）
  └── v4_depth_{model}_{dim}d/ # 深度特征缓存
"""

import json
import logging
import hashlib
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from .config import CONFIG

logger = logging.getLogger("LightingEngine")


def _cache_dir() -> Path:
    return Path(CONFIG["cache_dir"])


def _meta_path() -> Path:
    return _cache_dir() / "meta.json"


def _hash_image(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()[:16]


def _get_meta() -> dict:
    meta_path = _meta_path()
    if meta_path.is_file():
        try:
            return json.loads(meta_path.read_text())
        except Exception:
            pass
    return {}


def _save_meta(meta: dict):
    _cache_dir().mkdir(parents=True, exist_ok=True)
    _meta_path().write_text(json.dumps(meta, indent=2, ensure_ascii=False))


def check_cache_valid(feature_groups: Dict) -> bool:
    """检查缓存版本是否匹配当前配置"""
    meta = _get_meta()
    if not meta:
        return False

    if meta.get("version") != "v4":
        return False

    expected = {k: v["enabled"] for k, v in feature_groups.items()}
    cached = meta.get("feature_groups", {})
    if expected != cached:
        return False

    logger.info("缓存版本匹配，启用断点续传")
    return True


def init_meta(feature_groups: Dict):
    """初始化/更新缓存 meta"""
    meta = {
        "version": "v4",
        "feature_dim": sum(g["dims"] for g in feature_groups.values() if g["enabled"]),
        "feature_groups": {k: v["enabled"] for k, v in feature_groups.items()},
        "hash_algo": "sha256",
    }
    _save_meta(meta)
    logger.info(f"缓存 meta 已初始化: {_meta_path()}")


def load_cached_features(filenames: List[str],
                         image_data: Dict[str, bytes]) -> Optional[np.ndarray]:
    """尝试从缓存加载特征"""
    meta = _get_meta()
    if not meta:
        return None

    dim = meta.get("feature_dim", 0)
    if dim == 0:
        return None

    cache_dir = _cache_dir()
    features_list = []
    all_cached = True

    for fname in filenames:
        h = _hash_image(image_data.get(fname, b""))
        npz_path = cache_dir / f"{h}.npz"
        if npz_path.is_file():
            try:
                data = np.load(str(npz_path))
                features_list.append(data["features"])
                continue
            except Exception:
                pass
        all_cached = False
        break

    if all_cached and len(features_list) == len(filenames):
        logger.info(f"从缓存加载 {len(filenames)} 张特征")
        return np.stack(features_list)
    return None


def save_features_cache(filenames: List[str],
                        image_data: Dict[str, bytes],
                        features: np.ndarray):
    """保存特征到缓存"""
    cache_dir = _cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    for i, fname in enumerate(filenames):
        h = _hash_image(image_data.get(fname, b""))
        npz_path = cache_dir / f"{h}.npz"
        if not npz_path.exists():
            np.savez_compressed(str(npz_path), features=features[i])
            saved += 1
    if saved:
        logger.info(f"缓存保存: {saved} 张")
