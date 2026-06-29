"""Recipe data structures for recluster preview (v4.5).

Defines built-in recipes and the recipe schema used by the
recluster preview system. Recipes do NOT modify the default config.
"""

from typing import Dict, List, Optional


BUILTIN_RECIPES = {
    "default_legacy16_raw_015": {
        "recipe_name": "default_legacy16_raw_015",
        "description": "Current stable default: legacy 16-dim, raw warm_cool, CSR=0.015",
        "is_default": True,
        "selected_feature_indices": [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 16, 17, 18, 19],
        "extra_features": ["legacy_warm_cool_bias"],
        "group_weights": {
            "brightness": 1.0,
            "lighting": 1.0,
            "color": 1.0,
            "spatial_lighting": 1.0,
        },
        "umap": {
            "n_components": 5,
            "n_neighbors": 50,
            "min_dist": 0.05,
            "metric": "euclidean",
            "random_state": 42,
        },
        "hdbscan": {
            "cluster_selection_method": "eom",
            "metric": "euclidean",
            "cluster_size_ratio": 0.015,
            "min_samples_ratio": 0.3,
        },
    },
    "preview_high_granularity": {
        "recipe_name": "preview_high_granularity",
        "description": "Higher granularity: smaller clusters, more splits. Preview only.",
        "is_default": False,
        "selected_feature_indices": [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 16, 17, 18, 19],
        "extra_features": ["legacy_warm_cool_bias"],
        "group_weights": {
            "brightness": 1.0,
            "lighting": 1.0,
            "color": 1.0,
            "spatial_lighting": 1.0,
        },
        "umap": {
            "n_components": 5,
            "n_neighbors": 30,
            "min_dist": 0.02,
            "metric": "euclidean",
            "random_state": 42,
        },
        "hdbscan": {
            "cluster_selection_method": "eom",
            "metric": "euclidean",
            "cluster_size_ratio": 0.008,
            "min_samples_ratio": 0.2,
        },
    },
    "preview_low_granularity": {
        "recipe_name": "preview_low_granularity",
        "description": "Lower granularity: fewer, larger clusters. Preview only.",
        "is_default": False,
        "selected_feature_indices": [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 16, 17, 18, 19],
        "extra_features": ["legacy_warm_cool_bias"],
        "group_weights": {
            "brightness": 1.0,
            "lighting": 1.0,
            "color": 1.0,
            "spatial_lighting": 1.0,
        },
        "umap": {
            "n_components": 5,
            "n_neighbors": 80,
            "min_dist": 0.1,
            "metric": "euclidean",
            "random_state": 42,
        },
        "hdbscan": {
            "cluster_selection_method": "eom",
            "metric": "euclidean",
            "cluster_size_ratio": 0.03,
            "min_samples_ratio": 0.5,
        },
    },
}


FEATURE_NAMES_20 = [
    "brightness_mean", "brightness_std", "brightness_p10", "brightness_p90", "brightness_skewness",
    "contrast", "highlight_threshold", "edge_strength_mean", "edge_strength_std",
    "warm_cool_bias_weighted", "saturation_mean", "saturation_std",
    "low_saturation_ratio", "high_saturation_ratio", "dominant_hue_strength",
    "light_centroid_x", "light_centroid_y", "light_spread", "light_concentration", "light_asymmetry",
]


def get_builtin_recipe(name: str) -> Optional[dict]:
    """Get a built-in recipe by name. Returns None if not found."""
    return BUILTIN_RECIPES.get(name)


def get_builtin_recipe_names() -> List[str]:
    """Return all built-in recipe names."""
    return list(BUILTIN_RECIPES.keys())


def get_selected_feature_names(recipe: dict) -> List[str]:
    """Return human-readable feature names for a recipe's selected indices + extras."""
    indices = recipe.get("selected_feature_indices", [])
    names = [FEATURE_NAMES_20[i] for i in indices]
    for extra in recipe.get("extra_features", []):
        names.append(extra)
    return names


def validate_recipe(recipe: dict) -> List[str]:
    """Validate a recipe dict. Returns list of error messages (empty = valid)."""
    errors = []
    required_keys = ["recipe_name", "selected_feature_indices", "group_weights", "umap", "hdbscan"]
    for key in required_keys:
        if key not in recipe:
            errors.append(f"Missing required key: {key}")
    if "cluster_size_ratio" not in recipe.get("hdbscan", {}):
        errors.append("hdbscan.cluster_size_ratio is required")
    if "random_state" not in recipe.get("umap", {}):
        errors.append("umap.random_state is required")
    # Check indices
    indices = recipe.get("selected_feature_indices", [])
    for idx in indices:
        if not isinstance(idx, int) or idx < 0 or idx >= 20:
            errors.append(f"Invalid feature index: {idx}")
    # Check that metadata-only features are not selected
    forbidden = {12, 13, 14}  # low_sat, high_sat, dominant_hue
    selected = set(indices)
    overlap = selected & forbidden
    if overlap:
        names = [FEATURE_NAMES_20[i] for i in overlap]
        errors.append(f"Metadata-only features must not be in selected features: {names}")
    return errors
