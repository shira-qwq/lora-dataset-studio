"""Configurable heuristic thresholds for histogram labels.

Default values come from v4.4h-4/v4.4h-5 auto-calibration + A/B validation
across 5 real datasets (1035 images total). The suggested config was validated
as safe (changed_image_ratio=23.2%, all label targets within range).

Source: _histogram_label_calibration/v1/histogram_label_config_suggested.json
Validation: v4.4h-5 A/B compare (docs/HISTOGRAM_LABEL_AB_VALIDATION_V1.md)

Modify these to tune label sensitivity without changing clustering.
"""

from dataclasses import dataclass, asdict


@dataclass
class HistogramLabelConfig:
    """Configurable thresholds for histogram-based heuristic labels.

    All values are from auto-calibration (Optuna, 40 trials) and A/B validated.
    Do NOT add histogram fields to clustering feature groups.
    """

    # Brightness labels
    low_key_dark_ratio: float = 0.4144
    high_key_bright_ratio: float = 0.4086
    high_contrast_dark_ratio: float = 0.2124
    high_contrast_bright_ratio: float = 0.2005
    flat_light_entropy: float = 3.0

    # Saturation labels
    muted_low_sat_ratio: float = 0.5867
    vivid_high_sat_ratio: float = 0.2738

    # Hue labels
    warm_ratio: float = 0.5802
    cool_ratio: float = 0.5645
    mixed_color_entropy: float = 3.446

    # Lineart candidate (NOT auto-calibrated, kept at original values)
    # Hidden from default frontend filters due to <3% hit rate.
    lineart_bright_ratio: float = 0.55
    lineart_low_sat_ratio: float = 0.60
    lineart_dark_ratio: float = 0.03

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_LABEL_CONFIG = HistogramLabelConfig()
