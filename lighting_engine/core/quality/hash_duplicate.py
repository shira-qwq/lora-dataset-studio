"""Duplicate group detection — v4.5 (P05-002)

Two-layer duplicate detection:
1. Exact duplicates: file_size + sha256 + blake2b (blake3 if available)
2. Perceptual near-duplicates: phash, dhash, whash, colorhash

Results are structured as groups with hit evidence.
Does NOT auto-delete images — only marks groups for review.
"""

import hashlib
import logging
from collections import defaultdict
from pathlib import Path
from typing import Optional

from PIL import Image
import imagehash

logger = logging.getLogger("HashDuplicate")

# ── Blake3 availability ──

try:
    import blake3 as _blake3

    def _compute_blake3(data: bytes) -> str:
        return _blake3.blake3(data).hexdigest()

    BLAKE3_AVAILABLE = True
except ImportError:
    BLAKE3_AVAILABLE = False

    def _compute_blake3(data: bytes) -> str:
        """Fallback: use hashlib.blake2b (256-bit) when blake3 is not installed."""
        return hashlib.blake2b(data, digest_size=32).hexdigest()


# ═══════════════════════════════════════════════════════════════
# 1. Exact hashing
# ═══════════════════════════════════════════════════════════════


def compute_file_hash(filepath: Path, algo: str = "sha256") -> str:
    """Compute a hash of file contents."""
    h = hashlib.new(algo)
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def compute_exact_hashes(image_paths: list) -> dict:
    """Compute exact hash trio (file_size, sha256, blake2b/3) for each image.

    Args:
        image_paths: list of Path or str

    Returns:
        {str(path): {"file_size": int, "sha256": str, "blake3": str}}
        On failure, hash values are empty string/0.
    """
    result = {}
    for p in image_paths:
        path = Path(p) if not isinstance(p, Path) else p
        try:
            data = path.read_bytes()
            result[str(path)] = {
                "file_size": path.stat().st_size,
                "sha256": hashlib.sha256(data).hexdigest(),
                "blake3": _compute_blake3(data),
            }
        except Exception as e:
            logger.warning("Failed to hash %s: %s", path, e)
            result[str(path)] = {"file_size": 0, "sha256": "", "blake3": ""}
    return result


# ═══════════════════════════════════════════════════════════════
# 2. Perceptual hashing
# ═══════════════════════════════════════════════════════════════


def compute_perceptual_hashes(image_paths: list) -> dict:
    """Compute perceptual hashes (phash, dhash, whash, colorhash) for each image.

    Args:
        image_paths: list of Path or str

    Returns:
        {str(path): {"phash": str, "dhash": str, "whash": str, "colorhash": str}}
        Empty string on failure.
    """
    result = {}
    for p in image_paths:
        path = Path(p) if not isinstance(p, Path) else p
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                result[str(path)] = {
                    "phash": str(imagehash.phash(im)),
                    "dhash": str(imagehash.dhash(im)),
                    "whash": str(imagehash.whash(im)),
                    "colorhash": str(imagehash.colorhash(im)),
                }
        except Exception as e:
            logger.warning("Failed to perceptual-hash %s: %s", path, e)
            result[str(path)] = {"phash": "", "dhash": "", "whash": "", "colorhash": ""}
    return result


# ═══════════════════════════════════════════════════════════════
# 3. Hamming distance helpers
# ═══════════════════════════════════════════════════════════════


def _hamming_hex(a: str, b: str) -> int:
    """Hamming distance between two hex hash strings."""
    if not a or not b:
        return 999
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _hamming_distance_for_hash(ha: dict, hb: dict, algo: str) -> int:
    """Hamming distance for a specific perceptual hash algorithm."""
    return _hamming_hex(ha.get(algo, ""), hb.get(algo, ""))


# ═══════════════════════════════════════════════════════════════
# 4. Grouping
# ═══════════════════════════════════════════════════════════════


def group_exact_duplicates(exact_hashes: dict) -> list:
    """Group images that are exact duplicates (all three hashes match).

    Args:
        exact_hashes: {path: {"file_size": int, "sha256": str, "blake3": str}}

    Returns:
        List of group dicts:
        {
            "group_id": "dup_exact_0000",
            "group_type": "exact",
            "hit_evidence": ["file_size", "sha256", "blake3"],
            "image_count": int,
            "representative": str (first path in group),
            "members": [{...}]
        }
    """
    # Group by (file_size, sha256, blake3) tuple
    buckets = defaultdict(list)
    for path_str, h in exact_hashes.items():
        if not h["sha256"] or not h["blake3"]:
            continue
        key = (h["file_size"], h["sha256"], h["blake3"])
        buckets[key].append(path_str)

    groups = []
    idx = 0
    for key, members in buckets.items():
        if len(members) <= 1:
            continue
        hit_evidence = ["file_size", "sha256", "blake3"]
        # If all three match, it's exact
        members_info = []
        for m in members:
            info = {"path": m}
            info.update(exact_hashes[m])
            members_info.append(info)

        groups.append({
            "group_id": f"dup_exact_{idx:04d}",
            "group_type": "exact",
            "hit_evidence": hit_evidence,
            "image_count": len(members),
            "representative": members[0],
            "members": members_info,
        })
        idx += 1

    return groups


def _union_find_group(paths: list, hash_map: dict, algo: str, threshold: int) -> list:
    """Union-find grouping based on Hamming distance for one hash algorithm.

    Returns list of (root, [members]) tuples where len(members) > 1.
    """
    parent = {p: p for p in paths}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(paths)):
        for j in range(i + 1, len(paths)):
            if _hamming_hex(
                hash_map[paths[i]].get(algo, ""),
                hash_map[paths[j]].get(algo, ""),
            ) <= threshold:
                union(paths[i], paths[j])

    raw = defaultdict(list)
    for p in paths:
        raw[find(p)].append(p)

    return [(r, members) for r, members in raw.items() if len(members) > 1]


def group_perceptual_duplicates(
    perceptual_hashes: dict,
    phash_threshold: int = 6,
    dhash_threshold: int = 8,
    whash_threshold: int = 8,
    colorhash_threshold: int = 4,
    min_algo_hits: int = 2,
) -> list:
    """Group near-duplicate images using multiple perceptual hash algorithms.

    An image pair is considered near-duplicate if at least `min_algo_hits`
    algorithms report a Hamming distance within their threshold.

    Args:
        perceptual_hashes: {path: {"phash": str, "dhash": str, "whash": str, "colorhash": str}}
        phash_threshold: max Hamming distance for phash (default 6)
        dhash_threshold: max Hamming distance for dhash (default 8)
        whash_threshold: max Hamming distance for whash (default 8)
        colorhash_threshold: max Hamming distance for colorhash (default 4)
        min_algo_hits: min number of algorithms that must agree (default 2)

    Returns:
        List of group dicts (same structure as exact groups)
    """
    paths = [p for p, h in perceptual_hashes.items() if h.get("phash")]

    # Build adjacency: edge if at least min_algo_hits algorithms agree
    parent = {p: p for p in paths}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    algos = [
        ("phash", phash_threshold),
        ("dhash", dhash_threshold),
        ("whash", whash_threshold),
        ("colorhash", colorhash_threshold),
    ]

    for i in range(len(paths)):
        for j in range(i + 1, len(paths)):
            hits = 0
            hit_algos = []
            for algo, thresh in algos:
                d = _hamming_hex(
                    perceptual_hashes[paths[i]].get(algo, ""),
                    perceptual_hashes[paths[j]].get(algo, ""),
                )
                if d <= thresh:
                    hits += 1
                    hit_algos.append(algo)
            if hits >= min_algo_hits:
                union(paths[i], paths[j])

    raw = defaultdict(list)
    for p in paths:
        raw[find(p)].append(p)

    groups = []
    idx = 0
    for root, members in raw.items():
        if len(members) <= 1:
            continue

        # Determine which algorithms contributed to this group
        # by checking pairwise distances
        all_hit_algos = set()
        for algo, _ in algos:
            # Check if at least one pair in this group is within threshold
            any_hit = False
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    d = _hamming_hex(
                        perceptual_hashes[members[i]].get(algo, ""),
                        perceptual_hashes[members[j]].get(algo, ""),
                    )
                    if d <= dict(algos)[algo]:
                        any_hit = True
                        break
                if any_hit:
                    break
            if any_hit:
                all_hit_algos.add(algo)

        members_info = []
        for m in members:
            info = {"path": m}
            info.update(perceptual_hashes[m])
            members_info.append(info)

        groups.append({
            "group_id": f"dup_perceptual_{idx:04d}",
            "group_type": "perceptual",
            "hit_evidence": sorted(all_hit_algos),
            "image_count": len(members),
            "representative": members[0],
            "members": members_info,
        })
        idx += 1

    return groups


# ═══════════════════════════════════════════════════════════════
# 5. Combined pipeline
# ═══════════════════════════════════════════════════════════════


def build_duplicate_groups(
    image_paths: list,
    phash_threshold: int = 6,
    dhash_threshold: int = 8,
    whash_threshold: int = 8,
    colorhash_threshold: int = 4,
    min_algo_hits: int = 2,
) -> dict:
    """Full duplicate detection pipeline.

    Args:
        image_paths: list of Path or str
        phash_threshold: phash Hamming threshold
        dhash_threshold: dhash Hamming threshold
        whash_threshold: whash Hamming threshold
        colorhash_threshold: colorhash Hamming threshold
        min_algo_hits: min perceptual algorithms that must agree

    Returns:
        {
            "groups": [...],
            "stats": {
                "total_exact_groups": int,
                "total_perceptual_groups": int,
                "total_duplicate_images": int,
                "total_images_checked": int
            },
            "build_info": {
                "exact_hash_used": ["file_size", "sha256", "blake3"],
                "perceptual_hash_used": ["phash", "dhash", "whash", "colorhash"],
                "blake3_available": bool,
                "blake3_note": str
            }
        }
    """
    logger.info("Building duplicate groups for %d images...", len(image_paths))

    # Phase 1: Exact hashes
    exact_hashes = compute_exact_hashes(image_paths)
    exact_groups = group_exact_duplicates(exact_hashes)

    # Phase 2: Perceptual hashes
    perceptual_hashes = compute_perceptual_hashes(image_paths)
    perceptual_groups = group_perceptual_duplicates(
        perceptual_hashes,
        phash_threshold=phash_threshold,
        dhash_threshold=dhash_threshold,
        whash_threshold=whash_threshold,
        colorhash_threshold=colorhash_threshold,
        min_algo_hits=min_algo_hits,
    )

    all_groups = exact_groups + perceptual_groups
    total_dup_images = sum(g["image_count"] for g in all_groups)

    blake3_note = (
        "blake3 module installed; using native blake3"
        if BLAKE3_AVAILABLE
        else "blake3 not available; using hashlib.blake2b (256-bit) as fallback"
    )

    return {
        "groups": all_groups,
        "stats": {
            "total_exact_groups": len(exact_groups),
            "total_perceptual_groups": len(perceptual_groups),
            "total_duplicate_images": total_dup_images,
            "total_images_checked": len(image_paths),
        },
        "build_info": {
            "exact_hash_used": ["file_size", "sha256", "blake3"],
            "perceptual_hash_used": ["phash", "dhash", "whash", "colorhash"],
            "blake3_available": BLAKE3_AVAILABLE,
            "blake3_note": blake3_note,
        },
    }


# ═══════════════════════════════════════════════════════════════
# Backward-compatible aliases (v4.3 API)
# ═══════════════════════════════════════════════════════════════


def compute_hashes(image_paths: list) -> dict:
    """Backward-compatible: compute phash for each image (old v4.3 API).

    Returns {str(path): str(phash)} to keep pipeline.py import working.
    """
    ph = compute_perceptual_hashes(image_paths)
    return {k: v.get("phash", "") for k, v in ph.items()}


def group_near_duplicates(hash_map: dict, max_distance: int = 4) -> dict:
    """Backward-compatible: group near-duplicates by phash Hamming distance (old v4.3 API).

    Returns {path_str: {"duplicate_group_id": ..., "duplicate_group_size": ..., "is_near_duplicate": bool}}
    """
    full_map = {k: {"phash": v} for k, v in hash_map.items()}
    groups = group_perceptual_duplicates(
        full_map,
        phash_threshold=max_distance,
        dhash_threshold=999,
        whash_threshold=999,
        colorhash_threshold=999,
        min_algo_hits=1,
    )
    result = {}
    for g in groups:
        for m in g["members"]:
            result[m["path"]] = {
                "duplicate_group_id": g["group_id"],
                "duplicate_group_size": g["image_count"],
                "is_near_duplicate": True,
            }
    return result