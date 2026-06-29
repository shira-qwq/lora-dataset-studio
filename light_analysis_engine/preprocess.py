"""预处理模块 — 图片读取、resize、清洗 — Light Analysis Engine v3"""

import logging
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List, Optional, Tuple

import cv2
import numpy as np
from tqdm import tqdm

from .config import CONFIG
from .utils import is_valid_image

logger = logging.getLogger("LightAnalysisEngine")


def find_images(input_dir: str) -> List[Path]:
    """扫描输入文件夹，返回有效图片路径列表（排序后）"""
    root = Path(input_dir)
    if not root.is_dir():
        raise NotADirectoryError(f"输入目录不存在: {input_dir}")

    valid_ext = CONFIG["valid_extensions"]
    images = sorted([
        p for p in root.iterdir()
        if p.suffix.lower() in valid_ext and is_valid_image(p)
    ])
    logger.info(f"发现 {len(images)} 张有效图片 (来自 {input_dir})")
    return images


def load_and_resize(path: Path, max_size: int = 1024) -> Optional[np.ndarray]:
    """
    读取图片 → 统一 RGB → float32 (0~1) → 保持比例，最长边缩放到 max_size。
    返回 None 表示该图片损坏。
    """
    try:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8),
                           cv2.IMREAD_COLOR)
        if img is None:
            logger.warning(f"损坏图片 (cv2 返回 None): {path.name}")
            return None
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # 保持长宽比缩放
        h, w = img.shape[:2]
        scale = max_size / max(h, w)
        if scale < 1.0:
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        img = img.astype(np.float32) / 255.0
        return img

    except Exception as e:
        logger.warning(f"读取图片失败 {path.name}: {e}")
        return None


def preprocess_single(path: Path) -> Optional[Tuple[str, np.ndarray]]:
    """供多进程调用的单图预处理包装"""
    img = load_and_resize(path)
    if img is None:
        return None
    return path.name, img


def preprocess_all(image_paths: List[Path],
                   max_workers: int = 4) -> List[Tuple[str, np.ndarray]]:
    """多进程并行预处理所有图片"""
    results: List[Tuple[str, np.ndarray]] = []
    failed = 0

    if max_workers <= 1:
        # 单进程（调试模式）
        for p in tqdm(image_paths, desc="Preprocess", unit="img"):
            res = preprocess_single(p)
            if res is not None:
                results.append(res)
            else:
                failed += 1
    else:
        with ProcessPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(preprocess_single, p): p
                       for p in image_paths}
            for f in tqdm(as_completed(futures), total=len(futures),
                          desc="Preprocess", unit="img"):
                res = f.result()
                if res is not None:
                    results.append(res)
                else:
                    failed += 1

    # 按原始顺序排序
    name_order = {p.name: i for i, p in enumerate(image_paths)}
    results.sort(key=lambda x: name_order.get(x[0], 999999))

    if failed:
        logger.warning(f"预处理失败: {failed} 张图片")
    logger.info(f"预处理完成: {len(results)} 张图片")
    return results
