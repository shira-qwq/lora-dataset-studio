"""Reviews router — user image review/flag/tag operations.

Stores review data as a JSON file inside the job output directory
(reviews.json). In a full Studio implementation this would be SQLite.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/images", tags=["reviews"])

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent


def _reviews_path(job_id: str) -> Path:
    """Path to the reviews JSON file for a given job."""
    candidates = [
        _PROJECT_ROOT / job_id,
        _PROJECT_ROOT / f"{job_id}_output_v7",
        _PROJECT_ROOT / f"{job_id}_output",
    ]
    for c in candidates:
        if c.is_dir():
            return c / "reviews.json"
    (_PROJECT_ROOT / "studio_data" / "reviews").mkdir(parents=True, exist_ok=True)
    return _PROJECT_ROOT / "studio_data" / "reviews" / f"{job_id}.json"


def _load_reviews(job_id: str) -> dict:
    p = _reviews_path(job_id)
    if p.exists():
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_reviews(job_id: str, reviews: dict):
    p = _reviews_path(job_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(reviews, f, indent=2, ensure_ascii=False)


@router.get("/{image_id}/review")
async def get_review(image_id: str, job_id: str = "latest"):
    """Get review for a single image."""
    reviews = _load_reviews(job_id)
    data = reviews.get(image_id, {})
    return {
        "image_id": image_id,
        "flag": data.get("flag"),
        "tags": data.get("tags", []),
        "note": data.get("note", ""),
        "rating": data.get("rating"),
        "user": "local",
        "updated_at": data.get("updated_at"),
    }


@router.put("/{image_id}/review")
async def set_review(image_id: str, job_id: str = "latest",
                     flag: Optional[str] = None,
                     tags: Optional[List[str]] = None,
                     note: Optional[str] = None,
                     rating: Optional[int] = None):
    """Set/update review for a single image."""
    valid_flags = (None, "keep", "reject", "maybe", "good", "bad", "favorite", "misclustered")
    if flag is not None and flag not in valid_flags:
        raise HTTPException(422, f"Invalid flag: {flag}")
    reviews = _load_reviews(job_id)
    entry = reviews.get(image_id, {})
    if flag is not None:
        entry["flag"] = flag
    if tags is not None:
        entry["tags"] = tags
    if note is not None:
        entry["note"] = note
    if rating is not None:
        entry["rating"] = max(0, min(5, rating))
    entry["updated_at"] = datetime.now().isoformat()
    reviews[image_id] = entry
    _save_reviews(job_id, reviews)
    entry["image_id"] = image_id
    entry["user"] = "local"
    return entry


@router.delete("/{image_id}/review")
async def clear_review(image_id: str, job_id: str = "latest"):
    """Clear review for a single image."""
    reviews = _load_reviews(job_id)
    reviews.pop(image_id, None)
    _save_reviews(job_id, reviews)
    return {"status": "cleared", "image_id": image_id}


@router.post("/batch-review")
async def batch_review(body: dict):
    """Batch set review for multiple images.

    Body: { "image_ids": [...], "flag": "good|bad|favorite|...",
            "tags": [...], "note": "...", "job_id": "写真test_output_v7" }
    """
    image_ids = body.get("image_ids", [])
    job_id = body.get("job_id", "latest")
    flag = body.get("flag")
    tags = body.get("tags")
    note = body.get("note")

    if not image_ids:
        raise HTTPException(422, "image_ids is required")

    reviews = _load_reviews(job_id)
    now = datetime.now().isoformat()
    updated = 0
    for img_id in image_ids:
        entry = reviews.get(img_id, {})
        if flag is not None:
            entry["flag"] = flag
        if tags is not None:
            entry["tags"] = tags
        if note is not None:
            entry["note"] = note
        entry["updated_at"] = now
        reviews[img_id] = entry
        updated += 1
    _save_reviews(job_id, reviews)
    return {"updated": updated, "job_id": job_id}
