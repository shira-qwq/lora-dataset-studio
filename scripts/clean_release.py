#!/usr/bin/env python3
"""
clean_release.py — 发布前一键清理脚本

扫描并清理项目目录中的本地测试痕迹、输出文件、缓存、日志和构建产物。

用法：
    python scripts/clean_release.py                  # dry-run (默认)
    python scripts/clean_release.py --dry-run         # 等同默认
    python scripts/clean_release.py --apply           # 执行清理（需输入 CLEAN 确认）
    python scripts/clean_release.py --dry-run --level safe   # safe 级别 dry-run
    python scripts/clean_release.py --apply --level full     # full 级别清理

等级：
    safe (默认):   只清理生成物（输出、缓存、日志、构建）
    full:          额外清理 node_modules、.venv 等
    review-only:   只扫描，不删除

安全：
    - 默认 dry-run，不删除任何文件
    - --apply 时需要输入 CLEAN 确认
    - 不会删除源码、README、LICENSE、.gitignore、docs/screenshots
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent


# ═══════════════════════════════════════════════════════════════════
# 清理规则定义
# ═══════════════════════════════════════════════════════════════════

# (glob_pattern, category, level) 三元组
# category: 'auto' = 自动删除, 'confirm' = 需用户确认, 'review' = 仅提示
# level: 'safe' / 'full' / 'review-only'

RULES: List[Tuple[str, str, str]] = [
    # ── 输出目录（auto / safe） ──
    ("*-output/", "auto", "safe"),
    ("*_output/", "auto", "safe"),
    ("*_outputs/", "auto", "safe"),
    ("outputs/", "auto", "safe"),
    ("output/", "auto", "safe"),
    ("exports/", "auto", "safe"),
    ("analysis_exports/", "auto", "safe"),
    ("organized_exports/", "auto", "safe"),
    ("job_outputs/", "auto", "safe"),
    ("runs/", "auto", "safe"),

    # ── 缓存（auto / safe） ──
    ("_cache/", "auto", "safe"),
    ("thumbnail_cache/", "auto", "safe"),
    ("thumbnails/", "auto", "safe"),
    (".cache/", "auto", "safe"),

    # ── 日志（auto / safe） ──
    ("*.log", "auto", "safe"),
    ("logs/", "auto", "safe"),

    # ── Python 缓存（auto / safe） ──
    ("__pycache__/", "auto", "safe"),
    (".pytest_cache/", "auto", "safe"),
    (".mypy_cache/", "auto", "safe"),
    (".ruff_cache/", "auto", "safe"),

    # ── 构建产物（auto / safe） ──
    ("dist/", "auto", "safe"),
    ("build/", "auto", "safe"),
    (".vite/", "auto", "safe"),

    # ── 运行时状态（auto / safe） ──
    (".runtime/", "auto", "safe"),

    # ── 临时文件（auto / safe） ──
    ("tmp/", "auto", "safe"),
    ("temp/", "auto", "safe"),

    # ── 依赖安装（auto / full） ──
    ("node_modules/", "auto", "full"),
    (".venv/", "auto", "full"),
    ("venv/", "auto", "full"),
    ("env/", "auto", "full"),

    # ── 敏感文件（review） ──
    (".env", "confirm", "safe"),
    (".env.local", "confirm", "safe"),
    (".env.*.local", "confirm", "safe"),
    (".env.production", "confirm", "safe"),
    (".env.development", "confirm", "safe"),
    ("*.safetensors", "confirm", "safe"),
    ("*.ckpt", "confirm", "safe"),
    ("*.pt", "confirm", "safe"),
    ("*.pth", "confirm", "safe"),
    ("*.onnx", "confirm", "safe"),

    # ── 私人数据目录（review） ──
    ("datasets/", "confirm", "safe"),
    ("data/", "confirm", "safe"),
    ("input/", "confirm", "safe"),
    ("samples/private/", "confirm", "safe"),
    ("models/", "confirm", "safe"),
    ("weights/", "confirm", "safe"),
    ("checkpoints/", "confirm", "safe"),
]

# 必须保留的路径（即使匹配规则也不删除）
KEEP = {
    ".env.example",
    "docs/screenshots",
    "README.md",
    "README.en.md",
    "LICENSE",
    ".gitignore",
}


# ═══════════════════════════════════════════════════════════════════
# 扫描逻辑
# ═══════════════════════════════════════════════════════════════════


def _should_keep(path: Path, rel: str) -> bool:
    """检查路径是否应保留"""
    # .env.example 始终保留（任何位置）
    if path.name == ".env.example":
        return True
    for keep in KEEP:
        if rel == keep or rel.startswith(keep + "/") or rel.startswith(keep + "\\"):
            return True
    # 永远不删除源码目录
    source_dirs = {"studio", "lighting_engine", "light_analysis_engine", "scripts", "tests", "tools", "docs"}
    if path.is_dir() and path.name in source_dirs:
        return True
    return False


def _is_source_file(rel: str) -> bool:
    """判断是否为源码文件"""
    source_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md", ".txt", ".bat", ".sh", ".yml", ".yaml"}
    p = Path(rel)
    if p.suffix in source_exts:
        return True
    if rel.startswith(("studio/", "lighting_engine/", "light_analysis_engine/", "scripts/", "tests/", "tools/", "docs/")):
        return True
    return False


def scan(level: str = "safe") -> Tuple[List[Path], List[Path], List[Path]]:
    """
    扫描项目目录，返回 (auto_delete, confirm_delete, review_items)
    每个元素为 Path 列表。
    """
    import fnmatch

    auto_dirs: set[Path] = set()
    auto_files: set[Path] = set()
    confirm_items: set[Path] = set()
    review_items: set[Path] = set()

    for pattern, category, rule_level in RULES:
        if level == "safe" and rule_level == "full":
            continue
        if level == "review-only" and category != "review":
            continue

        # 匹配目录
        dir_pattern = pattern.rstrip("/")
        for p in PROJECT_ROOT.rglob(dir_pattern):
            if p == PROJECT_ROOT:
                continue
            # Skip contents of node_modules, not node_modules itself
            if "node_modules" in p.relative_to(PROJECT_ROOT).parts[:-1]:
                continue
            try:
                rel = p.relative_to(PROJECT_ROOT).as_posix()
            except ValueError:
                continue
            if _should_keep(p, rel):
                continue
            if category == "auto":
                if p.is_dir():
                    auto_dirs.add(p)
                else:
                    auto_files.add(p)
            elif category == "confirm":
                confirm_items.add(p)
            else:
                review_items.add(p)

        # 匹配文件
        if "*" in pattern or "?" in pattern:
            for p in PROJECT_ROOT.rglob(pattern):
                if p == PROJECT_ROOT:
                    continue
                if p.is_dir():
                    continue
                if "node_modules" in p.relative_to(PROJECT_ROOT).parts[:-1]:
                    continue
                try:
                    rel = p.relative_to(PROJECT_ROOT).as_posix()
                except ValueError:
                    continue
                if _should_keep(p, rel):
                    continue
                if category == "auto":
                    auto_files.add(p)
                elif category == "confirm":
                    confirm_items.add(p)
                else:
                    review_items.add(p)

    return sorted(auto_dirs | auto_files, key=str), sorted(confirm_items, key=str), sorted(review_items, key=str)


def _format_size(path: Path) -> str:
    """返回人类可读的大小"""
    try:
        if path.is_dir():
            total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        else:
            total = path.stat().st_size
        if total < 1024:
            return f"{total}B"
        elif total < 1024 * 1024:
            return f"{total / 1024:.0f}KB"
        else:
            return f"{total / 1024 / 1024:.1f}MB"
    except OSError:
        return "?"


def print_results(level: str, auto_items: List[Path], confirm_items: List[Path], review_items: List[Path]):
    """打印扫描结果"""
    print(f"\nRelease Clean — {'DRY-RUN' if '--apply' not in sys.argv else 'APPLY'}  (level={level})\n")

    if auto_items:
        print("Will clean (auto):")
        for p in auto_items:
            rel = p.relative_to(PROJECT_ROOT).as_posix()
            size = _format_size(p)
            kind = "dir" if p.is_dir() else "file"
            print(f"  [{kind:4s}] {rel}  ({size})")
        print()
    else:
        print("No auto-clean items found.\n")

    if confirm_items:
        print("Needs manual confirmation:")
        for p in confirm_items:
            rel = p.relative_to(PROJECT_ROOT).as_posix()
            size = _format_size(p)
            kind = "dir" if p.is_dir() else "file"
            print(f"  [{kind:4s}] {rel}  ({size})")
        print()

    if review_items:
        print("Scanned but not deleted (review only):")
        for p in review_items:
            rel = p.relative_to(PROJECT_ROOT).as_posix()
            print(f"  {rel}")
        print()

    if not auto_items and not confirm_items and not review_items:
        print("✓ Project is already clean. Nothing to do.\n")
        return

    if "dry-run" in " ".join(sys.argv).lower() or "--apply" not in sys.argv:
        print("ⓘ  Nothing has been deleted. Run with --apply to delete.\n")


def do_delete(items: List[Path]) -> Tuple[int, int]:
    """执行删除，返回 (dirs_deleted, files_deleted)"""
    d = 0
    f = 0
    for p in items:
        try:
            if p.is_dir():
                shutil.rmtree(p)
                d += 1
                print(f"  ✓ removed dir:  {p.relative_to(PROJECT_ROOT).as_posix()}")
            elif p.is_file():
                p.unlink()
                f += 1
                print(f"  ✓ removed file: {p.relative_to(PROJECT_ROOT).as_posix()}")
        except Exception as e:
            print(f"  ✗ failed: {p.relative_to(PROJECT_ROOT).as_posix()} — {e}")
    return d, f


def check_git_status():
    """检查 git 状态"""
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, timeout=10, cwd=str(PROJECT_ROOT),
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if output:
                print("\n⚠  Git status (unstaged files):")
                print(output[:2000])
                print("\n⚠  Some files above may need manual review before upload.")
            else:
                print("\n✓ Git status: clean (no unstaged files).")
        else:
            print("\nⓘ  Not a Git repository. Run `git init` when ready.")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("\nⓘ  Git not found or not available.")


# ═══════════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(description="发布前一键清理脚本")
    parser.add_argument("--dry-run", action="store_true", default=True, help="预览模式，不删除")
    parser.add_argument("--apply", action="store_true", help="执行清理")
    parser.add_argument("--level", choices=["safe", "full", "review-only"], default="safe",
                        help="清理等级 (默认: safe)")
    args = parser.parse_args()

    # --apply 覆盖 --dry-run
    is_dry_run = not args.apply

    # 扫描
    auto_items, confirm_items, review_items = scan(args.level)

    # 打印结果
    print_results(args.level, auto_items, confirm_items, review_items)

    # 如果只是 review-only，不需要删除
    if args.level == "review-only":
        print("Review-only mode. Run with --level safe or --level full to clean.\n")
        return

    # dry-run 到此结束
    if is_dry_run:
        check_git_status()
        print()
        return

    # --apply 模式
    if not auto_items and not confirm_items:
        print("Nothing to clean.\n")
        check_git_status()
        return

    # 二次确认
    print("\n⚠  This will DELETE files from disk.")
    print("   Type CLEAN to continue, or anything else to abort.")
    try:
        confirm = input("> ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        sys.exit(1)

    if confirm != "CLEAN":
        print("Aborted.\n")
        sys.exit(1)

    # 执行删除
    print("\nCleaning...")
    d, f = do_delete(auto_items)

    if confirm_items:
        print(f"\n{len(confirm_items)} item(s) require manual review. Skipped auto-delete.")
        for p in confirm_items:
            print(f"  {p.relative_to(PROJECT_ROOT).as_posix()}")

    print(f"\n✓ Done. Removed {d} directories and {f} files.\n")
    check_git_status()
    print()


if __name__ == "__main__":
    main()
