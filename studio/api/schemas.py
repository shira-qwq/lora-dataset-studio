"""Pydantic models for Dataset Intelligence Studio API

Shapes aligned with pipeline output files (写真test_output_v7/*)
and the stitch_light_analysis_engine HTML template expectations.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Job / Run ──

class JobConfig(BaseModel):
    """Configuration for a pipeline job, matching main.py --args + CONFIG overrides."""
    input_folders: List[str] = Field(..., description="Input image directories")
    output_folder: str = Field(default="", description="Output directory (auto-generated if empty)")
    use_depth: bool = Field(default=False, description="Enable depth+coupling+depth_gap features")
    color_weight: float = Field(default=1.0, ge=0.0, le=2.0)
    preset: str = Field(default="full")
    model: str = Field(default="depth-anything/DA3-SMALL")
    umap_neighbors: int = Field(default=50, ge=5, le=200)
    cluster_size_ratio: float = Field(default=0.015, ge=0.005, le=0.05)


class JobStatus(BaseModel):
    """Job lifecycle state."""
    id: str
    status: str = Field(..., pattern="^(queued|running|completed|failed)$")
    created_at: str
    completed_at: Optional[str] = None
    config: JobConfig
    output_folder: Optional[str] = None
    error: Optional[str] = None


class JobEvent(BaseModel):
    """SSE event payload for job progress."""
    event: str = Field(..., pattern="^(progress|log|result|error|done)$")
    data: Dict[str, Any]


# ── Results: Summary ──

class QualityMetrics(BaseModel):
    silhouette_score: Optional[float] = None
    davies_bouldin_score: Optional[float] = None


class ResultSummary(BaseModel):
    """Top-level result overview (from report.json)."""
    total_images: int
    clusters: int
    noise_count: int
    noise_ratio: float
    feature_dim: int
    quality: QualityMetrics
    model: str
    feature_weights: Dict[str, float]


# ── Results: Clusters ──

class ClusterTag(BaseModel):
    tag: str
    confidence: float


class ClusterAnalysis(BaseModel):
    """Per-cluster analysis (from cluster_analysis.json)."""
    suggested_name: str
    tags: Dict[str, ClusterTag]
    name_confidence: float
    naming_debug: Optional[List[Dict[str, Any]]] = None
    dominant_features: Optional[List[Dict[str, Any]]] = None
    percentiles: Optional[Dict[str, float]] = None
    distinctiveness_score: Optional[float] = None


class ClusterHealthScore(BaseModel):
    """Per-cluster health."""
    distinctiveness: float
    quality: str
    size: int
    ratio: float


class ClusterHealth(BaseModel):
    """Overall cluster health (from cluster_health.json)."""
    health_score: float
    health_level: str
    silhouette: float
    noise_ratio: float
    cluster_scores: Dict[str, ClusterHealthScore]
    mean_distinctiveness: float
    dead_features: List[str] = []
    low_mi_features: List[Dict[str, Any]] = []
    duplicated_names: Dict[str, int] = {}
    final_quality_score: Optional[float] = None


class ClusterInfo(BaseModel):
    """Cluster summary from report.json cluster_info."""
    count: int
    name: str
    mean_features: Dict[str, float]
    semantic_tags: Optional[List[str]] = None
    suggested_name: Optional[str] = None
    dominant_features: Optional[List[Dict[str, Any]]] = None


class ClusterListItem(BaseModel):
    """A cluster as shown in the Explore sidebar."""
    id: str
    name: str
    count: int
    color: str = "#46f1c5"  # primary teal default
    confidence: float = 0.0
    suggested_name: Optional[str] = None


# ── Results: Embeddings / Atlas ──

class AtlasPoint(BaseModel):
    """Single point on the Explore atlas (from atlas_points.csv)."""
    image_path: str
    cluster_id: int
    cluster_name: str
    umap_x: float
    umap_y: float
    umap_z: float
    thumbnail_path: str = ""


class EmbeddingPoint(BaseModel):
    """UMAP 3D embedding point (from umap_points_3d.csv)."""
    filename: str
    dim_0: float
    dim_1: float
    dim_2: float
    cluster: int


# ── Results: Features ──

class FeatureImportance(BaseModel):
    """Per-cluster feature importance."""
    feature: str
    deviation: float
    cluster_mean: float
    global_mean: float


class FeatureDiagnostic(BaseModel):
    """Per-feature diagnostic stats."""
    mean: float
    std: float
    iqr: float
    variance: float
    is_dead: bool
    mi_score: Optional[float] = None


class FeatureInfo(BaseModel):
    """Feature group metadata."""
    name: str
    enabled: bool
    dims: int
    weight: float
    cluster: bool


# ── Results: Images ──

class ImageInfo(BaseModel):
    """An image in the dataset with its cluster assignment."""
    filename: str
    cluster_id: int
    cluster_name: str
    features: Dict[str, float]
    embedding_3d: Optional[Dict[str, float]] = None


# ── Results: Comparison ──

class RunComparison(BaseModel):
    """Side-by-side pipeline comparison (from clustering_comparison.json)."""
    pipeline_a: Dict[str, Any]
    pipeline_b: Dict[str, Any]
    selected_pipeline: str
    score_a: float
    score_b: float
    reason: str


# ── Session / Workspace ──

class WorkspaceState(BaseModel):
    """Current workspace session (in-memory, not persisted)."""
    active_job_id: Optional[str] = None
    active_dataset: Optional[str] = None
    view: str = Field(default="explore", pattern="^(dataset|explore|review|features|compare)$")
