"""工具函数 — Light Analysis Engine v3"""

import logging
import sys
from pathlib import Path
from typing import Optional


def setup_logging(log_path: Optional[str] = None) -> logging.Logger:
    """配置 logging：同时输出到控制台和文件"""
    logger = logging.getLogger("LightAnalysisEngine")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    # 控制台 handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # 文件 handler
    if log_path:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_path, mode="w", encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger


def is_valid_image(path: Path) -> bool:
    """快速检查文件是否为有效图片"""
    ext = path.suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
        return False
    if not path.is_file():
        return False
    # 跳过极小文件（损坏图片通常文件头残缺，但文件大小为0或极小）
    if path.stat().st_size < 100:
        return False
    return True
