#!/usr/bin/env python3
"""GUI 入口 — Intrinsic Lighting Embedding Engine v4

用法:
    python -m lighting_engine.gui_main
    或直接双击本文件 (需 python.exe 关联 .py 文件)
"""

import sys
import os
from pathlib import Path


# 确保项目根目录在 sys.path（兼容双击运行、python -m 两种方式）
_project_root = Path(__file__).resolve().parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))
os.chdir(str(_project_root))  # 确保工作目录是项目根

from PyQt6.QtWidgets import QApplication
from lighting_engine.gui.main_window import MainWindow
from lighting_engine.utils.utils import setup_logging


def main():
    # 先初始化 logging（文件）
    log_dir = _project_root / "lighting_outputs"
    log_dir.mkdir(parents=True, exist_ok=True)
    setup_logging(str(log_dir / "debug_logs.txt"))

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    win = MainWindow()
    win.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
