"""预处理模块 — 图片读取、resize、清洗 — v4"""

import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Tuple

import cv2
import numpy as np
from tqdm import tqdm

from .config import CONFIG

logger = logging.getLogger("LightingEngine")


def is_valid_image(path: Path) -> bool:
    ext = path.suffix.lower()
    if ext not in CONFIG["valid_extensions"]:
        return False
    if not path.is_file() or path.stat().st_size < 100:
        return False
    return True


def find_images(folder_list: List[str], recursive: bool = True) -> List[Path]:
    """扫描多个输入文件夹，返回去重排序后的图片路径列表

    recursive=True: 递归扫描子目录（默认）
    """
    seen = set()
    images: List[Path] = []
    for folder in folder_list:
        root = Path(folder)
        if not root.is_dir():
            logger.warning(f"目录不存在，跳过: {folder}")
            continue
        iterator = sorted(root.rglob('*') if recursive else root.iterdir())
        for p in iterator:
            if not p.is_file():
                continue
            if p.suffix.lower() in CONFIG["valid_extensions"] and is_valid_image(p):
                if p.resolve() not in seen:
                    seen.add(p.resolve())
                    images.append(p)
    logger.info(f"发现 {len(images)} 张有效图片 (来自 {len(folder_list)} 个文件夹, recursive={recursive})")
    return images


def load_and_resize(path: Path, max_size: int = 1024) -> Optional[np.ndarray]:
    """读取图片 → RGB → float32(0~1) → 保持比例缩放最长边"""
    try:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8),
                           cv2.IMREAD_COLOR)
        if img is None:
            logger.warning(f"损坏图片: {path.name}")
            return None
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        h, w = img.shape[:2]
        scale = max_size / max(h, w)
        if scale < 1.0:
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        img = img.astype(np.float32) / 255.0
        return img
    except Exception as e:
        logger.warning(f"读取失败 {path.name}: {e}")
        return None


def preprocess_single(path: Path) -> Optional[Tuple[str, np.ndarray]]:
    img = load_and_resize(path)
    if img is None:
        return None
    return path.name, img


def preprocess_all(image_paths: List[Path],
                   max_workers: int = 4) -> List[Tuple[str, np.ndarray]]:
    """多进程并行预处理"""
    results: List[Tuple[str, np.ndarray]] = []
    failed = 0

    if max_workers <= 1:
        for p in tqdm(image_paths, desc="Preprocess", unit="img"):
            res = preprocess_single(p)
            if res is not None:
                results.append(res)
            else:
                failed += 1
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(preprocess_single, p): p for p in image_paths}
            for f in tqdm(as_completed(futures), total=len(futures),
                          desc="Preprocess", unit="img"):
                try:
                    res = f.result()
                except Exception as e:
                    logger.warning(f"棰勫鐞嗕换鍔″け璐? {futures[f].name}: {e}")
                    failed += 1
                    continue
                if res is not None:
                    results.append(res)
                else:
                    failed += 1

    name_order = {p.name: i for i, p in enumerate(image_paths)}
    results.sort(key=lambda x: name_order.get(x[0], 999999))

    if failed:
        logger.warning(f"预处理失败 {failed} 张")
    logger.info(f"预处理完成: {len(results)} 张")
    return results
