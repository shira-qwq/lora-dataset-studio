#!/usr/bin/env python3
"""CLI 入口 — Intrinsic Lighting Embedding Engine v4

用法:
    python -m lighting_engine.main --input 写真test --output lighting_outputs
    python -m lighting_engine.main -i 写真test -i 其他目录 -o ./output
"""

import argparse
import sys
import time
from pathlib import Path

# 确保项目根目录在 sys.path
_project_root = Path(__file__).resolve().parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from lighting_engine.core.config import CONFIG
from lighting_engine.core.pipeline import run_pipeline
from lighting_engine.core.output_writer import write_all
from lighting_engine.utils.utils import setup_logging


def main():
    parser = argparse.ArgumentParser(
        description="Intrinsic Lighting Embedding Engine v4")
    parser.add_argument("-i", "--input", action="append", dest="input_folders",
                        help="输入文件夹（可多次指定）")
    parser.add_argument("-o", "--output", default=None,
                        help="输出目录")
    parser.add_argument("--model", default=None,
                        help="DA3 模型 (默认: DA3-SMALL)")
    parser.add_argument("--umap-neighbors", type=int, default=None,
                        help="UMAP n_neighbors")
    parser.add_argument("--cluster-ratio", type=float, default=None,
                        help="HDBSCAN cluster_size_ratio")
    parser.add_argument("--no-depth", action="store_true",
                        help="(已默认关) 禁用深度特征，保留兼容")
    parser.add_argument("--use-depth", action="store_true",
                        help="显式开启深度特征组 (depth+coupling+depth_gap)。"
                             "默认关：depth MI 仅 1.6% 且 GPU 成本最高 (ALGORITHM_REVIEW §10.1)。"
                             "摄影类数据集可开启。")
    parser.add_argument("--no-coupling", action="store_true",
                        help="禁用耦合特征")
    parser.add_argument("--color-weight", type=float, default=None,
                        help="色彩特征权重 (0.0~2.0)")
    args = parser.parse_args()

    # ── 配置 ──
    # CLI -i 优先；否则用 CONFIG["input_folders"]；都空则回退到 写真test 默认。
    # (修复: 旧写法 `args.input_folders or [...] if CONFIG["input_folders"] else []`
    #  因三元表达式优先级低于 or，当 CONFIG["input_folders"]=[] 时 -i 被静默忽略。)
    input_folders = args.input_folders or list(CONFIG.get("input_folders") or [])
    if not input_folders:
        # 默认用 写真test
        default_input = str(Path(CONFIG["output_folder"]).parent / "写真test")
        if Path(default_input).is_dir():
            input_folders = [default_input]
        else:
            parser.print_help()
            print("\n错误: 请指定 --input 输入文件夹")
            sys.exit(1)

    output_folder = args.output or CONFIG["output_folder"]

    # 特征组覆盖
    feature_groups = dict(CONFIG["feature_groups"])
    # P2: depth 默认关；--use_depth 显式开启 depth+coupling+depth_gap
    if args.use_depth and not args.no_depth:
        feature_groups["depth"]["enabled"] = True
        feature_groups["coupling"]["enabled"] = True
        feature_groups["depth_gap"]["enabled"] = True
    if args.no_depth:
        feature_groups["depth"]["enabled"] = False
        feature_groups["coupling"]["enabled"] = False
        feature_groups["depth_gap"]["enabled"] = False
    if args.no_coupling:
        feature_groups["coupling"]["enabled"] = False
    if args.color_weight is not None:
        feature_groups["color"]["weight"] = max(0.0, min(2.0, args.color_weight))

    kwargs = {}
    if args.model:
        kwargs["model"] = args.model
    if args.umap_neighbors:
        kwargs["umap_neighbors"] = args.umap_neighbors
    if args.cluster_ratio:
        kwargs["cluster_size_ratio"] = args.cluster_ratio

    # ── 日志 ──
    Path(output_folder).mkdir(parents=True, exist_ok=True)
    logger = setup_logging(str(Path(output_folder) / "debug_logs.txt"))
    logger.info("=" * 60)
    logger.info("Intrinsic Lighting Embedding Engine v4 — CLI")
    logger.info("=" * 60)
    logger.info(f"输入: {input_folders}")
    logger.info(f"输出: {output_folder}")
    logger.info(f"特征组: {[k for k, v in feature_groups.items() if v['enabled']]}")

    t_start = time.time()

    try:
        result = run_pipeline(
            input_folders=input_folders,
            output_folder=output_folder,
            feature_groups=feature_groups,
            **kwargs,
        )
        write_all(output_folder, result)

        elapsed = time.time() - t_start
        logger.info(f"✓ 完成！耗时 {elapsed:.1f}s")
        logger.info(f"  {len(result['filenames'])} 张 → {result['n_clusters']} 簇 "
                    f"(噪点: {result['noise_count']})")
        if result["quality"]["silhouette_score"]:
            logger.info(f"  Silhouette={result['quality']['silhouette_score']}")

    except Exception as e:
        logger.exception(f"运行失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
