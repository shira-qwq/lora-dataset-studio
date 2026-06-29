/**
 * fieldDictionary — 分析字段字典（中英双语）
 *
 * 统一管理所有面向用户的分析字段中文名、英文名、tooltip、单位、来源通道、聚类参与标记。
 *
 * 规则：
 * - machine key 始终保持英文 ASCII（后端 CSV 列名 / API field 名）
 * - 所有用户可见的字段名/说明经由本字典输出
 * - 新增字段时只需在此添加，无需修改多个组件
 */

import { getLanguage } from './uiDictionary';

export type Visibility = 'normal' | 'expert' | 'debug';

export interface FieldMeta {
  /** 中文字段名 */
  label_zh: string;
  /** 英文字段名 */
  label_en?: string;
  /** 中文说明（tooltip） */
  description_zh: string;
  /** 英文说明（tooltip） */
  description_en?: string;
  /** 单位，无单位时为空字符串 */
  unit: string;
  /** 来源通道：basic_metadata | histogram | quality_edge | clustering | derived */
  source_channel: string;
  /** 是否参与默认 16 维聚类 */
  cluster_participation: boolean;
  /** 可见性层 */
  visibility: Visibility;
}

/** 按当前语言返回 label */
export function getFieldLabel(key: string, fallback?: string): string {
  const meta = DICT[key];
  if (!meta) return fallback || key;
  if (getLanguage() === 'en' && meta.label_en) return meta.label_en;
  return meta.label_zh;
}

/** 按当前语言返回 description */
export function getFieldDescription(key: string, fallback?: string): string {
  const meta = DICT[key];
  if (!meta) return fallback || '';
  if (getLanguage() === 'en' && meta.description_en) return meta.description_en;
  return meta.description_zh;
}

const DICT: Record<string, FieldMeta> = {
  // ============================================================
  // Basic Metadata
  // ============================================================
  width: {
    label_zh: '宽度',
    label_en: 'Width',
    description_zh: '图片像素宽度',
    description_en: 'Image width in pixels',
    unit: 'px',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  height: {
    label_zh: '高度',
    label_en: 'Height',
    description_zh: '图片像素高度',
    description_en: 'Image height in pixels',
    unit: 'px',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  megapixels: {
    label_zh: '像素数',
    label_en: 'Megapixels',
    description_zh: '图片总像素数（百万像素）',
    description_en: 'Total image pixels in megapixels',
    unit: 'MP',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  short_side: {
    label_zh: '短边',
    label_en: 'Short Side',
    description_zh: '图片短边像素长度',
    description_en: 'Short side length in pixels',
    unit: 'px',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  long_side: {
    label_zh: '长边',
    label_en: 'Long Side',
    description_zh: '图片长边像素长度',
    description_en: 'Long side length in pixels',
    unit: 'px',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  aspect_ratio: {
    label_zh: '宽高比',
    label_en: 'Aspect Ratio',
    description_zh: '宽度与高度的比值',
    description_en: 'Width-to-height ratio',
    unit: '',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  orientation: {
    label_zh: '方向',
    label_en: 'Orientation',
    description_zh: '图片拍摄方向（横图/竖图/方形）',
    description_en: 'Image orientation (landscape / portrait / square)',
    unit: '',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  file_size_mb: {
    label_zh: '文件大小',
    label_en: 'File Size',
    description_zh: '图片文件占用磁盘空间',
    description_en: 'File size on disk',
    unit: 'MB',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  has_alpha: {
    label_zh: '含 Alpha',
    label_en: 'Has Alpha',
    description_zh: '图片是否包含透明通道',
    description_en: 'Whether the image has an alpha channel',
    unit: '',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  transparent_ratio: {
    label_zh: '透明占比',
    label_en: 'Transparent Ratio',
    description_zh: '透明像素占总像素的比例',
    description_en: 'Ratio of transparent pixels to total pixels',
    unit: '%',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'expert',
  },
  overexposed_ratio: {
    label_zh: '过曝占比',
    label_en: 'Overexposed Ratio',
    description_zh: '过曝（亮度 > 0.98）像素的比例',
    description_en: 'Ratio of overexposed (brightness > 0.98) pixels',
    unit: '%',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  underexposed_ratio: {
    label_zh: '死黑占比',
    label_en: 'Underexposed Ratio',
    description_zh: '死黑（亮度 < 0.02）像素的比例',
    description_en: 'Ratio of underexposed (brightness < 0.02) pixels',
    unit: '%',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },
  clipping_ratio: {
    label_zh: '裁剪占比',
    label_en: 'Clipping Ratio',
    description_zh: '过曝与死黑像素的总比例',
    description_en: 'Combined ratio of overexposed and underexposed pixels',
    unit: '%',
    source_channel: 'basic_metadata',
    cluster_participation: false,
    visibility: 'normal',
  },

  // ============================================================
  // Histogram (直方图)
  // ============================================================
  brightness_dark_ratio: {
    label_zh: '暗部占比',
    label_en: 'Dark Ratio',
    description_zh: '亮度直方图中暗部区域像素的比例',
    description_en: 'Ratio of dark region pixels in the brightness histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  brightness_bright_ratio: {
    label_zh: '亮部占比',
    label_en: 'Bright Ratio',
    description_zh: '亮度直方图中亮部区域像素的比例',
    description_en: 'Ratio of bright region pixels in the brightness histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  brightness_entropy: {
    label_zh: '亮度熵',
    label_en: 'Brightness Entropy',
    description_zh: '亮度直方图的信息熵，越大表示亮度分布越分散',
    description_en: 'Information entropy of the brightness histogram — higher means more dispersed',
    unit: '',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  saturation_low_ratio: {
    label_zh: '低饱和占比',
    label_en: 'Low Saturation Ratio',
    description_zh: '饱和度直方图中低饱和度区域的比例',
    description_en: 'Ratio of low-saturation pixels in the saturation histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  saturation_high_ratio: {
    label_zh: '高饱和占比',
    label_en: 'High Saturation Ratio',
    description_zh: '饱和度直方图中高饱和度区域的比例',
    description_en: 'Ratio of high-saturation pixels in the saturation histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  hue_warm_ratio: {
    label_zh: '暖色调占比',
    label_en: 'Warm Tone Ratio',
    description_zh: '色相直方图中暖色（红/橙/黄）区域的比例',
    description_en: 'Ratio of warm (red/orange/yellow) pixels in the hue histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  hue_cool_ratio: {
    label_zh: '冷色调占比',
    label_en: 'Cool Tone Ratio',
    description_zh: '色相直方图中冷色（蓝/绿/紫）区域的比例',
    description_en: 'Ratio of cool (blue/green/purple) pixels in the hue histogram',
    unit: '%',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },
  histogram_outlier_score: {
    label_zh: '直方图异常分',
    label_en: 'Histogram Outlier Score',
    description_zh: '基于直方图残差的异常检测分数，越高越异常',
    description_en: 'Anomaly score based on histogram residuals — higher means more anomalous',
    unit: '',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'expert',
  },
  labels: {
    label_zh: '直方图标签',
    label_en: 'Histogram Labels',
    description_zh: '直方图形状分类标签（如 high_key / low_key / high_contrast 等）',
    description_en: 'Histogram shape classification labels (e.g. high_key / low_key / high_contrast)',
    unit: '',
    source_channel: 'histogram',
    cluster_participation: false,
    visibility: 'normal',
  },

  // ============================================================
  // Quality-Edge (质量边缘)
  // ============================================================
  sharpness_score: {
    label_zh: '锐度评分',
    label_en: 'Sharpness Score',
    description_zh: '基于拉普拉斯算子的图像锐度评分',
    description_en: 'Image sharpness score based on Laplacian operator',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  blur_laplacian_var: {
    label_zh: '拉普拉斯方差',
    label_en: 'Laplacian Variance',
    description_zh: '拉普拉斯变换的方差，值越小越模糊',
    description_en: 'Variance of Laplacian — lower values indicate more blur',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  edge_density: {
    label_zh: '边缘密度',
    label_en: 'Edge Density',
    description_zh: 'Canny 边缘检测得到的边缘像素比例',
    description_en: 'Ratio of edge pixels detected by Canny edge detection',
    unit: '%',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  edge_strength_p95: {
    label_zh: '边缘强度 P95',
    label_en: 'Edge Strength P95',
    description_zh: 'Sobel 梯度幅值的第 95 百分位数',
    description_en: '95th percentile of Sobel gradient magnitude',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  local_contrast_p95: {
    label_zh: '局部对比度 P95',
    label_en: 'Local Contrast P95',
    description_zh: '局部标准差图（31x31 窗口）的第 95 百分位数',
    description_en: '95th percentile of local standard deviation (31x31 window)',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  hue_coverage: {
    label_zh: '色相覆盖度',
    label_en: 'Hue Coverage',
    description_zh: '色相环上非零像素的覆盖范围（0~1），值越大色彩越丰富',
    description_en: 'Coverage of non-zero pixels on the hue wheel (0~1), higher = more colorful',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },
  lineart_score_v2: {
    label_zh: '线稿得分',
    label_en: 'Lineart Score',
    description_zh: '检测图片是否偏向线稿/插画风格',
    description_en: 'Detects whether the image tends toward line art / illustration style',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'expert',
  },
  high_contrast_score_v2: {
    label_zh: '高对比得分',
    label_en: 'High Contrast Score',
    description_zh: '检测图片是否具有高对比度特征',
    description_en: 'Detects whether the image has high-contrast characteristics',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'expert',
  },
  flat_color_score: {
    label_zh: '平涂得分',
    label_en: 'Flat Color Score',
    description_zh: '检测图片是否偏向平涂/低纹理风格',
    description_en: 'Detects whether the image has flat/low-texture characteristics',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'expert',
  },
  quality_edge_labels: {
    label_zh: '质量标签',
    label_en: 'Quality Labels',
    description_zh: '质量边缘分类标签',
    description_en: 'Quality-edge classification labels',
    unit: '',
    source_channel: 'quality_edge',
    cluster_participation: false,
    visibility: 'normal',
  },

  // ============================================================
  // Clustering features (16-dim)
  // ============================================================
  brightness_mean: {
    label_zh: '亮度均值',
    label_en: 'Mean Brightness',
    description_zh: 'LAB-L 通道的平均亮度',
    description_en: 'Mean luminance from the LAB-L channel',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  brightness_std: {
    label_zh: '亮度标准差',
    label_en: 'Brightness StdDev',
    description_zh: 'LAB-L 通道亮度的离散程度',
    description_en: 'Standard deviation of luminance in the LAB-L channel',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  brightness_p10: {
    label_zh: '亮度 P10',
    label_en: 'Brightness P10',
    description_zh: '亮度值的第 10 百分位数',
    description_en: '10th percentile of brightness values',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  brightness_p90: {
    label_zh: '亮度 P90',
    label_en: 'Brightness P90',
    description_zh: '亮度值的第 90 百分位数',
    description_en: '90th percentile of brightness values',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  brightness_skewness: {
    label_zh: '亮度偏度',
    label_en: 'Brightness Skewness',
    description_zh: '亮度分布的稳健偏度（(mean-median)/std），正偏=偏亮，负偏=偏暗',
    description_en: 'Robust skewness ((mean-median)/std) — positive = brighter bias, negative = darker bias',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
  contrast: {
    label_zh: '对比度',
    label_en: 'Contrast',
    description_zh: '基于局部亮度梯度的图像整体对比度',
    description_en: 'Overall image contrast based on local luminance gradients',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  highlight_ratio: {
    label_zh: '高光占比',
    label_en: 'Highlight Ratio',
    description_zh: '高光区域的像素比例',
    description_en: 'Ratio of highlight-region pixels',
    unit: '%',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  shadow_ratio: {
    label_zh: '阴影占比',
    label_en: 'Shadow Ratio',
    description_zh: '阴影区域的像素比例',
    description_en: 'Ratio of shadow-region pixels',
    unit: '%',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  edge_strength: {
    label_zh: '边缘强度',
    label_en: 'Edge Strength',
    description_zh: '基于 Sobel 梯度的平均边缘强度',
    description_en: 'Mean edge strength based on Sobel gradient',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  warm_cool_bias: {
    label_zh: '暖冷偏差',
    label_en: 'Warm-Cool Bias',
    description_zh: '暖色与冷色像素的比例偏差（raw 版本，非 weighted）',
    description_en: 'Ratio bias of warm vs. cool pixels (raw version, unweighted)',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  saturation_mean: {
    label_zh: '饱和度均值',
    label_en: 'Mean Saturation',
    description_zh: '图像整体平均饱和度',
    description_en: 'Mean saturation across the image',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'normal',
  },
  saturation_std: {
    label_zh: '饱和度标准差',
    label_en: 'Saturation StdDev',
    description_zh: '图像饱和度的离散程度',
    description_en: 'Standard deviation of image saturation',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
  light_centroid_x: {
    label_zh: '光照重心 X',
    label_en: 'Light Centroid X',
    description_zh: '光照分布的水平重心位置（0=左侧，1=右侧）',
    description_en: 'Horizontal centroid of lighting distribution (0=left, 1=right)',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
  light_centroid_y: {
    label_zh: '光照重心 Y',
    label_en: 'Light Centroid Y',
    description_zh: '光照分布的垂直重心位置（0=顶部，1=底部）',
    description_en: 'Vertical centroid of lighting distribution (0=top, 1=bottom)',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
  light_concentration: {
    label_zh: '光照集中度',
    label_en: 'Light Concentration',
    description_zh: '光照在空间上的集中程度，值越大表示光照越集中',
    description_en: 'Spatial concentration of lighting — higher means more concentrated',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
  light_asymmetry: {
    label_zh: '光照不对称度',
    label_en: 'Light Asymmetry',
    description_zh: '光照分布的左右不对称程度',
    description_en: 'Left-right asymmetry of lighting distribution',
    unit: '',
    source_channel: 'clustering',
    cluster_participation: true,
    visibility: 'expert',
  },
};

/**
 * 获取单个字段的元信息
 * @param key 字段 machine key
 * @param fallback 当字段不存在时的回退标签（默认返回原始 key）
 *
 * 按当前语言自动返回 label_zh / description_zh（实际内容可能是英文）。
 * 组件不用改代码，直接用 meta.label_zh / meta.description_zh 即可。
 */
export function getFieldMeta(key: string, fallback?: string): FieldMeta {
  const meta = DICT[key];
  if (meta) {
    if (getLanguage() === 'en') {
      return {
        ...meta,
        label_zh: meta.label_en || meta.label_zh,
        description_zh: meta.description_en || meta.description_zh,
      };
    }
    return meta;
  }
  return {
    label_zh: fallback || key,
    description_zh: '',
    unit: '',
    source_channel: 'unknown',
    cluster_participation: false,
    visibility: 'debug',
  };
}

/**
 * 获取某个通道的所有字段
 */
export function getFieldsByChannel(channel: string): [string, FieldMeta][] {
  return Object.entries(DICT).filter(([, meta]) => meta.source_channel === channel);
}

/**
 * 获取所有普通用户可见的字段
 */
export function getVisibleFields(): [string, FieldMeta][] {
  return Object.entries(DICT).filter(([, meta]) => meta.visibility === 'normal');
}

/**
 * 获取所有专家可见字段（含 normal + expert，不含 debug）
 */
export function getExpertFields(): [string, FieldMeta][] {
  return Object.entries(DICT).filter(([, meta]) => meta.visibility !== 'debug');
}

export default DICT;
