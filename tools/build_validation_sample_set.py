#!/usr/bin/env python3
"""
Validation Sample Set Builder — Phase 1 (inventory) + Phase 2 (sampling + copy).

Scans complex image directories, produces a stratified sample, copies to
an external holdout validation set, and generates a reusable manifest.

Usage:
    # Phase 1 + 2
    python tools/build_validation_sample_set.py ^
        --roots "C:/path/r1" "C:/path/r2" ^
        --root-names r1 r2 ^
        --output "C:/ext/output/sample_v1"

    # Phase 1 only
    python tools/build_validation_sample_set.py --inventory-only ^
        --roots "C:/path/r1"

    # Phase 2 only (from saved inventory)
    python tools/build_validation_sample_set.py ^
        --from-inventory _validation_outputs/dataset_inventory.json ^
        --output "C:/ext/output/sample_v1"
"""

import argparse
import csv
import hashlib
import json
import os
import random
import shutil
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── Project root detection ──
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# ============================================================
# Constants
# ============================================================

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

EXCLUDE_DIR_NAMES = {
    ".git", ".venv", "venv", "__pycache__", "node_modules",
    "lighting_outputs", "exports", ".cache",
    "_backup", "backup", "_project_backups", "_validation_samples",
    "ComfyUI",
}

# ============================================================
# Phase 1: Inventory
# ============================================================

def _safe_str(val) -> str:
    if val is None:
        return ""
    return str(val)


def _short_hash(path: str, length: int = 8) -> str:
    """First `length` hex chars of SHA-256 of the path."""
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:length]


def _classify_orientation(w: int, h: int) -> str:
    if w <= 0 or h <= 0:
        return "unknown"
    ratio = w / h
    if ratio > 2.0:
        return "wide"
    elif ratio > 1.1:
        return "landscape"
    elif ratio < 0.9:
        return "portrait"
    else:
        return "square"


def _classify_size_bucket(w: int, h: int) -> str:
    max_dim = max(w, h)
    if max_dim <= 0:
        return "unknown"
    if max_dim <= 512:
        return "small"
    elif max_dim <= 1920:
        return "medium"
    elif max_dim <= 4096:
        return "large"
    else:
        return "huge"


def _classify_file_size_bucket(size_bytes: int) -> str:
    mb = size_bytes / (1024 * 1024)
    if mb < 0.1:
        return "tiny"
    elif mb < 5:
        return "normal"
    elif mb < 50:
        return "large"
    else:
        return "huge"


def _get_image_dimensions_safe(path: Path) -> Tuple[Optional[int], Optional[int]]:
    """Get image dimensions using PIL without fully decoding."""
    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size  # (width, height)
    except Exception:
        return None, None


def scan_directory(root_path: Path, root_name: str, root_index: int,
                   max_size_mb_for_skip: float = 200) -> List[dict]:
    """Recursively scan a directory for images.

    Returns list of image record dicts.
    """
    records = []
    root_str = str(root_path.resolve())

    if not root_path.exists():
        print(f"  WARNING: Root path does not exist: {root_path}")
        return records

    for dirpath, dirnames, filenames in os.walk(str(root_path)):
        # Filter excluded dirs in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_NAMES
                       and not d.startswith("_backup")]

        for fname in filenames:
            ext = Path(fname).suffix.lower()
            if ext not in VALID_EXTENSIONS:
                continue

            full_path = Path(dirpath) / fname
            rel_path = full_path.relative_to(root_path)
            parent_dir = full_path.parent
            leaf_dir = parent_dir.name

            try:
                stat = full_path.stat()
            except (OSError, PermissionError):
                records.append({
                    "original_path": str(full_path),
                    "root_name": root_name,
                    "root_index": root_index,
                    "root_path": root_str,
                    "relative_path": str(rel_path),
                    "parent_dir": str(parent_dir),
                    "leaf_dir": leaf_dir,
                    "extension": ext,
                    "file_size_bytes": 0,
                    "file_size_mb": 0,
                    "modified_time": "",
                    "readable": False,
                    "width": None,
                    "height": None,
                    "aspect_ratio": None,
                    "orientation": "unknown",
                    "size_bucket": "unknown",
                    "file_size_bucket": "unknown",
                    "skip_reason": "permission_error",
                })
                continue

            size_bytes = stat.st_size
            size_mb = size_bytes / (1024 * 1024)

            # Skip unreasonably large files
            if size_mb > max_size_mb_for_skip:
                records.append({
                    "original_path": str(full_path),
                    "root_name": root_name,
                    "root_index": root_index,
                    "root_path": root_str,
                    "relative_path": str(rel_path),
                    "parent_dir": str(parent_dir),
                    "leaf_dir": leaf_dir,
                    "extension": ext,
                    "file_size_bytes": size_bytes,
                    "file_size_mb": round(size_mb, 3),
                    "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "readable": False,
                    "width": None,
                    "height": None,
                    "aspect_ratio": None,
                    "orientation": "unknown",
                    "size_bucket": "unknown",
                    "file_size_bucket": _classify_file_size_bucket(size_bytes),
                    "skip_reason": f"too_large: {size_mb:.1f}MB",
                })
                continue

            w, h = _get_image_dimensions_safe(full_path)
            readable = w is not None and h is not None

            if not readable:
                records.append({
                    "original_path": str(full_path),
                    "root_name": root_name,
                    "root_index": root_index,
                    "root_path": root_str,
                    "relative_path": str(rel_path),
                    "parent_dir": str(parent_dir),
                    "leaf_dir": leaf_dir,
                    "extension": ext,
                    "file_size_bytes": size_bytes,
                    "file_size_mb": round(size_mb, 3),
                    "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "readable": False,
                    "width": None,
                    "height": None,
                    "aspect_ratio": None,
                    "orientation": "unknown",
                    "size_bucket": "unknown",
                    "file_size_bucket": _classify_file_size_bucket(size_bytes),
                    "skip_reason": "broken",
                })
                continue

            aspect = w / h if h > 0 else 0
            orientation = _classify_orientation(w, h)
            size_bucket = _classify_size_bucket(w, h)
            fs_bucket = _classify_file_size_bucket(size_bytes)

            records.append({
                "original_path": str(full_path),
                "root_name": root_name,
                "root_index": root_index,
                "root_path": root_str,
                "relative_path": str(rel_path),
                "parent_dir": str(parent_dir),
                "leaf_dir": leaf_dir,
                "extension": ext,
                "file_size_bytes": size_bytes,
                "file_size_mb": round(size_mb, 3),
                "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "readable": True,
                "width": w,
                "height": h,
                "aspect_ratio": round(aspect, 4),
                "orientation": orientation,
                "size_bucket": size_bucket,
                "file_size_bucket": fs_bucket,
                "skip_reason": "",
            })

    return records


def run_inventory(roots: List[str], root_names: List[str]) -> Dict:
    """Scan all roots, return structured inventory dict."""
    all_records = {}
    per_root = {}

    for i, (root_path, root_name) in enumerate(zip(roots, root_names)):
        print(f"  Scanning root [{i+1}/{len(roots)}]: {root_name} ({root_path})")
        records = scan_directory(Path(root_path), root_name, i,
                                 max_size_mb_for_skip=200)
        all_records[root_name] = records
        healthy = [r for r in records if r["readable"]]
        skipped = [r for r in records if not r["readable"]]
        print(f"    → {len(healthy)} healthy, {len(skipped)} skipped")
        per_root[root_name] = {
            "path": root_path,
            "healthy_count": len(healthy),
            "skipped_count": len(skipped),
        }

    return {
        "created_at": datetime.now().isoformat(),
        "root_count": len(roots),
        "roots": per_root,
        "records": all_records,
    }


def save_inventory(inventory: Dict, output_dir: Path):
    """Write inventory to JSON and CSV."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # JSON
    json_path = output_dir / "dataset_inventory.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(inventory, f, indent=2, ensure_ascii=False)
    print(f"  Inventory JSON: {json_path}")

    # CSV (flat table)
    csv_path = output_dir / "dataset_inventory.csv"
    all_recs = []
    for root_name, recs in inventory["records"].items():
        for r in recs:
            all_recs.append(r)

    if all_recs:
        fieldnames = list(all_recs[0].keys())
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(all_recs)
        print(f"  Inventory CSV: {csv_path} ({len(all_recs)} rows)")

    return json_path


def load_inventory(path: Path) -> Dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================
# Phase 2: Sampling
# ============================================================

def sample_from_inventory(inventory: Dict,
                          seed: int = 42,
                          max_total: int = 800,
                          max_per_root: int = 300,
                          max_per_leaf: int = 25,
                          min_per_leaf: int = 2,
                          max_file_size_mb: float = 50,
                          stress_large_per_root: int = 10) -> Dict:
    """Stratified sampling from inventory.

    Returns manifest dict with selected and skipped images.
    """
    rng = random.Random(seed)
    manifest = {
        "created_at": datetime.now().isoformat(),
        "seed": seed,
        "sampling_config": {
            "max_total": max_total,
            "max_per_root": max_per_root,
            "max_per_leaf": max_per_leaf,
            "min_per_leaf": min_per_leaf,
            "max_file_size_mb": max_file_size_mb,
            "stress_large_per_root": stress_large_per_root,
        },
        "root_paths": {},
        "root_names": [],
        "selected": [],
        "skipped": [],
    }

    all_selected = []
    all_stress_large = []
    all_skipped = []

    for root_name, records in inventory["records"].items():
        root_info = inventory["roots"].get(root_name, {})
        root_path = root_info.get("path", "")
        manifest["root_paths"][root_name] = root_path
        manifest["root_names"].append(root_name)

        # Separate healthy, large, and skipped
        healthy = [r for r in records if r["readable"] and r["skip_reason"] == ""
                   and r["file_size_mb"] <= max_file_size_mb]
        # Files exceeding max_file_size_mb go to stress_large (includes >200MB skip_reason files)
        stress_candidates = [r for r in records if r["readable"] and r["skip_reason"] == ""
                             and r["file_size_mb"] > max_file_size_mb]
        too_large_skipped = [r for r in records if "too_large" in r.get("skip_reason", "")]
        broken = [r for r in records if not r["readable"]]

        all_skipped.extend(too_large_skipped)
        all_skipped.extend(broken)

        # Stress large files (sampled separately)
        stress_large = stress_candidates[:stress_large_per_root]
        all_stress_large.extend(stress_large)

        # Group healthy by leaf_dir
        by_leaf = defaultdict(list)
        for r in healthy:
            by_leaf[r["leaf_dir"]].append(r)

        # Stratified sampling
        root_selected = []

        # Step 1: pick min_per_leaf from each leaf
        for leaf, leaf_records in by_leaf.items():
            rng.shuffle(leaf_records)
            take = min(min_per_leaf, len(leaf_records))
            for i in range(take):
                rec = leaf_records[i]
                rec["sample_reason"] = "leaf_minimum"
                root_selected.append(rec)

        # Step 2: fill to max_per_leaf with diverse samples
        for leaf, leaf_records in by_leaf.items():
            already = sum(1 for r in root_selected if r["leaf_dir"] == leaf)
            remaining = [r for r in leaf_records
                         if r["original_path"] not in {s["original_path"] for s in root_selected}]
            quota = max_per_leaf - already
            if quota <= 0 or not remaining:
                continue

            # Prioritize diversity: orientation, extension
            current_orientations = set()
            current_extensions = set()
            for r in root_selected:
                if r["leaf_dir"] == leaf:
                    current_orientations.add(r["orientation"])
                    current_extensions.add(r["extension"])

            # Pick files with underrepresented orientation/extension first
            def _diversity_key(rec):
                score = 0
                if rec["orientation"] not in current_orientations:
                    score += 10
                if rec["extension"] not in current_extensions:
                    score += 5
                return -score

            remaining.sort(key=_diversity_key)
            for rec in remaining[:quota]:
                rec["sample_reason"] = "orientation_extension_balance"
                current_orientations.add(rec["orientation"])
                current_extensions.add(rec["extension"])
                root_selected.append(rec)

        # Step 3: if root exceeds max_per_root, trim
        rng.shuffle(root_selected)
        if len(root_selected) > max_per_root:
            # Keep leaf_minimum first, trim random_fill/orientation last
            root_selected.sort(key=lambda r: (
                0 if r.get("sample_reason") == "leaf_minimum" else 1
            ))
            root_selected = root_selected[:max_per_root]
            # Re-label trimmed ones as random_fill
            for r in root_selected:
                if r.get("sample_reason") not in ("leaf_minimum",):
                    r["sample_reason"] = "random_fill"

        all_selected.extend(root_selected)

    # Step 4: overall max_total trim
    rng.shuffle(all_selected)
    if len(all_selected) > max_total:
        all_selected.sort(key=lambda r: (
            0 if r.get("sample_reason") == "leaf_minimum" else 1
        ))
        all_selected = all_selected[:max_total]

    # Sort by root then leaf for readability
    all_selected.sort(key=lambda r: (r["root_name"], r["leaf_dir"], r["original_path"]))

    manifest["selected"] = all_selected
    manifest["stress_large_files"] = all_stress_large
    manifest["skipped"] = all_skipped
    manifest["summary"] = {
        "total_selected": len(all_selected),
        "total_stress_large": len(all_stress_large),
        "total_skipped": len(all_skipped),
        "roots": {},
    }

    for root_name in inventory["roots"]:
        n_sel = sum(1 for r in all_selected if r["root_name"] == root_name)
        n_stress = sum(1 for r in all_stress_large if r["root_name"] == root_name)
        n_skip = sum(1 for r in all_skipped if r["root_name"] == root_name)
        manifest["summary"]["roots"][root_name] = {
            "selected": n_sel,
            "stress_large": n_stress,
            "skipped": n_skip,
        }

    return manifest


def _copy_without_overwrite(src: Path, dst: Path) -> bool:
    """Copy file, skip if dst already exists. Returns True if copied."""
    if dst.exists():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(str(src), str(dst))
        return True
    except Exception:
        return False


def _sanitize_filename(fname: str) -> str:
    """Remove or replace characters problematic for Windows filenames."""
    for ch in ['<', '>', ':', '"', '/', '\\', '|', '?', '*']:
        fname = fname.replace(ch, '_')
    return fname


def copy_samples(manifest: Dict, output_dir: Path):
    """Copy selected and stress_large files to output directory."""
    samples_base = output_dir / "samples"
    stress_base = output_dir / "stress_large_files"

    copied_count = 0
    skip_count = 0

    # Copy selected
    for rec in manifest["selected"]:
        src = Path(rec["original_path"])
        if not src.exists():
            rec["copied_path"] = ""
            rec["copy_status"] = "source_missing"
            continue

        h = _short_hash(rec["original_path"])
        safe_name = _sanitize_filename(src.name)
        safe_name = safe_name.replace("*", "_")  # Windows doesn't allow * in filenames
        dst = samples_base / rec["root_name"] / rec["leaf_dir"] / f"{h}_{safe_name}"

        if _copy_without_overwrite(src, dst):
            rec["copied_path"] = str(dst)
            rec["copy_status"] = "copied"
            copied_count += 1
        else:
            rec["copied_path"] = str(dst)
            rec["copy_status"] = "skipped_exists"
            skip_count += 1

    # Copy stress_large
    for rec in manifest.get("stress_large_files", []):
        src = Path(rec["original_path"])
        if not src.exists():
            rec["copied_path"] = ""
            rec["copy_status"] = "source_missing"
            continue

        h = _short_hash(rec["original_path"])
        safe_name = _sanitize_filename(src.name)
        safe_name2 = safe_name.replace("*", "_")
        dst = stress_base / rec["root_name"] / rec["leaf_dir"] / f"{h}_{safe_name2}"

        if _copy_without_overwrite(src, dst):
            rec["copied_path"] = str(dst)
            rec["copy_status"] = "copied"
            copied_count += 1
        else:
            rec["copied_path"] = str(dst)
            rec["copy_status"] = "skipped_exists"
            skip_count += 1

    print(f"  Copied: {copied_count}, Skipped (exists): {skip_count}")


def write_manifest(manifest: Dict, output_dir: Path):
    """Write manifest.json and manifest.csv."""
    # JSON
    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"  Manifest JSON: {manifest_path}")

    # CSV (selected + stress_large)
    all_items = list(manifest["selected"])
    all_items.extend(manifest.get("stress_large_files", []))
    fieldnames = ["original_path", "copied_path", "root_name", "leaf_dir",
                   "orientation", "extension", "file_size_mb", "width", "height",
                   "sample_reason", "copy_status"]
    csv_path = output_dir / "manifest.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        if all_items:
            writer.writerows(all_items)
    print(f"  Manifest CSV: {csv_path} ({len(all_items)} rows)")

    # Skipped CSV
    skipped = manifest.get("skipped", [])
    if skipped:
        skip_path = output_dir / "skipped_broken.csv"
        fieldnames = ["original_path", "root_name", "leaf_dir", "extension",
                       "file_size_mb", "skip_reason"]
        with open(skip_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(skipped)
        print(f"  Skipped CSV: {skip_path} ({len(skipped)} rows)")

    return manifest_path


# ============================================================
# CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(description="Build validation sample set")
    parser.add_argument("--roots", nargs="+", default=None,
                        help="Root directories to scan")
    parser.add_argument("--root-names", nargs="+", default=None,
                        help="Names for each root (same order)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output directory for sample set")
    parser.add_argument("--inventory-only", action="store_true",
                        help="Only scan, don't sample or copy")
    parser.add_argument("--from-inventory", type=str, default=None,
                        help="Use existing inventory JSON instead of scanning")
    parser.add_argument("--overwrite", action="store_true",
                        help="Allow overwriting existing output directory")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-total", type=int, default=800)
    parser.add_argument("--max-per-root", type=int, default=300)
    parser.add_argument("--max-per-leaf", type=int, default=25)
    parser.add_argument("--min-per-leaf", type=int, default=2)
    parser.add_argument("--max-file-size-mb", type=float, default=50)
    parser.add_argument("--stress-large-per-root", type=int, default=10)
    return parser.parse_args()


def main():
    args = parse_args()

    output_dir = None
    if args.output:
        output_dir = Path(args.output)
        if output_dir.exists() and not args.overwrite and not args.inventory_only:
            print(f"ERROR: Output directory already exists: {output_dir}")
            print("  Use --overwrite to override, or choose a different --output path.")
            sys.exit(1)

    # ── Phase 1: Inventory ──
    if args.from_inventory:
        print(f"Loading inventory from: {args.from_inventory}")
        inventory = load_inventory(Path(args.from_inventory))
    elif args.roots:
        if not args.root_names or len(args.root_names) != len(args.roots):
            # Auto-generate root names from folder names
            root_names = [Path(r).name for r in args.roots]
            print(f"  Auto root names: {root_names}")
        else:
            root_names = args.root_names

        print(f"Scanning {len(args.roots)} roots...")
        inventory = run_inventory(args.roots, root_names)

        # Save inventory
        inv_dir = PROJECT_ROOT / "_validation_outputs"
        inv_dir.mkdir(parents=True, exist_ok=True)
        save_inventory(inventory, inv_dir)
    else:
        print("ERROR: Provide --roots (or --from-inventory with existing inventory)")
        sys.exit(1)

    if args.inventory_only:
        print("\nInventory only — no sampling or copying done.")
        return

    if not output_dir:
        print("ERROR: --output required for sampling (or use --inventory-only)")
        sys.exit(1)

    # ── Phase 2: Sampling ──
    print(f"\nSampling (seed={args.seed}, max_total={args.max_total})...")
    manifest = sample_from_inventory(
        inventory,
        seed=args.seed,
        max_total=args.max_total,
        max_per_root=args.max_per_root,
        max_per_leaf=args.max_per_leaf,
        min_per_leaf=args.min_per_leaf,
        max_file_size_mb=args.max_file_size_mb,
        stress_large_per_root=args.stress_large_per_root,
    )

    # ── Copy ──
    print(f"\nCopying samples to: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    copy_samples(manifest, output_dir)

    # ── Write manifest ──
    write_manifest(manifest, output_dir)

    # ── Summary ──
    print(f"\n{'='*60}")
    print(f"SAMPLE SET SUMMARY")
    print(f"{'='*60}")
    print(f"  Output: {output_dir}")
    print(f"  Seed: {args.seed}")
    print(f"  Selected: {manifest['summary']['total_selected']}")
    print(f"  Stress large: {manifest['summary']['total_stress_large']}")
    print(f"  Skipped (broken/too large): {manifest['summary']['total_skipped']}")
    for root_name, info in manifest["summary"]["roots"].items():
        print(f"  Root '{root_name}': sel={info['selected']}, "
              f"stress={info['stress_large']}, skip={info['skipped']}")
    print("Done.")


if __name__ == "__main__":
    main()
