/**
 * inspectionPresets — 图片巡检切片预设定义
 *
 * 每个预设定义一个切片，包括：
 * - 排序字段/方向
 * - 筛选条件
 * - 卡片 badge 显示
 * - 卡片信号 (cardSignals) — 只显示当前切片相关的指标
 * - hover 字段
 * - 缩略图数据来源
 * - 空态/不可用文案
 *
 * 重要规则：所有 badge/hover/sort/signal 字段必须来自 API 实际返回的字段。
 * - requiredChannel='basic_metadata' → 只能用 metadata-summary 的字段
 * - requiredChannel='histogram' → 只能用 histogram-summary 的字段
 * - requiredChannel='quality_edge' → 只能用 quality-edge-summary 的字段
 *
 * 组件从 manifest 读取预设，不在页面中硬编码切片列表。
 *
 * P10-002: 每个预设增加 cardSignals 字段，卡片 body 只显示当前切片相关指标。
 */

export type SliceGroup = 'all' | 'brightness' | 'color' | 'quality_edge' | 'file' | 'duplicate' | 'plugin' | 'advanced';

export interface CardBadgeDef {
  /** 后端字段 key */
  field: string;
  /** 中文标签 */
  label_zh: string;
  /** 显示样式: chip | metric | tag */
  style: 'chip' | 'metric' | 'tag';
  /** 数值格式化: 'percent' | 'decimal2' | 'raw' */
  format: 'percent' | 'decimal2' | 'raw';
}

export interface HoverFieldDef {
  /** 后端字段 key */
  field: string;
  /** hover 时显示的简短中文名 */
  label_zh: string;
  /** 数值格式 */
  format: 'percent' | 'decimal2' | 'raw' | 'tag';
}

/** P10-002: 卡片指标条信号定义 — 每个切片只显示相关的 1-3 个指标 */
export interface CardSignalDef {
  /** 后端字段 key */
  field: string;
  /** 中文标签（简短，2 字左右） */
  label_zh: string;
  /** 数值格式 */
  format: 'percent' | 'decimal2' | 'raw' | 'tag';
}

export type FallbackStrategy = 'hide_slice' | 'show_empty' | 'graceful_degrade';

export interface FilterDef {
  /** 后端字段 key */
  field: string;
  /** 筛选区间: [min, max] */
  range?: [number, number];
  /** 精确匹配值 */
  eq?: string | number;
  /** 筛选数据标签 */
  label?: string;
}

export interface SortDef {
  /** 后端字段 key */
  field: string;
  /** 排序方向 */
  order: 'asc' | 'desc';
}

export interface InspectionPreset {
  /** 预设 ID (machine key) */
  id: string;
  /** 分组 */
  group: SliceGroup;
  /** 组内排序权重（小值排前面） */
  groupOrder: number;
  /** 依赖的 analysis channel（空 = 不依赖） */
  requiredChannel: string;
  /** 依赖的字段（空 = 依赖通道即可） */
  requiredFields?: string[];
  /** 排序规则 */
  sortBy: SortDef;
  /** 可选附加排序 */
  secondarySort?: SortDef;
  /** 筛选条件（可选） */
  filter?: FilterDef;
  /** 缩略图数据来源通道 */
  thumbnailSource: string;
  /** P10-003: 视图类型（ranked_grid=普通排序网格, grouped_gallery=分组画廊） */
  viewType?: 'ranked_grid' | 'filtered_grid' | 'grouped_gallery';
  /** 卡片 badge 列表（最多 3 个） */
  cardBadges: CardBadgeDef[];
  /** P10-002: 卡片 body 指标条信号（只显示与当前切片相关的字段） */
  cardSignals?: CardSignalDef[];
  /** hover 时显示的字段 */
  hoverFields: HoverFieldDef[];
  /** 空态标题（ID，从 dictionary 中获取具体文案） */
  emptyStateKey: string;
  /** 通道不可用时的降级策略 */
  fallbackStrategy: FallbackStrategy;
  /** 在哪些通道可用时此预设能用 */
  requiresChannelBuilt?: boolean;
  /** badge 颜色变体（可选覆盖） */
  badgeVariant?: 'accent' | 'success' | 'warning' | 'danger' | 'info';
}

/* ══════════════════════════════════════════════════════════════
   预设定义
   ── 所有字段已对齐到 API 实际返回字段 ──
   ── P10-002: cardSignals 只包含当前切片相关的指标 ──
   ══════════════════════════════════════════════════════════════ */

const PRESETS: InspectionPreset[] = [
  // ── 全部 ──
  // 不依赖 specific channel，使用 basic_metadata 的通用字段
  // cardSignals 未设置 → 降级到启发式检测
  {
    id: 'all',
    group: 'all',
    groupOrder: 0,
    requiredChannel: '',
    sortBy: { field: 'megapixels', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'megapixels', label_zh: '像素', style: 'metric', format: 'decimal2' },
      { field: 'file_size_mb', label_zh: '大小', style: 'tag', format: 'decimal2' },
      { field: 'clipping_ratio', label_zh: '动态溢出', style: 'metric', format: 'percent' },
    ],
    hoverFields: [
      { field: 'megapixels', label_zh: '像素数', format: 'decimal2' },
      { field: 'file_size_mb', label_zh: '文件大小', format: 'decimal2' },
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    emptyStateKey: 'all',
    fallbackStrategy: 'show_empty',
  },

  // ── 亮度组 ──
  // 依赖 histogram 通道，使用直方图字段
  {
    id: 'low_brightness',
    group: 'brightness',
    groupOrder: 1,
    requiredChannel: 'histogram',
    requiredFields: ['brightness_dark_ratio', 'brightness_bright_ratio'],
    sortBy: { field: 'brightness_dark_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_dark_ratio', label_zh: '暗部', style: 'metric', format: 'percent' },
      { field: 'brightness_bright_ratio', label_zh: '亮部', style: 'metric', format: 'percent' },
    ],
    cardSignals: [
      { field: 'brightness_dark_ratio', label_zh: '暗部', format: 'percent' },
      { field: 'brightness_entropy', label_zh: '亮度', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'brightness_dark_ratio', label_zh: '暗部占比', format: 'percent' },
      { field: 'brightness_bright_ratio', label_zh: '亮部占比', format: 'percent' },
      { field: 'brightness_entropy', label_zh: '亮度分布', format: 'decimal2' },
    ],
    emptyStateKey: 'low_brightness',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'accent',
  },
  {
    id: 'medium_brightness',
    group: 'brightness',
    groupOrder: 2,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_entropy', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_entropy', label_zh: '亮度分布', style: 'metric', format: 'decimal2' },
      { field: 'brightness_dark_ratio', label_zh: '暗部', style: 'metric', format: 'percent' },
    ],
    cardSignals: [
      { field: 'brightness_entropy', label_zh: '分布', format: 'decimal2' },
      { field: 'brightness_dark_ratio', label_zh: '暗部', format: 'percent' },
    ],
    hoverFields: [
      { field: 'brightness_entropy', label_zh: '亮度熵', format: 'decimal2' },
      { field: 'brightness_dark_ratio', label_zh: '暗部占比', format: 'percent' },
      { field: 'brightness_bright_ratio', label_zh: '亮部占比', format: 'percent' },
    ],
    emptyStateKey: 'medium_brightness',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'high_brightness',
    group: 'brightness',
    groupOrder: 3,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_bright_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_bright_ratio', label_zh: '亮部', style: 'metric', format: 'percent' },
      { field: 'brightness_dark_ratio', label_zh: '暗部', style: 'metric', format: 'percent' },
    ],
    cardSignals: [
      { field: 'brightness_bright_ratio', label_zh: '亮部', format: 'percent' },
      { field: 'brightness_entropy', label_zh: '亮度', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'brightness_bright_ratio', label_zh: '亮部占比', format: 'percent' },
      { field: 'brightness_dark_ratio', label_zh: '暗部占比', format: 'percent' },
      { field: 'brightness_entropy', label_zh: '亮度熵', format: 'decimal2' },
    ],
    emptyStateKey: 'high_brightness',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'warning',
  },
  {
    id: 'high_contrast',
    group: 'brightness',
    groupOrder: 4,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_entropy', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_entropy', label_zh: '高对比', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'brightness_entropy', label_zh: '对比', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'brightness_entropy', label_zh: '亮度熵', format: 'decimal2' },
      { field: 'brightness_dark_ratio', label_zh: '暗部占比', format: 'percent' },
    ],
    emptyStateKey: 'high_contrast',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'flat_light',
    group: 'brightness',
    groupOrder: 5,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_entropy', order: 'asc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_entropy', label_zh: '平光', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'brightness_entropy', label_zh: '平光', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'brightness_entropy', label_zh: '亮度熵', format: 'decimal2' },
    ],
    emptyStateKey: 'flat_light',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'strong_highlight',
    group: 'brightness',
    groupOrder: 6,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_bright_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_bright_ratio', label_zh: '强高光', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'brightness_bright_ratio', label_zh: '高光', format: 'percent' },
    ],
    hoverFields: [
      { field: 'brightness_bright_ratio', label_zh: '亮部占比', format: 'percent' },
    ],
    emptyStateKey: 'strong_highlight',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'dark_shadow',
    group: 'brightness',
    groupOrder: 7,
    requiredChannel: 'histogram',
    sortBy: { field: 'brightness_dark_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'brightness_dark_ratio', label_zh: '暗部多', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'brightness_dark_ratio', label_zh: '暗部', format: 'percent' },
    ],
    hoverFields: [
      { field: 'brightness_dark_ratio', label_zh: '暗部占比', format: 'percent' },
    ],
    emptyStateKey: 'dark_shadow',
    fallbackStrategy: 'graceful_degrade',
  },

  // ── 色彩组 ──
  // 依赖 histogram 通道，使用色相/饱和度字段
  {
    id: 'red_theme',
    group: 'color',
    groupOrder: 1,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_warm_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_warm_ratio', label_zh: '红色主题', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_warm_ratio', label_zh: '暖色', format: 'percent' },
      { field: 'saturation_high_ratio', label_zh: '饱和', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_warm_ratio', label_zh: '暖色比例', format: 'percent' },
      { field: 'saturation_high_ratio', label_zh: '高饱和占比', format: 'percent' },
    ],
    emptyStateKey: 'red_theme',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'danger',
  },
  {
    id: 'orange_yellow_theme',
    group: 'color',
    groupOrder: 2,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_warm_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_warm_ratio', label_zh: '橙黄主题', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_warm_ratio', label_zh: '暖色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_warm_ratio', label_zh: '暖色比例', format: 'percent' },
    ],
    emptyStateKey: 'orange_yellow_theme',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'warning',
  },
  {
    id: 'green_theme',
    group: 'color',
    groupOrder: 3,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_cool_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_cool_ratio', label_zh: '绿色主题', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_cool_ratio', label_zh: '冷色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_cool_ratio', label_zh: '冷色比例', format: 'percent' },
    ],
    emptyStateKey: 'green_theme',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'success',
  },
  {
    id: 'blue_cyan_theme',
    group: 'color',
    groupOrder: 4,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_cool_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_cool_ratio', label_zh: '青蓝主题', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_cool_ratio', label_zh: '冷色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_cool_ratio', label_zh: '冷色比例', format: 'percent' },
    ],
    emptyStateKey: 'blue_cyan_theme',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'info',
  },
  {
    id: 'purple_theme',
    group: 'color',
    groupOrder: 5,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_cool_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_cool_ratio', label_zh: '紫色主题', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_cool_ratio', label_zh: '冷色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_cool_ratio', label_zh: '冷色比例', format: 'percent' },
    ],
    emptyStateKey: 'purple_theme',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'warm_tone',
    group: 'color',
    groupOrder: 6,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_warm_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_warm_ratio', label_zh: '暖色倾向', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_warm_ratio', label_zh: '暖色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_warm_ratio', label_zh: '暖色比例', format: 'percent' },
    ],
    emptyStateKey: 'warm_tone',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'warning',
  },
  {
    id: 'cool_tone',
    group: 'color',
    groupOrder: 7,
    requiredChannel: 'histogram',
    sortBy: { field: 'hue_cool_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'hue_cool_ratio', label_zh: '冷色倾向', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'hue_cool_ratio', label_zh: '冷色', format: 'percent' },
    ],
    hoverFields: [
      { field: 'hue_cool_ratio', label_zh: '冷色比例', format: 'percent' },
    ],
    emptyStateKey: 'cool_tone',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'info',
  },
  {
    id: 'low_saturation',
    group: 'color',
    groupOrder: 8,
    requiredChannel: 'histogram',
    sortBy: { field: 'saturation_low_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'saturation_low_ratio', label_zh: '低饱和', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'saturation_low_ratio', label_zh: '低饱和', format: 'percent' },
    ],
    hoverFields: [
      { field: 'saturation_low_ratio', label_zh: '低饱和占比', format: 'percent' },
    ],
    emptyStateKey: 'low_saturation',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'high_saturation',
    group: 'color',
    groupOrder: 9,
    requiredChannel: 'histogram',
    sortBy: { field: 'saturation_high_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'saturation_high_ratio', label_zh: '高饱和', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'saturation_high_ratio', label_zh: '高饱和', format: 'percent' },
    ],
    hoverFields: [
      { field: 'saturation_high_ratio', label_zh: '高饱和占比', format: 'percent' },
    ],
    emptyStateKey: 'high_saturation',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'accent',
  },

  // ── 质量/边缘组 ──
  // 依赖 quality_edge 通道，使用质量/边缘字段
  {
    id: 'blur_suspect',
    group: 'quality_edge',
    groupOrder: 1,
    requiredChannel: 'quality_edge',
    requiredFields: ['blur_laplacian_var', 'sharpness_score'],
    sortBy: { field: 'blur_laplacian_var', order: 'asc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'blur_laplacian_var', label_zh: '模糊可疑', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'blur_laplacian_var', label_zh: '模糊', format: 'decimal2' },
      { field: 'sharpness_score', label_zh: '锐度', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'blur_laplacian_var', label_zh: '拉普拉斯方差', format: 'decimal2' },
      { field: 'sharpness_score', label_zh: '锐度评分', format: 'decimal2' },
    ],
    emptyStateKey: 'blur_suspect',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'danger',
  },
  {
    id: 'sharp_image',
    group: 'quality_edge',
    groupOrder: 2,
    requiredChannel: 'quality_edge',
    sortBy: { field: 'sharpness_score', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'sharpness_score', label_zh: '锐利图片', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'sharpness_score', label_zh: '锐度', format: 'decimal2' },
      { field: 'edge_density', label_zh: '边缘', format: 'percent' },
    ],
    hoverFields: [
      { field: 'sharpness_score', label_zh: '锐度评分', format: 'decimal2' },
      { field: 'edge_density', label_zh: '边缘密度', format: 'percent' },
    ],
    emptyStateKey: 'sharp_image',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'success',
  },
  {
    id: 'line_art_candidate',
    group: 'quality_edge',
    groupOrder: 3,
    requiredChannel: 'quality_edge',
    requiredFields: ['lineart_score_v2', 'edge_density'],
    sortBy: { field: 'lineart_score_v2', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'lineart_score_v2', label_zh: '线稿候选', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'lineart_score_v2', label_zh: '线稿', format: 'decimal2' },
      { field: 'edge_density', label_zh: '边缘', format: 'percent' },
      { field: 'saturation_low_ratio', label_zh: '低饱和', format: 'percent' },
    ],
    hoverFields: [
      { field: 'lineart_score_v2', label_zh: '线稿得分', format: 'decimal2' },
      { field: 'edge_density', label_zh: '边缘密度', format: 'percent' },
    ],
    emptyStateKey: 'line_art_candidate',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'accent',
  },
  {
    id: 'flat_color_candidate',
    group: 'quality_edge',
    groupOrder: 4,
    requiredChannel: 'quality_edge',
    sortBy: { field: 'flat_color_score', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'flat_color_score', label_zh: '平涂候选', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'flat_color_score', label_zh: '平涂', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'flat_color_score', label_zh: '平涂得分', format: 'decimal2' },
    ],
    emptyStateKey: 'flat_color_candidate',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'high_edge_density',
    group: 'quality_edge',
    groupOrder: 5,
    requiredChannel: 'quality_edge',
    sortBy: { field: 'edge_density', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'edge_density', label_zh: '高边缘密度', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'edge_density', label_zh: '边缘', format: 'percent' },
    ],
    hoverFields: [
      { field: 'edge_density', label_zh: '边缘密度', format: 'percent' },
    ],
    emptyStateKey: 'high_edge_density',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'low_detail_image',
    group: 'quality_edge',
    groupOrder: 6,
    requiredChannel: 'quality_edge',
    sortBy: { field: 'edge_density', order: 'asc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'edge_density', label_zh: '低细节', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'edge_density', label_zh: '细节', format: 'percent' },
    ],
    hoverFields: [
      { field: 'edge_density', label_zh: '边缘密度', format: 'percent' },
    ],
    emptyStateKey: 'low_detail_image',
    fallbackStrategy: 'graceful_degrade',
  },

  // ── 文件/基础信息组 ──
  // 依赖 basic_metadata 通道，使用基础元数据字段
  {
    id: 'large_image',
    group: 'file',
    groupOrder: 1,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'megapixels', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'megapixels', label_zh: '大尺寸', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'megapixels', label_zh: '像素', format: 'decimal2' },
      { field: 'width', label_zh: '宽', format: 'raw' },
      { field: 'height', label_zh: '高', format: 'raw' },
    ],
    hoverFields: [
      { field: 'megapixels', label_zh: '像素数', format: 'decimal2' },
      { field: 'short_side', label_zh: '短边', format: 'raw' },
    ],
    emptyStateKey: 'large_image',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'small_image',
    group: 'file',
    groupOrder: 2,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'megapixels', order: 'asc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'megapixels', label_zh: '小尺寸', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'megapixels', label_zh: '像素', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'megapixels', label_zh: '像素数', format: 'decimal2' },
    ],
    emptyStateKey: 'small_image',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'portrait_image',
    group: 'file',
    groupOrder: 3,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'aspect_ratio', order: 'asc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'aspect_ratio', label_zh: '竖图', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    emptyStateKey: 'portrait_image',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'landscape_image',
    group: 'file',
    groupOrder: 4,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'aspect_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'aspect_ratio', label_zh: '横图', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    emptyStateKey: 'landscape_image',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'square_image',
    group: 'file',
    groupOrder: 5,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'aspect_ratio', order: 'asc' },
    filter: { field: 'aspect_ratio', range: [0.9, 1.1] },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'aspect_ratio', label_zh: '方图', style: 'chip', format: 'decimal2' },
    ],
    cardSignals: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    hoverFields: [
      { field: 'aspect_ratio', label_zh: '宽高比', format: 'decimal2' },
    ],
    emptyStateKey: 'square_image',
    fallbackStrategy: 'graceful_degrade',
  },
  {
    id: 'transparent_image',
    group: 'file',
    groupOrder: 6,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'transparent_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'has_alpha', label_zh: '透明图', style: 'chip', format: 'raw' },
    ],
    cardSignals: [
      { field: 'transparent_ratio', label_zh: '透明', format: 'percent' },
    ],
    hoverFields: [
      { field: 'transparent_ratio', label_zh: '透明占比', format: 'percent' },
    ],
    emptyStateKey: 'transparent_image',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'info',
  },
  {
    id: 'overexposed_suspect',
    group: 'file',
    groupOrder: 7,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'overexposed_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'overexposed_ratio', label_zh: '过曝可疑', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'overexposed_ratio', label_zh: '过曝', format: 'percent' },
      { field: 'clipping_ratio', label_zh: '溢出', format: 'percent' },
    ],
    hoverFields: [
      { field: 'overexposed_ratio', label_zh: '过曝占比', format: 'percent' },
      { field: 'clipping_ratio', label_zh: '动态溢出', format: 'percent' },
    ],
    emptyStateKey: 'overexposed_suspect',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'danger',
  },
  {
    id: 'underexposed_suspect',
    group: 'file',
    groupOrder: 8,
    requiredChannel: 'basic_metadata',
    sortBy: { field: 'underexposed_ratio', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    cardBadges: [
      { field: 'underexposed_ratio', label_zh: '死黑可疑', style: 'chip', format: 'percent' },
    ],
    cardSignals: [
      { field: 'underexposed_ratio', label_zh: '死黑', format: 'percent' },
    ],
    hoverFields: [
      { field: 'underexposed_ratio', label_zh: '死黑占比', format: 'percent' },
    ],
    emptyStateKey: 'underexposed_suspect',
    fallbackStrategy: 'graceful_degrade',
    badgeVariant: 'warning',
  },

  // ── 重复图组 ──
  // 依赖 duplicate_groups 通道，使用分组画廊展示
  {
    id: 'duplicate_groups',
    group: 'duplicate' as SliceGroup,
    groupOrder: 1,
    requiredChannel: 'duplicate_groups',
    sortBy: { field: '', order: 'desc' },
    thumbnailSource: 'basic_metadata',
    viewType: 'grouped_gallery',
    cardBadges: [],
    hoverFields: [],
    emptyStateKey: 'duplicate_groups',
    fallbackStrategy: 'graceful_degrade',
  },
];

/* ─── Group metadata ─── */
export interface GroupMeta {
  id: SliceGroup;
  label_zh: string;
  description_zh: string;
  order: number;
}

export const SLICE_GROUPS: GroupMeta[] = [
  { id: 'all', label_zh: '全部', description_zh: '所有图片', order: 0 },
  { id: 'brightness', label_zh: '亮度', description_zh: '亮度分布与曝光特征', order: 1 },
  { id: 'color', label_zh: '色彩', description_zh: '色相、饱和度、冷暖倾向', order: 2 },
  { id: 'quality_edge', label_zh: '质量', description_zh: '模糊、锐度、边缘密度', order: 3 },
  { id: 'file', label_zh: '文件', description_zh: '尺寸、比例、透明与异常', order: 4 },
  { id: 'duplicate', label_zh: '重复图', description_zh: '完全重复和近似重复图片', order: 5 },
  { id: 'plugin', label_zh: '插件', description_zh: '可选模型分析结果', order: 6 },
  { id: 'advanced', label_zh: '高级', description_zh: '高级和调试切片', order: 7 },
];

/* ─── Public API ─── */

/** 获取所有预设 */
export function getAllPresets(): InspectionPreset[] {
  return PRESETS;
}

/** 根据 ID 获取预设 */
export function getPresetById(id: string): InspectionPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 获取某个分组的预设 */
export function getPresetsByGroup(group: SliceGroup): InspectionPreset[] {
  return PRESETS.filter((p) => p.group === group);
}

/** 获取分组中文名 */
export function getGroupLabel(group: SliceGroup): string {
  return SLICE_GROUPS.find((g) => g.id === group)?.label_zh ?? group;
}
