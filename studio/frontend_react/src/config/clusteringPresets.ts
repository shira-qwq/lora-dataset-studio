/**
 * clusteringPresets — 聚类预设配置定义
 *
 * 定义可选的聚类预设，标记是否已接入后端。
 * 未接后端的预设会显示为 disabled / experimental。
 */

export interface ClusteringPreset {
  /** 预设 ID */
  id: string;
  /** 是否已对接后端 */
  backendReady: boolean;
  /** 是否是实验性（显示实验标记） */
  experimental?: boolean;
  /** 对应的 recipe_name（后端参数） */
  recipeName?: string;
  /** 默认选中 */
  defaultSelected?: boolean;
}

export const CLUSTERING_PRESETS: ClusteringPreset[] = [
  {
    id: 'balanced',
    backendReady: true,
    recipeName: 'default_legacy16_raw_015',
    defaultSelected: true,
  },
  {
    id: 'finer',
    backendReady: false,
    experimental: false,
  },
  {
    id: 'less_noise',
    backendReady: false,
    experimental: false,
  },
  {
    id: 'brightness_focus',
    backendReady: false,
    experimental: true,
  },
  {
    id: 'color_focus',
    backendReady: false,
    experimental: true,
  },
  {
    id: 'spatial_focus',
    backendReady: false,
    experimental: true,
  },
];

/** 高级配置参数定义 */
export interface AdvancedParam {
  key: string;
  label_zh: string;
  description_zh: string;
  type: 'number' | 'select';
  default: number | string;
  options?: { value: string; label: string }[];
  disabled?: boolean;
}

export const ADVANCED_PARAMS: AdvancedParam[] = [
  {
    key: 'cluster_size_ratio',
    label_zh: '最小簇比例',
    description_zh: '低于此比例的簇标记为噪声。值越大，小簇越容易被归入噪声。',
    type: 'number',
    default: 0.015,
    disabled: true,
  },
  {
    key: 'noise_tolerance',
    label_zh: '噪声容忍',
    description_zh: '控制 HDBSCAN 将点归为噪声的倾向。值越小噪声越少，但可能合并不相似的簇。',
    type: 'number',
    default: 0.5,
    disabled: true,
  },
  {
    key: 'min_cluster_size',
    label_zh: '分组粒度',
    description_zh: '每个簇的最小图片数。值越大簇越少越粗，值越小簇越多越细。',
    type: 'number',
    default: 30,
    disabled: true,
  },
  {
    key: 'umap_neighbors',
    label_zh: 'UMAP 邻居数',
    description_zh: 'UMAP 降维时考虑的邻居数量。值越大越保留全局结构，值越小越保留局部细节。',
    type: 'number',
    default: 15,
    disabled: true,
  },
];
