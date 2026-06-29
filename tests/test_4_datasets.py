"""Benchmark: 跑 4 个测试数据集 (无 DA3) 拿 baseline
"""
import os
import sys
import time
import shutil
from pathlib import Path


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

    # 清理 pycache
    for root, dirs, files in os.walk('lighting_engine'):
        for f in files:
            if f.endswith('.pyc'):
                os.remove(os.path.join(root, f))

    from lighting_engine.core.pipeline import run_pipeline
    import logging
    logging.basicConfig(level=logging.WARNING)

    # 用户提供的 4 个测试数据集（需要将实际图片目录放在项目根目录下）
    test_data = [
        ('ready_for_training_folder', '背景好的二次元插图'),
        ('1_konya_karasue-58', '油亮平涂 (类似 shexyo-47)'),
        ('0514 柔和氛围 softglow', '类似水彩/氛围 (子目录)'),
    ]

    # 测试输入根目录 - 可替换为实际目录
    TEST_INPUT_ROOT = Path(__file__).resolve().parent.parent / "test_datasets"
    TEST_OUTPUT_ROOT = Path(__file__).resolve().parent.parent / "test_outputs"

    FEATURE_GROUPS = {
        'brightness': {'enabled': True, 'dims': 4, 'weight': 1.0, 'cluster': True},
        'lighting': {'enabled': True, 'dims': 4, 'weight': 1.0, 'cluster': True},
        'color': {'enabled': True, 'dims': 3, 'weight': 1.0, 'cluster': True},
        'spatial_lighting': {'enabled': True, 'dims': 5, 'weight': 1.0, 'cluster': True},
    }

    results = []
    for folder, desc in test_data:
        path = TEST_INPUT_ROOT / folder
        if not path.exists():
            print(f'  SKIP: {folder} not found (looked in {TEST_INPUT_ROOT})')
            continue
        out = str(TEST_OUTPUT_ROOT / f'test_v6_{folder.replace(" ", "_").replace(":", "")}')

        if os.path.exists(out):
            shutil.rmtree(out, ignore_errors=True)

        print(f'\n=== {folder} ({desc}) ===')
        t0 = time.time()
        try:
            result = run_pipeline(
                input_folders=[str(path)],
                output_folder=out,
                feature_groups=FEATURE_GROUPS,
                umap_neighbors=15,
                cluster_size_ratio=0.05
            )
            elapsed = time.time() - t0
            n_img = len(result.get('filenames', []))
            n_clusters = result.get('n_clusters', 0)
            noise = result.get('noise_count', 0)
            sil = result.get('quality', {}).get('silhouette_score', 0)
            results.append({
                'folder': folder, 'desc': desc, 'images': n_img,
                'clusters': n_clusters, 'noise': noise, 'silhouette': sil, 'time': elapsed
            })
            print(f'  ✓ 图片={n_img}, 簇={n_clusters}, 噪点={noise}, silhouette={sil:.3f}, 耗时={elapsed:.1f}s')
        except Exception as e:
            print(f'  ✗ FAIL: {e}')

    print('\n' + '=' * 80)
    print('总结 (无 DA3, 16 维特征: 4 brightness + 4 lighting + 3 color + 5 spatial_lighting)')
    print('=' * 80)
    print(f'{"数据集":<35} {"图片":>5} {"簇":>4} {"噪点率":>7} {"silhouette":>10} {"耗时":>7}')
    for r in results:
        noise_rate = r['noise'] / max(1, r['images']) * 100
        print(f'{r["folder"]:<35} {r["images"]:>5} {r["clusters"]:>4} {noise_rate:>6.1f}% {r["silhouette"]:>10.3f} {r["time"]:>6.1f}s')


if __name__ == '__main__':
    main()
