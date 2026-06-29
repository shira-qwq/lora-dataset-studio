"""
README_OUTPUT.txt — 输出目录说明文件生成器

每个 output_root 在首次分析完成后生成此文件。
"""

README_OUTPUT_CONTENT = """\
这是 Dataset Intelligence Studio / 光影分类 的分析输出目录。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
目录说明
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports/
  这里是用户导出的图片结果。
  每个子文件夹是一组导出图片。
  子文件夹里只放图片文件，不包含其他文件。

_studio/
  软件内部分析数据和导出记录。
  包括特征数据、聚类结果、巡检结果、运行日志、导出清单。
  一般不需要手动修改。

_cache/
  缓存目录。目前包含缩略图缓存。
  缓存可以删除。删除后软件会重新生成缩略图缓存，
  但删除后首次打开页面会变慢（需要重新生成缩略图）。

reports/
  用户主动生成的报告文件（如有）。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
重要文件位置
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_studio/run_config.json
  本次分析配置（聚类预设、特征权重、参数）

_studio/image_index.json
  原图索引（图片 ID、路径、尺寸、文件大小）

_studio/features/features.csv
  每张图片的 16 维视觉特征

_studio/inspection/inspection_manifest.json
  图片巡检结果（切片、排序、命中）

_studio/export_records/*.json
  每次导出的详细记录（原图路径、导出文件名、重命名规则等）

exports/*/
  导出的图片文件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
说明
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _studio/ 目录下的文件由软件自动管理，手动修改可能导致异常。
- _cache/ 目录下的文件可以随时删除，不会损坏数据。
- 如果需要备份，请备份 exports/ 目录下的导出图片。
- 如果不再需要本次分析，可以直接删除整个目录。

Dataset Intelligence Studio / 光影分类
"""


def ensure_readme_output(output_root) -> bool:
    """在 output_root 下生成 README_OUTPUT.txt（如果不存在）"""
    if not output_root:
        return False
    target = output_root / "README_OUTPUT.txt"
    if target.exists():
        return True  # already exists
    try:
        target.write_text(README_OUTPUT_CONTENT, encoding="utf-8")
        return True
    except OSError:
        return False
