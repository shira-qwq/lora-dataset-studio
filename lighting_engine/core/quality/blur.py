"""模糊检测 — v4.3

使用 Laplacian variance 检测模糊图。
不自动删除图片，只打 review 标记。
"""

import cv2
import numpy as np


def compute_blur_score(img_rgb: np.ndarray) -> float:
    """Compute blur score using Laplacian variance.

    Higher score = sharper image.
    Typical thresholds:
        < 60:  likely blurry
        < 100: possibly blurry
        > 200: very sharp

    Args:
        img_rgb: [H, W, 3] float32 (0~1)

    Returns:
        float Laplacian variance
    """
    img_u8 = np.clip(img_rgb * 255.0, 0, 255).astype(np.uint8)
    gray = cv2.cvtColor(img_u8, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def classify_blur(score: float, threshold: float = 60.0) -> str:
    """Classify blur level.

    Args:
        score: blur score from compute_blur_score()
        threshold: below this -> review_blurry (default 60.0)

    Returns:
        "review_blurry" or "ok"
    """
    # Do not auto-delete. Only mark for review.
    if score < threshold:
        return "review_blurry"
    return "ok"
