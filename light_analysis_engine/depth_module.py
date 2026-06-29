"""DA3 深度推理封装 + 深度特征计算 — Light Analysis Engine v3"""

import logging
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
import torch
from tqdm import tqdm

from .config import CONFIG

logger = logging.getLogger("LightAnalysisEngine")


def _load_da3_model():
    """延迟加载 DA3 模型（单例）"""
    from depth_anything_3.api import DepthAnything3

    device = torch.device(CONFIG["device"] if torch.cuda.is_available() else "cpu")
    model_path = CONFIG["model_path"]

    logger.info(f"加载 DA3 模型: {model_path} (device={device})")
    model = DepthAnything3.from_pretrained(model_path)
    model = model.to(device=device)
    model.eval()
    return model, device


# 模型缓存（全局单例）
_model_cache = None
_device_cache = None


def get_da3_model():
    global _model_cache, _device_cache
    if _model_cache is None:
        _model_cache, _device_cache = _load_da3_model()
    return _model_cache, _device_cache


def infer_depth_batch(image_paths: List[str],
                      batch_size: int = 8) -> Tuple[List[np.ndarray], List[np.ndarray]]:
    """
    DA3 batch 推理
    返回 (depth_maps, conf_maps) 列表
    """
    model, device = get_da3_model()
    depths: List[np.ndarray] = []
    confs: List[np.ndarray] = []

    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i:i + batch_size]
        try:
            prediction = model.inference(batch_paths)
            for j in range(len(batch_paths)):
                depths.append(prediction.depth[j])
                confs.append(prediction.conf[j])
        except RuntimeError as e:
            if "out of memory" in str(e).lower():
                torch.cuda.empty_cache()
                logger.warning(f"OOM at batch {i}, 尝试单张推理...")
                for p in batch_paths:
                    pred = model.inference([p])
                    depths.append(pred.depth[0])
                    confs.append(pred.conf[0])
            else:
                raise e

    return depths, confs


def extract_depth_features(
    depth_map: np.ndarray,
    conf_map: np.ndarray
) -> np.ndarray:
    """
    深度特征（3维）
    """
    depth_mean = float(np.mean(depth_map))
    depth_variance = float(np.var(depth_map))
    depth_confidence_mean = float(np.mean(conf_map))

    return np.array([
        depth_mean,
        depth_variance,
        depth_confidence_mean,
    ], dtype=np.float32)


def find_depth_files(input_dir: str) -> List[Tuple[str, str]]:
    """
    从 _depth 子目录查找已有深度图，返回 [(原图文件名, 深度图路径)]
    按原图名匹配: xxx_depth.png 对应 xxx.jpg/png/webp
    """
    depth_dir = Path(input_dir) / CONFIG["fallback_depth_dir"]
    if not depth_dir.is_dir():
        logger.warning(f"深度图目录不存在: {depth_dir}")
        return []

    valid_ext = {".png", ".jpg", ".jpeg"}
    depth_files = {}
    for f in depth_dir.iterdir():
        if f.suffix.lower() in valid_ext:
            # 去掉 _depth 后缀
            name = f.stem
            if name.endswith("_depth"):
                orig_name = name[:-6]
                depth_files[orig_name] = str(f)

    # 与原图列表匹配
    input_root = Path(input_dir)
    result = []
    for f in sorted(input_root.iterdir()):
        if f.suffix.lower() in CONFIG["valid_extensions"]:
            stem = f.stem
            if stem in depth_files:
                result.append((f.name, depth_files[stem]))
    return result


def load_depth_map(path: str) -> Optional[np.ndarray]:
    """加载已生成的深度图（灰度 PNG），支持中文路径"""
    try:
        depth = cv2.imdecode(
            np.fromfile(path, dtype=np.uint8),
            cv2.IMREAD_GRAYSCALE
        )
        if depth is None:
            return None
        depth = depth.astype(np.float32) / 255.0
        return depth
    except Exception as e:
        logger.warning(f"加载深度图失败 {path}: {e}")
        return None


def compute_depth_features_from_files(
    input_dir: str,
    filenames: List[str]
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    从已有的深度图文件计算深度特征 + 耦合特征所需数据
    返回 (depth_features [Nx3], depth_maps [N], missing_filenames)
    """
    depth_dir = Path(input_dir) / CONFIG["fallback_depth_dir"]
    n = len(filenames)
    depth_features = np.zeros((n, 3), dtype=np.float32)
    depth_maps = [None] * n
    missing = []

    for i, fname in enumerate(filenames):
        stem = Path(fname).stem
        depth_path = depth_dir / f"{stem}_depth.png"
        if depth_path.is_file():
            depth = load_depth_map(str(depth_path))
            if depth is not None:
                depth_maps[i] = depth
                depth_features[i] = extract_depth_features(depth, np.ones_like(depth))
                continue
        missing.append(fname)

    return depth_features, depth_maps, missing
