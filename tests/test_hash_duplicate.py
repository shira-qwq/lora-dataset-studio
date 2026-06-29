"""Tests for lighting_engine.core.quality.hash_duplicate — P05-002.

Covers:
- Exact hash computation (file_size, sha256, blake2b)
- Perceptual hash computation (phash, dhash, whash, colorhash)
- Exact duplicate grouping
- Perceptual duplicate grouping
- Combined pipeline
"""

import hashlib
import json
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from lighting_engine.core.quality.hash_duplicate import (
    BLAKE3_AVAILABLE,
    _compute_blake3,
    _hamming_hex,
    build_duplicate_groups,
    compute_exact_hashes,
    compute_file_hash,
    compute_perceptual_hashes,
    group_exact_duplicates,
    group_perceptual_duplicates,
)


# ── Fixtures ──


@pytest.fixture
def temp_images():
    """Create 4 test images: 2 exact duplicates (A1, A2), 1 unique (B), 1 near-duplicate (C1)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        d = Path(tmpdir)

        # Exact duplicate pair: same content
        img1_path = d / "img_A1.png"
        img2_path = d / "img_A2.png"
        img1 = Image.fromarray(np.zeros((10, 10, 3), dtype=np.uint8))
        img1.save(img1_path)
        img2 = Image.fromarray(np.zeros((10, 10, 3), dtype=np.uint8))
        img2.save(img2_path)

        # Unique image: different content
        img3_path = d / "img_B.png"
        img3 = Image.fromarray(np.ones((10, 10, 3), dtype=np.uint8) * 255)
        img3.save(img3_path)

        # Near-duplicate: slightly different
        img4_path = d / "img_C1.png"
        arr4 = np.zeros((10, 10, 3), dtype=np.uint8)
        arr4[0, 0] = [1, 1, 1]  # One pixel difference
        img4 = Image.fromarray(arr4)
        img4.save(img4_path)

        yield {
            "img_A1": str(img1_path),
            "img_A2": str(img2_path),
            "img_B": str(img3_path),
            "img_C1": str(img4_path),
        }


# ── Exact hash tests ──


def test_compute_file_hash_sha256(temp_images):
    h = compute_file_hash(Path(temp_images["img_A1"]), "sha256")
    assert isinstance(h, str)
    assert len(h) == 64  # SHA-256 hex


def test_compute_exact_hashes(temp_images):
    paths = list(temp_images.values())
    result = compute_exact_hashes(paths)

    assert len(result) == 4

    for path_str, hashes in result.items():
        assert "file_size" in hashes
        assert "sha256" in hashes
        assert "blake3" in hashes
        assert isinstance(hashes["file_size"], int)
        assert hashes["file_size"] > 0

    # The two exact duplicates should have identical hashes
    h1 = result[temp_images["img_A1"]]
    h2 = result[temp_images["img_A2"]]
    assert h1["sha256"] == h2["sha256"]
    assert h1["blake3"] == h2["blake3"]
    assert h1["file_size"] == h2["file_size"]

    # Unique image should differ
    h3 = result[temp_images["img_B"]]
    assert h1["sha256"] != h3["sha256"]


def test_blake3_fallback():
    """Test that _compute_blake3 produces a hex string."""
    data = b"test data"
    result = _compute_blake3(data)
    assert isinstance(result, str)
    assert len(result) > 0
    # Should be consistent
    assert _compute_blake3(data) == _compute_blake3(data)


# ── Perceptual hash tests ──


def test_compute_perceptual_hashes(temp_images):
    paths = list(temp_images.values())
    result = compute_perceptual_hashes(paths)

    assert len(result) == 4

    for path_str, hashes in result.items():
        assert "phash" in hashes
        assert "dhash" in hashes
        assert "whash" in hashes
        assert "colorhash" in hashes
        assert isinstance(hashes["phash"], str)
        assert len(hashes["phash"]) > 0

    # Exact duplicates should have identical perceptual hashes
    h1 = result[temp_images["img_A1"]]
    h2 = result[temp_images["img_A2"]]
    assert h1["phash"] == h2["phash"]
    assert h1["dhash"] == h2["dhash"]


# ── Hamming distance tests ──


def test_hamming_hex():
    assert _hamming_hex("0000", "0000") == 0
    assert _hamming_hex("ffff", "0000") == 16
    assert _hamming_hex("", "0000") == 999  # Empty handling
    assert _hamming_hex("0000", "") == 999

    # Different strings
    d = _hamming_hex("aaaa", "aaab")
    assert d > 0


# ── Exact duplicate grouping tests ──


def test_group_exact_duplicates(temp_images):
    paths = list(temp_images.values())
    exact_hashes = compute_exact_hashes(paths)
    groups = group_exact_duplicates(exact_hashes)

    # Should find 1 exact group (img_A1 and img_A2)
    assert len(groups) == 1
    group = groups[0]
    assert group["group_type"] == "exact"
    assert group["image_count"] == 2
    assert "file_size" in group["hit_evidence"]
    assert "sha256" in group["hit_evidence"]
    assert "blake3" in group["hit_evidence"]

    # Group members
    member_paths = [m["path"] for m in group["members"]]
    assert temp_images["img_A1"] in member_paths
    assert temp_images["img_A2"] in member_paths


def test_group_exact_duplicates_no_duplicates(temp_images):
    """Only unique images should produce no groups."""
    # Use just the unique image
    exact_hashes = compute_exact_hashes([temp_images["img_B"]])
    groups = group_exact_duplicates(exact_hashes)
    assert len(groups) == 0


# ── Perceptual duplicate grouping tests ──


def test_group_perceptual_duplicates(temp_images):
    paths = list(temp_images.values())
    perceptual_hashes = compute_perceptual_hashes(paths)
    groups = group_perceptual_duplicates(
        perceptual_hashes,
        phash_threshold=6,
        dhash_threshold=8,
        whash_threshold=8,
        colorhash_threshold=4,
        min_algo_hits=2,
    )

    # Should find at least 1 perceptual group (the exact duplicates are also perceptual near-duplicates)
    # and possibly the C1 image if it's close enough
    assert len(groups) >= 1

    # Check group structure
    for g in groups:
        assert "group_id" in g
        assert g["group_type"] == "perceptual"
        assert g["image_count"] >= 2
        assert "hit_evidence" in g
        assert len(g["hit_evidence"]) >= 1
        assert "members" in g
        assert len(g["members"]) >= 2


# ── Combined pipeline tests ──


def test_build_duplicate_groups(temp_images):
    paths = list(temp_images.values())
    result = build_duplicate_groups(paths)

    assert "groups" in result
    assert "stats" in result
    assert "build_info" in result

    # Stats
    stats = result["stats"]
    assert stats["total_exact_groups"] >= 1
    assert stats["total_images_checked"] == 4

    # Build info
    info = result["build_info"]
    assert "exact_hash_used" in info
    assert "perceptual_hash_used" in info
    assert "blake3_available" in info
    assert isinstance(info["blake3_available"], bool)
    assert "blake3_note" in info

    # All exact groups should have proper IDs
    for g in result["groups"]:
        if g["group_type"] == "exact":
            assert g["group_id"].startswith("dup_exact_")
        else:
            assert g["group_id"].startswith("dup_perceptual_")


def test_build_duplicate_groups_no_duplicates():
    """Two completely different images should produce no groups."""
    with tempfile.TemporaryDirectory() as tmpdir:
        d = Path(tmpdir)

        # Image with fine random noise
        rng = np.random.default_rng(42)
        arr1 = (rng.random((100, 100, 3)) * 255).astype(np.uint8)
        img1 = Image.fromarray(arr1)
        img1.save(d / "noise1.png")

        # Different random noise (different seed)
        rng2 = np.random.default_rng(99)
        arr2 = (rng2.random((100, 100, 3)) * 255).astype(np.uint8)
        img2 = Image.fromarray(arr2)
        img2.save(d / "noise2.png")

        result = build_duplicate_groups(
            [str(d / "noise1.png"), str(d / "noise2.png")],
            phash_threshold=4,
            dhash_threshold=6,
            whash_threshold=6,
            min_algo_hits=3,
        )
        # Random noise images should not be perceptual duplicates with tight thresholds
        assert len(result["groups"]) == 0, f"Expected no groups, got {len(result['groups'])}"
        assert result["stats"]["total_duplicate_images"] == 0
