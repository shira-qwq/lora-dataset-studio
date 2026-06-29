"""Histogram label auto-calibrator (v4.4h-4).

Coarse (binary search / quantile) then Optuna fine-tuning.
Reads histogram_summary.csv, never modifies clustering.
"""

from __future__ import annotations

import copy
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .histogram_label_config import HistogramLabelConfig, DEFAULT_LABEL_CONFIG
from .histogram_residual import compute_label_masks, compute_labels_from_masks

# ============================================================
# Optuna availability
# ============================================================

try:
    import optuna
    OPTUNA_AVAILABLE = True
except ImportError:
    OPTUNA_AVAILABLE = False

# ============================================================
# Constants
# ============================================================

# Default target hit rate ranges
DEFAULT_TARGET_RANGES = {
    "low_key": (0.05, 0.30),
    "high_key": (0.05, 0.30),
    "muted": (0.05, 0.40),
    "vivid": (0.03, 0.25),
    "warm": (0.10, 0.65),
    "cool": (0.10, 0.65),
    "mixed_color": (0.03, 0.15),
    "high_contrast": (0.02, 0.15),
    "flat_light": (0.05, 0.25),
}

CONSERVATIVE_TARGET_RANGES = {
    "low_key": (0.05, 0.25),
    "high_key": (0.05, 0.25),
    "muted": (0.05, 0.25),
    "vivid": (0.02, 0.15),
    "warm": (0.10, 0.60),
    "cool": (0.10, 0.60),
    "mixed_color": (0.02, 0.10),
    "high_contrast": (0.02, 0.10),
    "flat_light": (0.05, 0.20),
}

BROAD_TARGET_RANGES = {
    "low_key": (0.05, 0.40),
    "high_key": (0.05, 0.40),
    "muted": (0.05, 0.40),
    "vivid": (0.03, 0.30),
    "warm": (0.10, 0.70),
    "cool": (0.10, 0.70),
    "mixed_color": (0.03, 0.20),
    "high_contrast": (0.02, 0.20),
    "flat_light": (0.05, 0.30),
}

# Parameters not to auto-calibrate
SKIP_PARAMETERS = {
    "lineart_bright_ratio",
    "lineart_low_sat_ratio",
    "lineart_dark_ratio",
}

# Mapping: label -> parameter name -> field name
SINGLE_FIELD_RULES = [
    ("low_key", "low_key_dark_ratio", "brightness_dark_ratio", "greater"),
    ("high_key", "high_key_bright_ratio", "brightness_bright_ratio", "greater"),
    ("muted", "muted_low_sat_ratio", "saturation_low_ratio", "greater"),
    ("vivid", "vivid_high_sat_ratio", "saturation_high_ratio", "greater"),
    ("warm", "warm_ratio", "hue_warm_ratio", "greater_warm"),
    ("cool", "cool_ratio", "hue_cool_ratio", "greater_cool"),
    ("mixed_color", "mixed_color_entropy", "hue_entropy", "greater_hue"),
    ("flat_light", "flat_light_entropy", "brightness_entropy", "less"),
]

DUAL_FIELD_RULES = [
    ("high_contrast", "high_contrast_dark_ratio", "brightness_dark_ratio",
     "high_contrast_bright_ratio", "brightness_bright_ratio", "both_greater"),
]


# ============================================================
# Label hit rate computation
# ============================================================

def compute_label_rates(df: pd.DataFrame, config: HistogramLabelConfig) -> dict:
    """Return {label: hit_rate} for all heuristic labels."""
    masks = compute_label_masks(df, config)
    n = len(df)
    rates = {}
    for name, mask in masks.items():
        rates[name] = float(np.mean(mask)) if n > 0 else 0.0
    # unclassified
    any_label = np.zeros(n, dtype=bool)
    for name, mask in masks.items():
        if name != "lineart_like_candidate":
            any_label |= mask
    rates["unclassified"] = 1.0 - float(np.mean(any_label))
    return rates


def compute_per_dataset_rates(df_list: List[pd.DataFrame],
                               config: HistogramLabelConfig) -> dict:
    """Return {dataset_idx: {label: rate}}."""
    result = {}
    for idx, df in enumerate(df_list):
        result[idx] = compute_label_rates(df, config)
    return result


# ============================================================
# Hit rate for a specific rule
# ============================================================

def _hit_rate_single(df: pd.DataFrame, field: str, threshold: float,
                      direction: str) -> float:
    """Compute hit rate for a simple field > threshold rule."""
    if direction == "greater":
        mask = df[field].values > threshold
    elif direction == "less":
        mask = df[field].values < threshold
    elif direction.startswith("greater"):
        # warm/cool/mixed_color: require hue_valid (handled in compute_label_masks)
        mask = df[field].values > threshold
    else:
        mask = np.zeros(len(df), dtype=bool)
    return float(np.mean(mask))


def _hit_rate_dual(df: pd.DataFrame, field1: str, thresh1: float,
                    field2: str, thresh2: float) -> float:
    """Hit rate for two-field AND rule."""
    mask = (df[field1].values > thresh1) & (df[field2].values > thresh2)
    return float(np.mean(mask))


# ============================================================
# Objective function
# ============================================================

TARGET_RANGES_PROFILES = {
    "default": DEFAULT_TARGET_RANGES,
    "conservative": CONSERVATIVE_TARGET_RANGES,
    "broad": BROAD_TARGET_RANGES,
}


def score_config(
    config: HistogramLabelConfig,
    df_list: List[pd.DataFrame],
    target_ranges: dict,
    base_config: Optional[HistogramLabelConfig] = None,
    weights: Optional[dict] = None,
) -> float:
    """Score a config; lower is better."""
    penalty = 0.0

    # Merge all dataframes
    df_all = pd.concat(df_list, ignore_index=True)

    # Compute per-dataset rates
    global_rates = compute_label_rates(df_all, config)
    per_ds = compute_per_dataset_rates(df_list, config)

    if weights is None:
        weights = {}

    for label, (tmin, tmax) in target_ranges.items():
        w = weights.get(label, 1.0)
        rate = global_rates.get(label, 0.0)

        # Global rate penalty
        if rate < tmin:
            penalty += ((tmin - rate) / max(tmin, 0.01)) ** 2 * w
        if rate > tmax:
            penalty += ((rate - tmax) / max(tmax, 0.01)) ** 2 * w

        # Per-dataset extreme penalty
        for ds_idx, ds_rates in per_ds.items():
            ds_rate = ds_rates.get(label, 0.0)
            if ds_rate > 0.80:
                ww = 0.25 if label in ("warm", "cool") else 0.5
                penalty += ww
            if ds_rate < 0.005 and tmin >= 0.02:
                penalty += 0.25

    # Warm/cool overlap penalty
    masks_warm = compute_label_masks(df_all, config)
    if "warm" in masks_warm and "cool" in masks_warm:
        overlap = float(np.mean(masks_warm["warm"] & masks_warm["cool"]))
        if overlap > 0.10:
            penalty += (overlap - 0.10) * 2

    # Unclassified penalty
    uc = global_rates.get("unclassified", 0.0)
    if uc > 0.30:
        penalty += (uc - 0.30) * 2

    # Change penalty
    if base_config:
        for field_name in HistogramLabelConfig.__dataclass_fields__.keys():
            if field_name in SKIP_PARAMETERS:
                continue
            old_val = getattr(base_config, field_name)
            new_val = getattr(config, field_name)
            change = abs(new_val - old_val) / max(old_val, 0.01)
            penalty += change * 0.05

    return round(penalty, 4)


# ============================================================
# Coarse calibration: binary search
# ============================================================

def _bisect_threshold(
    df: pd.DataFrame,
    field: str,
    direction: str,
    target_min: float,
    target_max: float,
    initial: float,
    lo: float = 0.01,
    hi: float = 0.95,
    max_iter: int = 32,
) -> Tuple[float, List[dict]]:
    """Binary search for a threshold meeting target_min <= rate <= target_max."""
    steps = []
    t = initial
    for _ in range(max_iter):
        rate = _hit_rate_single(df, field, t, direction)
        steps.append({"threshold": round(t, 4), "rate": round(rate, 4)})
        if target_min <= rate <= target_max:
            break
        if rate < target_min:
            hi = t
            t = (t + lo) / 2
        else:
            lo = t
            t = (t + hi) / 2
    else:
        # Didn't converge; use best within range
        rates = [_hit_rate_single(df, field, th, direction) for th in [initial, t]]
        best = min(zip([initial, t], rates), key=lambda x: abs(x[1] - (target_min + target_max) / 2))
        t = best[0]
    return t, steps


def coarse_calibrate_thresholds(
    df_list: List[pd.DataFrame],
    base_config: HistogramLabelConfig,
    target_ranges: dict,
) -> Tuple[HistogramLabelConfig, List[dict]]:
    """Coarse calibration via quantile then bisect for single-field labels."""
    df_all = pd.concat(df_list, ignore_index=True)
    new_config = copy.deepcopy(base_config)
    all_steps = []

    # Single-field rules
    for label, param, field, direction in SINGLE_FIELD_RULES:
        if param in SKIP_PARAMETERS:
            continue
        tmin, tmax = target_ranges.get(label, (0.05, 0.30))
        initial = getattr(base_config, param)

        # Check if already in range
        rate = _hit_rate_single(df_all, field, initial, direction)
        if tmin <= rate <= tmax:
            all_steps.append({"stage": "coarse", "label": label, "param": param,
                              "threshold": initial, "rate": round(rate, 4),
                              "action": "kept"})
            continue

        # Bisect
        best_t, steps = _bisect_threshold(df_all, field, direction, tmin, tmax, initial)
        for s in steps:
            all_steps.append({"stage": "coarse", "label": label, "param": param,
                              **s, "action": "bisected"})

        new_rate = _hit_rate_single(df_all, field, best_t, direction)
        setattr(new_config, param, best_t)
        all_steps.append({"stage": "coarse", "label": label, "param": param,
                          "threshold": best_t, "rate": round(new_rate, 4),
                          "action": "set"})

    return new_config, all_steps


# ============================================================
# Optuna calibration
# ============================================================

def optuna_calibrate(
    df_list: List[pd.DataFrame],
    coarse_config: HistogramLabelConfig,
    target_ranges: dict,
    base_config: HistogramLabelConfig,
    n_trials: int = 80,
    seed: int = 42,
) -> Tuple[Optional[HistogramLabelConfig], List[dict], Optional[float]]:
    """Optuna fine-tuning around coarse_config."""
    if not OPTUNA_AVAILABLE:
        return None, [], None

    import optuna
    from optuna.trial import TrialState

    param_specs = {
        "low_key_dark_ratio": ("float", 0.20, 0.75, 0.08),
        "high_key_bright_ratio": ("float", 0.20, 0.75, 0.08),
        "muted_low_sat_ratio": ("float", 0.30, 0.90, 0.08),
        "vivid_high_sat_ratio": ("float", 0.05, 0.60, 0.08),
        "warm_ratio": ("float", 0.30, 0.85, 0.08),
        "cool_ratio": ("float", 0.30, 0.85, 0.08),
        "mixed_color_entropy": ("float", 2.50, 4.30, 0.40),
        "high_contrast_dark_ratio": ("float", 0.10, 0.50, 0.08),
        "high_contrast_bright_ratio": ("float", 0.10, 0.50, 0.08),
    }

    all_steps = []

    def objective(trial):
        config = copy.deepcopy(coarse_config)
        for param, (ptype, plo, phi, prange) in param_specs.items():
            cv = getattr(coarse_config, param)
            lo = max(plo, cv - prange)
            hi = min(phi, cv + prange)
            val = trial.suggest_float(param, lo, hi)
            setattr(config, param, val)
        score = score_config(config, df_list, target_ranges, base_config)
        trial.set_user_attr("params", str({p: round(getattr(config, p), 4) for p in param_specs}))
        return score

    study = optuna.create_study(direction="minimize",
                                 sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(objective, n_trials=n_trials)

    best = study.best_trial
    best_config = copy.deepcopy(coarse_config)
    for param in param_specs:
        setattr(best_config, param, best.params.get(param, getattr(coarse_config, param)))

    for t in study.trials:
        if t.state == TrialState.COMPLETE and t.value is not None:
            all_steps.append({"stage": "optuna", "trial": t.number,
                              "value": t.value})

    return best_config, all_steps, best.value


# ============================================================
# High-contrast grid search
# ============================================================

def coarse_calibrate_high_contrast(
    df_list: List[pd.DataFrame],
    base_config: HistogramLabelConfig,
    target_ranges: dict,
) -> Tuple[float, float, List[dict]]:
    """Grid search for high_contrast dark/bright thresholds."""
    df_all = pd.concat(df_list, ignore_index=True)
    tmin, tmax = target_ranges.get("high_contrast", (0.02, 0.15))
    base_dark = base_config.high_contrast_dark_ratio
    base_bright = base_config.high_contrast_bright_ratio
    steps = []

    candidates = []
    for dark in np.arange(max(0.10, base_dark - 0.10), min(0.50, base_dark + 0.10) + 0.001, 0.025):
        for bright in np.arange(max(0.10, base_bright - 0.10), min(0.50, base_bright + 0.10) + 0.001, 0.025):
            rate = _hit_rate_dual(df_all, "brightness_dark_ratio", dark,
                                   "brightness_bright_ratio", bright)
            score = 0
            if rate < tmin:
                score += (tmin - rate) ** 2 * 100
            if rate > tmax:
                score += (rate - tmax) ** 2 * 100
            candidates.append((score, dark, bright, rate))

    candidates.sort(key=lambda x: x[0])
    best = candidates[0]
    steps.append({"stage": "coarse", "label": "high_contrast",
                  "dark": round(best[1], 4), "bright": round(best[2], 4),
                  "rate": round(best[3], 4), "score": round(best[0], 4)})
    return best[1], best[2], steps
