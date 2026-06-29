/**
 * clusteringDictionary.zh — 聚类预设中文文案
 *
 * 所有面向用户的聚类配置名称和说明在此定义。
 */

export interface ClusteringPresetCopy {
  /** 预设中文名称 */
  label_zh: string;
  /** 预设中文说明 */
  description_zh: string;
  /** 预设详细效果说明 */
  detail_zh: string;
  /** 不可用原因（可选） */
  disabledReason?: string;
}

const PRESET_DICT: Record<string, ClusteringPresetCopy> = {
  balanced: {
    label_zh: '默认平衡',
    description_zh: '16 维特征稳定配置，兼顾细节和整体',
    detail_zh: '亮度、色彩、光照、空间特征各维度平衡，适合大部分图片集。',
  },
  finer: {
    label_zh: '更细分组',
    description_zh: '生成更多更小的簇，适合精细分类',
    detail_zh: '降低聚类粒度，把相似但不同的图片分得更细。',
    disabledReason: '需要调整后端聚类参数后才能稳定使用。',
  },
  less_noise: {
    label_zh: '更少噪声',
    description_zh: '减少噪声点和孤立簇',
    detail_zh: '提高噪声容忍度，让更多图片归入可命名簇。',
    disabledReason: '需要调整后端聚类参数后才能稳定使用。',
  },
  brightness_focus: {
    label_zh: '偏亮度',
    description_zh: '侧重亮度分布特征',
    detail_zh: '提高亮度相关维度在聚类中的权重，适合按明暗分类的场景。',
    disabledReason: '需要等后端支持特征权重调整。',
  },
  color_focus: {
    label_zh: '偏色彩',
    description_zh: '侧重色彩和饱和度特征',
    detail_zh: '提高色彩相关维度在聚类中的权重，适合按色调分类的场景。',
    disabledReason: '需要等后端支持特征权重调整。',
  },
  spatial_focus: {
    label_zh: '偏空间光照',
    description_zh: '侧重光照空间分布特征',
    detail_zh: '提高光照重心和分布维度的权重，适合按打光方式分类的场景。',
    disabledReason: '需要等后端支持特征权重调整。',
  },
};

export function getPresetCopy(id: string): ClusteringPresetCopy | undefined {
  return PRESET_DICT[id];
}

export function getPresetLabel(id: string): string {
  return PRESET_DICT[id]?.label_zh ?? id;
}

export default PRESET_DICT;
