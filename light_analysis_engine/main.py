"""入口脚本 — Light Analysis Engine v3

用法:
    python -m light_analysis_engine.main
    或
    python light_analysis_engine/main.py
"""

import sys
import time
from pathlib import Path

# 确保项目根目录在 sys.path 中
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from light_analysis_engine.config import CONFIG
from light_analysis_engine.utils import setup_logging
from light_analysis_engine.preprocess import find_images
from light_analysis_engine.pipeline import run_pipeline
from light_analysis_engine.output_writer import write_outputs


def main():
    # ── 日志 ──
    output_dir = Path(CONFIG["output_folder"])
    output_dir.mkdir(parents=True, exist_ok=True)
    logger = setup_logging(str(output_dir / "debug_logs.txt"))
    logger.info("=" * 60)
    logger.info("Light Analysis Engine v3 — 启动")
    logger.info("=" * 60)

    # ── 参数摘要 ──
    logger.info(f"输入目录: {CONFIG['input_folder']}")
    logger.info(f"输出目录: {CONFIG['output_folder']}")
    logger.info(f"DA3 模型: {CONFIG['model_path']}")
    logger.info(f"设备: {CONFIG['device']}")
    logger.info(f"批量大小: {CONFIG['batch_size']}")

    t_start = time.time()

    try:
        # ── 查找图片 ──
        image_paths = find_images(CONFIG["input_folder"])

        # ── 运行主流程 ──
        features_16d, labels, filenames, report_extra = run_pipeline()

        # ── 写入输出 ──
        write_outputs(
            CONFIG["output_folder"],
            image_paths,
            features_16d,
            labels,
            filenames,
            report_extra,
        )

        elapsed = time.time() - t_start
        logger.info(f"✓ 全部完成！耗时 {elapsed:.1f} 秒")
        logger.info(f"  处理 {len(filenames)} 张图片 → "
                    f"{report_extra['clusters']} 簇 "
                    f"(噪点: {report_extra['noise_count']})")

    except Exception as e:
        logger.exception(f"运行失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
