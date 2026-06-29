/**
 * featureSchema.ts — P11-002: authoritative 16-dim feature definitions.
 *
 * Mirrors the actual feature names from lighting_engine/core/feature_assembler.py.
 * Any mismatch with features.csv must be caught at job start.
 */
export interface FeatureDimension {
  key: string;
  zh_name: string;
  description: string;
  group: 'brightness' | 'lighting' | 'color';
}

export const FEATURE_SCHEMA: FeatureDimension[] = [
  // ── Brightness (5) ─────────────────────────────────────────────────
  { key: 'brightness_mean',       zh_name: '平均亮度',     description: '整体明亮程度',           group: 'brightness' },
  { key: 'brightness_std',        zh_name: '亮度标准差',   description: '亮度分布的分散程度',     group: 'brightness' },
  { key: 'brightness_p10',        zh_name: '亮度 P10',     description: '最暗 10% 像素的平均亮度', group: 'brightness' },
  { key: 'brightness_p90',        zh_name: '亮度 P90',     description: '最亮 10% 像素的平均亮度', group: 'brightness' },
  { key: 'brightness_skewness',   zh_name: '亮度偏度',     description: '亮度分布偏向暗部还是亮部', group: 'brightness' },

  // ── Lighting / Edge (4) ────────────────────────────────────────────
  { key: 'contrast',              zh_name: '对比度',       description: '明暗反差大小',           group: 'lighting' },
  { key: 'highlight_threshold',   zh_name: '高光阈值',     description: '高光区域判定阈值',       group: 'lighting' },
  { key: 'edge_strength_mean',    zh_name: '平均边缘强度', description: '画面清晰/模糊程度',     group: 'lighting' },
  { key: 'edge_strength_std',     zh_name: '边缘强度标准差', description: '边缘分布的均匀性',     group: 'lighting' },

  // ── Color (7) ──────────────────────────────────────────────────────
  { key: 'warm_cool_bias',        zh_name: '冷暖倾向',     description: '整体色调偏暖还是偏冷',   group: 'color' },
  { key: 'saturation_mean',       zh_name: '平均饱和度',   description: '色彩鲜艳程度',           group: 'color' },
  { key: 'saturation_std',        zh_name: '饱和度标准差', description: '饱和度的变化幅度',       group: 'color' },
  { key: 'warm_cool_bias_weighted', zh_name: '加权冷暖倾向', description: '按亮度加权的冷暖分布', group: 'color' },
  { key: 'low_saturation_ratio',  zh_name: '低饱和比例',   description: '灰度/低彩区域占画面比例', group: 'color' },
  { key: 'high_saturation_ratio', zh_name: '高饱和比例',   description: '鲜艳色彩区域占画面比例', group: 'color' },
  { key: 'dominant_hue_strength', zh_name: '主色强度',     description: '画面主色调的突出程度',   group: 'color' },
];

export function getFeatureKeys(): string[] {
  return FEATURE_SCHEMA.map((f) => f.key);
}

export function getFeaturesByGroup(group: string): FeatureDimension[] {
  return FEATURE_SCHEMA.filter((f) => f.group === group);
}
