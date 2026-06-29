/**
 * runConfig.ts — P11-002: Analysis run config contract.
 *
 * Describes the full configuration for an analysis job.
 * Frontend builds this and sends it to the backend via submitJob.
 */
import { getFeatureKeys } from './featureSchema';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AnalysisRunConfig {
  version: 1;
  clustering_preset_id: string;
  clustering: {
    feature_weights: Record<string, number>;
    umap?: {
      n_neighbors?: number;
      min_dist?: number;
    };
    hdbscan?: {
      min_cluster_size?: number;
      min_samples?: number | null;
      cluster_selection_method?: 'eom' | 'leaf';
      cluster_selection_epsilon?: number;
    };
    postprocess?: {
      min_cluster_images?: number;
      max_noise_ratio?: number;
    };
  };
  analysis_channels: {
    basic_metadata: boolean;
    histogram: boolean;
    quality_edge: boolean;
    duplicate_detection: boolean;
  };
  output: {
    generate_thumbnails: boolean;
    thumbnail_long_edge: number;
    write_run_config: boolean;
  };
}

export interface PresetDefinition {
  id: string;
  label_zh: string;
  description_zh: string;
  detail_zh: string;
  /** What this preset changes compared to balanced */
  changes_zh: string[];
  /** Risk or trade-off */
  risk_zh?: string[];
  buildConfig: () => AnalysisRunConfig;
}

// ─── Preset builder helpers ────────────────────────────────────────────────

function allWeights(v: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (const k of getFeatureKeys()) r[k] = v;
  return r;
}

function groupWeights(overrides: Record<string, number>): Record<string, number> {
  return { ...allWeights(1.0), ...overrides };
}

// ─── Presets ───────────────────────────────────────────────────────────────

export const ANALYSIS_PRESETS: PresetDefinition[] = [
  {
    id: 'balanced',
    label_zh: '默认平衡',
    description_zh: '16 维特征稳定配置，兼顾细节和整体',
    detail_zh: '亮度、色彩、光照、边缘特征各维度平衡，适合大部分图片集。',
    changes_zh: ['所有特征权重相等（1.0）', 'HDBSCAN min_cluster_size=6', 'UMAP n_neighbors=15'],
    buildConfig: () => ({
      version: 1,
      clustering_preset_id: 'balanced',
      clustering: {
        feature_weights: allWeights(1.0),
        umap: { n_neighbors: 15, min_dist: 0.1 },
        hdbscan: { min_cluster_size: 6, min_samples: 3, cluster_selection_method: 'eom' },
        postprocess: { min_cluster_images: 3, max_noise_ratio: 0.3 },
      },
      analysis_channels: { basic_metadata: true, histogram: true, quality_edge: true, duplicate_detection: true },
      output: { generate_thumbnails: true, thumbnail_long_edge: 384, write_run_config: true },
    }),
  },
  {
    id: 'fine',
    label_zh: '更细分组',
    description_zh: '生成更多更小的簇，适合精细分类',
    detail_zh: '降低聚类粒度，把相似但不同的图片分得更细。适合风格差异较多的数据集。',
    changes_zh: [
      'HDBSCAN min_cluster_size 从 6 降至 4',
      'HDBSCAN min_samples 从 3 降至 2',
      'UMAP n_neighbors 从 15 降至 12',
    ],
    risk_zh: ['噪声点可能增加', '小簇数量增多，人工整理工作量可能增加'],
    buildConfig: () => ({
      version: 1,
      clustering_preset_id: 'fine',
      clustering: {
        feature_weights: allWeights(1.0),
        umap: { n_neighbors: 12, min_dist: 0.08 },
        hdbscan: { min_cluster_size: 4, min_samples: 2, cluster_selection_method: 'eom' },
        postprocess: { min_cluster_images: 2, max_noise_ratio: 0.4 },
      },
      analysis_channels: { basic_metadata: true, histogram: true, quality_edge: true, duplicate_detection: true },
      output: { generate_thumbnails: true, thumbnail_long_edge: 384, write_run_config: true },
    }),
  },
  {
    id: 'coarse_low_noise',
    label_zh: '更少噪声',
    description_zh: '减少噪声点和孤立簇，合成更稳的大组',
    detail_zh: '提高聚类粒度和噪声容忍，让更多图片归入可命名的大簇。适合分布稀疏或多个小簇的数据集。',
    changes_zh: [
      'HDBSCAN min_cluster_size 从 6 升至 10',
      'HDBSCAN min_samples 从 3 升至 5',
      'UMAP n_neighbors 从 15 升至 20',
    ],
    risk_zh: ['可能合并不相似的图片', '细节分组可能丢失'],
    buildConfig: () => ({
      version: 1,
      clustering_preset_id: 'coarse_low_noise',
      clustering: {
        feature_weights: allWeights(1.0),
        umap: { n_neighbors: 20, min_dist: 0.15 },
        hdbscan: { min_cluster_size: 10, min_samples: 5, cluster_selection_method: 'eom' },
        postprocess: { min_cluster_images: 5, max_noise_ratio: 0.15 },
      },
      analysis_channels: { basic_metadata: true, histogram: true, quality_edge: true, duplicate_detection: true },
      output: { generate_thumbnails: true, thumbnail_long_edge: 384, write_run_config: true },
    }),
  },
  {
    id: 'color_tone',
    label_zh: '偏色彩 / 色调',
    description_zh: '更重视主色、冷暖、饱和度等色彩特征',
    detail_zh: '提高色彩相关维度在聚类中的权重，适合按色调、饱和度和冷暖氛围分类的场景。',
    changes_zh: [
      '色彩维度（warm_cool_bias、saturation_mean 等 7 维）权重提高到 1.8',
      '亮度和边缘维度权重保持 1.0',
      '聚类更倾向于区分不同色调的图片',
    ],
    risk_zh: ['明暗相似的图片可能被分散到不同簇', '亮度差异大的同色调图片可能聚在一起'],
    buildConfig: () => ({
      version: 1,
      clustering_preset_id: 'color_tone',
      clustering: {
        feature_weights: groupWeights({
          warm_cool_bias: 1.8,
          saturation_mean: 1.8,
          saturation_std: 1.5,
          warm_cool_bias_weighted: 1.8,
          low_saturation_ratio: 1.5,
          high_saturation_ratio: 1.5,
          dominant_hue_strength: 1.5,
        }),
        umap: { n_neighbors: 15, min_dist: 0.1 },
        hdbscan: { min_cluster_size: 6, min_samples: 3, cluster_selection_method: 'eom' },
        postprocess: { min_cluster_images: 3, max_noise_ratio: 0.3 },
      },
      analysis_channels: { basic_metadata: true, histogram: true, quality_edge: true, duplicate_detection: true },
      output: { generate_thumbnails: true, thumbnail_long_edge: 384, write_run_config: true },
    }),
  },
  {
    id: 'lighting_brightness',
    label_zh: '偏明暗 / 光照',
    description_zh: '更重视亮度、对比度、边缘结构等明暗特征',
    detail_zh: '提高亮度和光照边缘维度权重，适合按打光方式、明暗氛围分类的场景。',
    changes_zh: [
      '亮度维度（brightness_mean、brightness_std 等 5 维）权重提高到 1.8',
      '光照边缘维度（contrast、edge_strength 等 4 维）权重提高到 1.5',
      '色彩维度权重保持 1.0',
      '聚类更倾向于区分不同打光方式的图片',
    ],
    risk_zh: ['色彩相似的图片可能被分散', '同亮度不同色调的图片可能聚在一起'],
    buildConfig: () => ({
      version: 1,
      clustering_preset_id: 'lighting_brightness',
      clustering: {
        feature_weights: groupWeights({
          brightness_mean: 1.8,
          brightness_std: 1.8,
          brightness_p10: 1.5,
          brightness_p90: 1.5,
          brightness_skewness: 1.5,
          contrast: 1.5,
          highlight_threshold: 1.3,
          edge_strength_mean: 1.3,
          edge_strength_std: 1.3,
        }),
        umap: { n_neighbors: 15, min_dist: 0.1 },
        hdbscan: { min_cluster_size: 6, min_samples: 3, cluster_selection_method: 'eom' },
        postprocess: { min_cluster_images: 3, max_noise_ratio: 0.3 },
      },
      analysis_channels: { basic_metadata: true, histogram: true, quality_edge: true, duplicate_detection: true },
      output: { generate_thumbnails: true, thumbnail_long_edge: 384, write_run_config: true },
    }),
  },
];

export function getPresetById(id: string): PresetDefinition | undefined {
  return ANALYSIS_PRESETS.find((p) => p.id === id);
}

export const DEFAULT_PRESET_ID = 'balanced';
