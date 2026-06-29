from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, List


def read_json(path: Path, filename: str) -> dict:
    fp = path / filename
    if not fp.exists():
        return {}
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def read_csv(path: Path, filename: str) -> List[dict]:
    fp = path / filename
    if not fp.exists():
        return []
    try:
        with open(fp, encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def parse_cluster_id(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return -1


def normalize_image_key(value: str) -> str:
    return str(value or "").strip().replace("\\", "/")


def image_aliases(row: dict) -> List[str]:
    aliases: List[str] = []
    image_path = normalize_image_key(row.get("image_path", ""))
    filename = normalize_image_key(row.get("filename", ""))
    basename = Path(image_path).name if image_path else ""
    for candidate in (image_path, filename, basename):
        if candidate and candidate not in aliases:
            aliases.append(candidate)
    return aliases


_CLUSTER_TAG_ZH = {
    "dark": "暗调",
    "dim": "低亮",
    "balanced": "均衡",
    "bright": "明亮",
    "high_key": "高调",
    "highlight_pop": "高光突出",
    "ink_shadow": "重阴影",
    "flat": "平光",
    "soft": "柔光",
    "dramatic": "戏剧光",
    "harsh": "硬光",
    "specular": "强反光",
    "warm": "暖色",
    "cool": "冷色",
    "neutral": "中性色",
    "muted": "低饱和",
    "vivid": "鲜艳",
    "rich": "浓郁色彩",
    "pastel": "柔和彩色",
    "mono_tone": "单色倾向",
    "center_light": "居中光",
    "side_light": "侧光",
    "left_light": "左侧光",
    "right_light": "右侧光",
    "top_light": "顶光",
    "bottom_light": "底光",
    "spotlight": "聚光",
    "even_light": "均匀光",
    "focused": "聚焦光",
    "diffuse": "漫射光",
    "flat_depth": "浅景深",
    "layered": "层次感",
    "deep_space": "深空间",
    "compressed": "压缩空间",
    "foreground_focus": "前景突出",
}


def localize_cluster_label(label_key: str) -> tuple[str, List[str]]:
    raw = str(label_key or "").strip()
    if not raw:
        return "", []
    if raw.lower() == "noise":
        return "未归类", ["noise"]
    remaining = raw
    components: List[str] = []
    for key in sorted(_CLUSTER_TAG_ZH.keys(), key=len, reverse=True):
        token = key
        while token in remaining.split("_"):
            parts = remaining.split("_")
            idx = parts.index(token)
            components.append(_CLUSTER_TAG_ZH[key])
            parts.pop(idx)
            remaining = "_".join(parts)
        if key in remaining:
            segments = remaining.split(key)
            if len(segments) > 1:
                components.append(_CLUSTER_TAG_ZH[key])
                remaining = "_".join(part.strip("_") for part in segments if part.strip("_"))
    seen: List[str] = []
    for item in components:
        if item and item not in seen:
            seen.append(item)
    if not seen and raw:
        return raw.replace("_", " "), []
    return " · ".join(seen[:4]), seen[:4]


def load_atlas_rows(path: Path) -> List[dict]:
    atlas = read_csv(path, "atlas_points.csv")
    if atlas:
        return atlas
    return read_csv(path, "umap_points_3d.csv")


def load_cluster_catalog(path: Path) -> Dict[str, dict]:
    cluster_analysis = read_json(path, "cluster_analysis.json")
    cluster_summary = read_json(path, "cluster_summary.json")
    cluster_names = read_json(path, "cluster_names.json")
    report = read_json(path, "report.json")
    edits = read_json(path, "cluster_edits.json")
    report_clusters = report.get("cluster_info") or {}
    rename_map = edits.get("display_name") or {}

    cluster_ids = set()
    for key in cluster_analysis.keys():
        if str(key).lstrip("-").isdigit():
            cluster_ids.add(str(int(key)))
    for key in cluster_names.keys():
        if str(key).lstrip("-").isdigit():
            cluster_ids.add(str(int(key)))
    for key in report_clusters.keys():
        if str(key).lstrip("-").isdigit():
            cluster_ids.add(str(int(key)))
    for key in cluster_summary.keys():
        if key == "noise":
            cluster_ids.add("-1")
            continue
        if str(key).startswith("cluster_"):
            raw = str(key).replace("cluster_", "", 1)
            if raw.lstrip("-").isdigit():
                cluster_ids.add(str(int(raw)))
    for key in rename_map.keys():
        if str(key).lstrip("-").isdigit():
            cluster_ids.add(str(int(key)))

    catalog: Dict[str, dict] = {}
    for cid in cluster_ids:
        analysis_entry = cluster_analysis.get(cid) or {}
        summary_key = "noise" if cid == "-1" else f"cluster_{cid}"
        summary_entry = cluster_summary.get(summary_key) or {}
        report_entry = report_clusters.get(cid) or {}
        names_entry = cluster_names.get(cid)

        base_name = ""
        suggested_name = ""
        if isinstance(names_entry, dict):
            suggested_name = str(
                names_entry.get("suggested_name")
                or names_entry.get("name")
                or ""
            )
        elif isinstance(names_entry, str):
            suggested_name = names_entry

        if isinstance(analysis_entry, dict):
            base_name = str(analysis_entry.get("suggested_name") or "")

        if not suggested_name:
            suggested_name = base_name
        if not base_name:
            base_name = (
                suggested_name
                or str(summary_entry.get("name") or "")
                or str(report_entry.get("name") or "")
            )

        default_name = "noise" if cid == "-1" else f"Cluster {cid}"
        label_key = str(suggested_name or base_name or default_name)
        localized_name, components = localize_cluster_label(label_key)
        display_name = str(rename_map.get(cid) or localized_name or base_name or default_name)

        catalog[cid] = {
            "id": cid,
            "label_key": label_key,
            "display_name": display_name,
            "suggested_name": suggested_name or base_name or default_name,
            "components": components,
            "confidence": float(analysis_entry.get("name_confidence", 0) or 0),
            "count": int(summary_entry.get("count", report_entry.get("count", 0)) or 0),
        }
    return catalog


def apply_organized_state(path: Path, rows: List[dict]) -> List[dict]:
    moves = read_json(path, "cluster_moves.json")
    cluster_catalog = load_cluster_catalog(path)

    merged_rows: List[dict] = []
    for row in rows:
        normalized_row = dict(row)
        image_path = normalize_image_key(row.get("image_path") or row.get("filename") or "")
        filename = normalize_image_key(row.get("filename") or Path(image_path).name)
        original_cluster_id = parse_cluster_id(row.get("cluster_id"))
        original_cluster_key = str(original_cluster_id)
        original_cluster_info = cluster_catalog.get(original_cluster_key) or {}
        original_cluster_name = (
            original_cluster_info.get("display_name")
            or row.get("cluster_name")
            or ("noise" if original_cluster_id == -1 else f"Cluster {original_cluster_id}")
        )

        target_cluster_id = None
        for alias in image_aliases({"image_path": image_path, "filename": filename}):
            if alias in moves:
                target_cluster_id = parse_cluster_id(moves[alias])
                break

        effective_cluster_id = original_cluster_id if target_cluster_id is None else target_cluster_id
        effective_cluster_key = str(effective_cluster_id)
        cluster_info = cluster_catalog.get(effective_cluster_key) or {}
        cluster_name = (
            cluster_info.get("display_name")
            or row.get("cluster_name")
            or ("noise" if effective_cluster_id == -1 else f"Cluster {effective_cluster_id}")
        )

        normalized_row["filename"] = filename
        normalized_row["image_path"] = image_path
        normalized_row["original_cluster_id"] = original_cluster_id
        normalized_row["original_cluster_name"] = original_cluster_name
        normalized_row["cluster_id"] = effective_cluster_id
        normalized_row["cluster_name"] = cluster_name
        merged_rows.append(normalized_row)

    return merged_rows


def load_organized_rows(path: Path) -> List[dict]:
    rows = load_atlas_rows(path)
    if not rows:
        return []
    return apply_organized_state(path, rows)


# ============================================================
# cluster_layout overlay — 簇卡位置
# ============================================================


def load_layout(path: Path) -> dict:
    """Load cluster_layout.json { cluster_id: { x, y } }."""
    return read_json(path, "cluster_layout.json")


def save_layout(path: Path, layout: dict) -> bool:
    """Save cluster_layout.json. Returns True on success."""
    if not layout:
        return True  # nothing to save
    try:
        with open(path / "cluster_layout.json", "w", encoding="utf-8") as f:
            json.dump(layout, f, indent=2, ensure_ascii=False)
        return True
    except OSError:
        return False


# ============================================================
# manual_order overlay — 用户手工图片顺序
# ============================================================


def load_manual_order(path: Path) -> dict:
    """Load manual_order.json { cluster_id: [filename, ...] }."""
    return read_json(path, "manual_order.json")


def save_manual_order(path: Path, order: dict) -> bool:
    """Save manual_order.json. Returns True on success."""
    if not order:
        return True
    try:
        with open(path / "manual_order.json", "w", encoding="utf-8") as f:
            json.dump(order, f, indent=2, ensure_ascii=False)
        return True
    except OSError:
        return False
