from __future__ import annotations

from pathlib import Path

from scripts import dependency_state


def test_combined_hash_changes_with_file_content(tmp_path: Path) -> None:
    first = tmp_path / "a.txt"
    second = tmp_path / "b.txt"
    first.write_text("one", encoding="utf-8")
    second.write_text("two", encoding="utf-8")

    initial = dependency_state.combined_hash([first, second])
    second.write_text("changed", encoding="utf-8")
    updated = dependency_state.combined_hash([first, second])

    assert initial != updated


def test_build_install_marker_records_existing_files(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("fastapi>=0.115.0\n", encoding="utf-8")
    (tmp_path / "requirements-dev.txt").write_text("pytest>=8.0.0\n", encoding="utf-8")
    frontend = tmp_path / "studio" / "frontend_react"
    frontend.mkdir(parents=True)
    (frontend / "package.json").write_text("{}", encoding="utf-8")
    (frontend / "package-lock.json").write_text("{}", encoding="utf-8")
    (frontend / "node_modules").mkdir()

    marker = dependency_state.build_install_marker(tmp_path, python_version="3.12.1", venv_path=".venv")

    assert marker["python_version"] == "3.12.1"
    assert marker["venv_path"] == ".venv"
    assert marker["node_modules_checked"] is True
    assert marker["requirements_files"] == ["requirements.txt", "requirements-dev.txt"]
    assert marker["package_files"] == [
        "studio/frontend_react/package.json",
        "studio/frontend_react/package-lock.json",
    ]
