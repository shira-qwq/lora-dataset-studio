from __future__ import annotations

from pathlib import Path

from scripts.audit_python_deps import render_audit_report, scan_repository


def test_dependency_audit_classifies_runtime_dev_and_optional(tmp_path: Path) -> None:
    runtime_file = tmp_path / "studio" / "api" / "app.py"
    runtime_file.parent.mkdir(parents=True)
    runtime_file.write_text("import fastapi\n", encoding="utf-8")

    dev_file = tmp_path / "tests" / "test_sample.py"
    dev_file.parent.mkdir(parents=True)
    dev_file.write_text("import pytest\n", encoding="utf-8")

    optional_file = tmp_path / "tools" / "tool.py"
    optional_file.parent.mkdir(parents=True)
    optional_file.write_text("import optuna\n", encoding="utf-8")

    gui_file = tmp_path / "lighting_engine" / "gui_main.py"
    gui_file.parent.mkdir(parents=True)
    gui_file.write_text("import PyQt6\n", encoding="utf-8")

    result = scan_repository(tmp_path)
    report = render_audit_report(result, tmp_path)

    assert "fastapi" in result.runtime_sources
    assert "pytest" in result.dev_sources
    assert "optuna" in result.optional_sources
    assert "PyQt6" in result.optional_sources
    assert "DEPENDENCY_AUDIT_CN" in report

