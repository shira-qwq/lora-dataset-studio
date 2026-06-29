"""WD14 tagger environment probe.

Detects whether onnxruntime (or tensorflow) is available for running
the WD14 tagger (WaifuDiffusion 14 labeler). Does NOT load or download
any model — this is a pure environment check.

Probe result is used by the plugin_channels manifest in /analysis/status.
"""

import logging

logger = logging.getLogger("WD14Probe")

# Hardcoded metadata for the WD14 tagger plugin.
# These describe the expected resource requirements when the full
# inference pipeline is set up in a future batch.
WD14_METADATA = {
    "plugin_id": "wd14_tagger",
    "name_zh": "WD14 标签器",
    "description_zh": "使用 WaifuDiffusion 14 模型自动为图片生成内容标签（人物、姿势、背景、画风等）",
    "version": "0.1.0",
    "model_size_mb": 200,
    "requires_gpu": False,
    "offline_supported": True,
    "failure_mode": "skip",
    "cache_path": None,  # Would be set when model is downloaded
}


def probe() -> dict:
    """Run environment probe for the WD14 tagger plugin.

    Checks for available ONNX/compute runtimes. Does NOT load models.

    Returns:
        dict with WD14_METADATA plus dynamic fields:
        - installed: bool  (whether onnxruntime or tensorflow is importable)
        - available: bool  (installed + runtime seems functional)
        - buildable: bool  (available = buildable for this probe)
        - buildable_note: str or None
    """
    result = dict(WD14_METADATA)

    installed = False
    available = False
    buildable_note = None

    # Check onnxruntime (preferred)
    try:
        import onnxruntime
        installed = True
        available = True
    except ImportError:
        pass

    # Fallback: check tensorflow
    if not installed:
        try:
            import tensorflow as tf  # noqa: F401
            installed = True
            available = True
        except ImportError:
            pass

    if not installed:
        buildable_note = "需安装 onnxruntime 或 tensorflow（pip install onnxruntime），可选，不影响主流程"
    else:
        buildable_note = "运行时已就绪，可构建标签通道"

    result["installed"] = installed
    result["available"] = available
    result["buildable"] = available
    result["buildable_note"] = buildable_note

    return result
