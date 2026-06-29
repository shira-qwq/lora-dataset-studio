# DEPENDENCY_AUDIT_CN

- 扫描文件数: 123
- 运行时包数: 15
- 开发/测试包数: 10
- 可选包数: 2

## 运行时依赖
- `fastapi`: light_analysis_engine/workspace/export_resolver.py, light_analysis_engine/workspace/media_resolver.py, light_analysis_engine/workspace/runtime.py, studio/api/app.py, studio/api/routers/analysis.py, studio/api/routers/duplicate_groups.py, studio/api/routers/exports.py, studio/api/routers/jobs.py, studio/api/routers/recluster.py, studio/api/routers/results.py, studio/api/routers/reviews.py
- `hdbscan`: light_analysis_engine/pipeline.py, lighting_engine/core/cluster_comparison.py, lighting_engine/core/cluster_health.py, lighting_engine/core/experiments/residual_refine.py, lighting_engine/core/pipeline.py, lighting_engine/core/recluster.py
- `imagehash`: lighting_engine/core/quality/hash_duplicate.py
- `matplotlib`: light_analysis_engine/output_writer.py, lighting_engine/core/output_writer.py
- `numpy`: light_analysis_engine/coupling_features.py, light_analysis_engine/depth_module.py, light_analysis_engine/feature_extractor.py, light_analysis_engine/output_writer.py, light_analysis_engine/pipeline.py, light_analysis_engine/preprocess.py, lighting_engine/core/analysis_channels/basic_metadata.py, lighting_engine/core/analysis_channels/histogram_label_calibrator.py, lighting_engine/core/analysis_channels/histogram_residual.py, lighting_engine/core/analysis_channels/quality_edge.py, lighting_engine/core/cluster_analyzer.py, lighting_engine/core/cluster_comparison.py, lighting_engine/core/cluster_health.py, lighting_engine/core/cluster_namer.py, lighting_engine/core/diagnostics/histogram_shape.py, lighting_engine/core/experiments/residual_refine.py, lighting_engine/core/feature_assembler.py, lighting_engine/core/feature_diagnostic.py, lighting_engine/core/feature_plugins/brightness.py, lighting_engine/core/feature_plugins/color.py, lighting_engine/core/feature_plugins/lighting.py, lighting_engine/core/feature_plugins/spatial_lighting.py, lighting_engine/core/feature_reliability.py, lighting_engine/core/output_writer.py, lighting_engine/core/pipeline.py, lighting_engine/core/preprocess.py, lighting_engine/core/quality/blur.py, lighting_engine/core/quality_metrics.py, lighting_engine/core/recluster.py, lighting_engine/core/redundant_detector.py, lighting_engine/utils/cache_manager.py, studio/api/routers/analysis.py
- `opencv-python`: light_analysis_engine/coupling_features.py, light_analysis_engine/depth_module.py, light_analysis_engine/feature_extractor.py, light_analysis_engine/output_writer.py, light_analysis_engine/preprocess.py, lighting_engine/core/analysis_channels/histogram_residual.py, lighting_engine/core/analysis_channels/quality_edge.py, lighting_engine/core/feature_assembler.py, lighting_engine/core/feature_plugins/color.py, lighting_engine/core/feature_plugins/lighting.py, lighting_engine/core/feature_plugins/spatial_lighting.py, lighting_engine/core/output_writer.py, lighting_engine/core/pipeline.py, lighting_engine/core/preprocess.py, lighting_engine/core/quality/blur.py
- `pandas`: light_analysis_engine/output_writer.py, lighting_engine/core/analysis_channels/histogram_label_calibrator.py, lighting_engine/core/analysis_channels/histogram_residual.py, lighting_engine/core/analysis_channels/quality_edge.py, lighting_engine/core/experiments/residual_refine.py, lighting_engine/core/output_writer.py, lighting_engine/core/recluster.py, studio/api/routers/analysis.py, studio/api/routers/duplicate_groups.py, studio/api/routers/recluster.py
- `Pillow`: light_analysis_engine/workspace/media_resolver.py, lighting_engine/core/analysis_channels/basic_metadata.py, lighting_engine/core/quality/hash_duplicate.py, studio/api/routers/results.py
- `plotly`: lighting_engine/core/output_writer.py
- `pydantic`: studio/api/routers/jobs.py, studio/api/routers/recluster.py, studio/api/schemas.py
- `scikit-learn`: light_analysis_engine/pipeline.py, lighting_engine/core/cluster_comparison.py, lighting_engine/core/cluster_health.py, lighting_engine/core/experiments/residual_refine.py, lighting_engine/core/feature_diagnostic.py, lighting_engine/core/feature_reliability.py, lighting_engine/core/pipeline.py, lighting_engine/core/quality_metrics.py, lighting_engine/core/recluster.py
- `scipy`: lighting_engine/core/cluster_health.py
- `torch`: light_analysis_engine/depth_module.py
- `tqdm`: light_analysis_engine/depth_module.py, light_analysis_engine/feature_extractor.py, light_analysis_engine/pipeline.py, light_analysis_engine/preprocess.py, lighting_engine/core/feature_assembler.py, lighting_engine/core/preprocess.py
- `umap-learn`: light_analysis_engine/pipeline.py, lighting_engine/core/experiments/residual_refine.py, lighting_engine/core/pipeline.py, lighting_engine/core/recluster.py

## 开发/测试依赖
- `fastapi`: tests/test_analysis_api.py, tests/test_organize_state_api.py, tests/test_pipeline_and_worker_fixes.py, tests/test_recluster_preview.py
- `hdbscan`: tools/analyze_feature_importance.py, tools/audit_reproducibility.py, tools/optimize_algorithm_recipe.py, tools/tune_algorithm_recipes.py, tools/validate_default_config_stability.py
- `numpy`: tests/test_algorithm_recipe_tuner.py, tests/test_analysis_api.py, tests/test_features_basic.py, tests/test_hash_duplicate.py, tests/test_histogram_acceptance.py, tests/test_histogram_label_ab_compare.py, tests/test_histogram_label_calibrator.py, tests/test_histogram_residual_channel.py, tests/test_histogram_summary_api.py, tests/test_optuna_recipe_optimizer.py, tests/test_pipeline_and_worker_fixes.py, tests/test_quality_edge_channel.py, tests/test_recluster_preview.py, tests/test_residual_refine_experiment.py, tools/analyze_feature_importance.py, tools/audit_reproducibility.py, tools/build_histogram_channel.py, tools/compare_histogram_label_configs.py, tools/experiment_residual_refine.py, tools/optimize_algorithm_recipe.py, tools/tune_algorithm_recipes.py, tools/validate_default_config_stability.py, tools/validate_histogram_channel_acceptance.py
- `opencv-python`: tests/test_features_basic.py, tools/tune_algorithm_recipes.py
- `pandas`: tests/test_analysis_api.py, tests/test_histogram_acceptance.py, tests/test_histogram_label_ab_compare.py, tests/test_histogram_label_calibrator.py, tests/test_histogram_residual_channel.py, tests/test_histogram_summary_api.py, tests/test_quality_edge_channel.py, tests/test_recluster_preview.py, tests/test_residual_refine_experiment.py, tools/build_basic_metadata_channel.py, tools/build_histogram_channel.py, tools/build_quality_edge_channel.py, tools/calibrate_histogram_labels.py, tools/compare_histogram_label_configs.py, tools/experiment_residual_refine.py, tools/validate_histogram_channel_acceptance.py
- `Pillow`: tests/test_analysis_api.py, tests/test_features_basic.py, tests/test_hash_duplicate.py, tests/test_histogram_residual_channel.py, tests/test_media_resolver.py, tests/test_quality_edge_channel.py, tests/test_validation_sample_set.py, tools/build_validation_sample_set.py
- `pytest`: tests/test_algorithm_recipe_tuner.py, tests/test_analysis_api.py, tests/test_features_basic.py, tests/test_hash_duplicate.py, tests/test_histogram_acceptance.py, tests/test_histogram_label_ab_compare.py, tests/test_histogram_label_calibrator.py, tests/test_histogram_residual_channel.py, tests/test_histogram_summary_api.py, tests/test_optuna_recipe_optimizer.py, tests/test_quality_edge_channel.py, tests/test_recluster_preview.py, tests/test_residual_refine_experiment.py, tests/test_validation_sample_set.py
- `requests`: tests/test_smoke.py
- `scikit-learn`: tools/analyze_feature_importance.py, tools/audit_reproducibility.py, tools/optimize_algorithm_recipe.py, tools/tune_algorithm_recipes.py, tools/validate_default_config_stability.py
- `umap-learn`: tools/analyze_feature_importance.py, tools/audit_reproducibility.py, tools/optimize_algorithm_recipe.py, tools/tune_algorithm_recipes.py, tools/validate_default_config_stability.py

## 可选依赖
- `optuna`: lighting_engine/core/analysis_channels/histogram_label_calibrator.py, tests/test_optuna_recipe_optimizer.py, tools/optimize_algorithm_recipe.py
- `PyQt6`: lighting_engine/gui_main.py

## 未映射导入
- `blake3`: lighting_engine/core/quality/hash_duplicate.py
- `depth_anything_3`: light_analysis_engine/depth_module.py
- `onnxruntime`: lighting_engine/core/analysis_channels/plugins/wd14_probe.py
- `tensorflow`: lighting_engine/core/analysis_channels/plugins/wd14_probe.py

## 说明
- `cv2` 映射为 `opencv-python`。
- `PIL` 映射为 `Pillow`。
- `sklearn` 映射为 `scikit-learn`。
- `umap` 映射为 `umap-learn`。
- `PyQt6` 只在 GUI 入口使用，不写入运行时 requirements。
- `optuna` 只在工具/实验路径出现，视为可选依赖。
