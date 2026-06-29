"""Feature Preset 系统 — v5

每个预设定义一组特征组合（启用/禁用 + 权重），一键切换实验方向。
选择后自动联动 GUI 勾选框和权重滑块，用户可进一步微调转为 custom。
"""

PRESETS = {
    "lighting": {
        "brightness": {"enabled": True, "weight": 1.0},
        "lighting":   {"enabled": True, "weight": 1.0},
        "color":      {"enabled": False, "weight": 0.0},
        "depth":      {"enabled": True, "weight": 1.0},
        "coupling":   {"enabled": True, "weight": 1.0},
    },
    "color": {
        "brightness": {"enabled": True, "weight": 0.5},
        "lighting":   {"enabled": False, "weight": 0.0},
        "color":      {"enabled": True, "weight": 1.5},
        "depth":      {"enabled": False, "weight": 0.0},
        "coupling":   {"enabled": False, "weight": 0.0},
    },
    "geometry": {
        "brightness": {"enabled": False, "weight": 0.0},
        "lighting":   {"enabled": False, "weight": 0.0},
        "color":      {"enabled": False, "weight": 0.0},
        "depth":      {"enabled": True, "weight": 1.0},
        "coupling":   {"enabled": True, "weight": 1.0},
    },
    "full": {
        "brightness": {"enabled": True, "weight": 1.0},
        "lighting":   {"enabled": True, "weight": 1.0},
        "color":      {"enabled": True, "weight": 1.0},
        "depth":      {"enabled": True, "weight": 1.0},
        "coupling":   {"enabled": True, "weight": 1.0},
    },
    # custom = 用户手动调整，空字典表示继承上次状态
    "custom": {},
}


def apply_preset(preset_name: str,
                 current_feature_groups: dict = None) -> dict:
    """应用预设到当前特征组配置

    参数:
        preset_name: 预设名称 (lighting/color/geometry/full/custom)
        current_feature_groups: 当前特征组状态（custom 时保持）

    返回:
        更新后的 feature_groups 字典
    """
    if preset_name == "custom" and current_feature_groups is not None:
        return dict(current_feature_groups)

    preset = PRESETS.get(preset_name)
    if preset is None:
        raise ValueError(f"未知预设: {preset_name}，可选: {list(PRESETS.keys())}")

    # 深拷贝
    result = {}
    for name, config in preset.items():
        result[name] = {
            "enabled": config["enabled"],
            "dims": config.get("dims", 2),
            "weight": config["weight"],
        }
    return result
