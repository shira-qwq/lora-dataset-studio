from __future__ import annotations

import sys
from typing import Dict, Set


RUNTIME_IMPORT_TO_PACKAGE: Dict[str, str] = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "pydantic": "pydantic",
    "numpy": "numpy",
    "pandas": "pandas",
    "sklearn": "scikit-learn",
    "umap": "umap-learn",
    "hdbscan": "hdbscan",
    "PIL": "Pillow",
    "matplotlib": "matplotlib",
    "plotly": "plotly",
    "tqdm": "tqdm",
    "scipy": "scipy",
    "cv2": "opencv-python",
    "imagehash": "imagehash",
    "torch": "torch",
}

DEV_IMPORT_TO_PACKAGE: Dict[str, str] = {
    "pytest": "pytest",
    "httpx": "httpx",
    "requests": "requests",
}

OPTIONAL_IMPORT_TO_PACKAGE: Dict[str, str] = {
    "optuna": "optuna",
    "PyQt6": "PyQt6",
}

IMPORT_TO_PACKAGE: Dict[str, str] = {
    **RUNTIME_IMPORT_TO_PACKAGE,
    **DEV_IMPORT_TO_PACKAGE,
    **OPTIONAL_IMPORT_TO_PACKAGE,
}

PROJECT_ROOT_PACKAGES: Set[str] = {
    "light_analysis_engine",
    "lighting_engine",
    "studio",
    "scripts",
    "tests",
    "tools",
}

STD_LIB_MODULES: Set[str] = set(sys.stdlib_module_names)


def package_for_import(name: str) -> str | None:
    return IMPORT_TO_PACKAGE.get(name)


def importables_for_runtime_check() -> list[str]:
    return list(RUNTIME_IMPORT_TO_PACKAGE.keys())


def optional_importables() -> list[str]:
    return list(OPTIONAL_IMPORT_TO_PACKAGE.keys())

