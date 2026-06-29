/**
 * ImageInspectionCard — 图片巡检卡片（Analysis 包装层）
 *
 * 负责：
 * 1. 从 data.fields + 预设定义解析 badge/hover/metric 展示值
 * 2. 委托 WorkspaceImageCard 渲染
 *
 * 解析逻辑独立于共享展示组件，便于 Analysis 与其他场景共用展示层。
 *
 * 导出 resolveBadges/resolveMetrics/resolveHoverFields 供 ImageInspectionGrid 使用。
 */
import WorkspaceImageCard from '../image-workspace/WorkspaceImageCard';
import type {
  WorkspaceBadgeDef,
  WorkspaceMetricDef,
  WorkspaceHoverField,
} from '../image-workspace/types';
import type { CardBadgeDef, HoverFieldDef, CardSignalDef } from '../../analysis/inspectionPresets';
import { getFieldHint, getFieldFullExplain } from '../../analysis/inspectionManifest';

export interface ImageCardData {
  image_id?: string;
  image_path: string;
  filename: string;
  /** Raw field values for computing badges/metrics */
  fields: Record<string, any>;
}

interface ImageInspectionCardProps {
  jobId: string;
  data: ImageCardData;
  badges: CardBadgeDef[];
  hoverFields: HoverFieldDef[];
  /** P10-002: 切片相关指标信号 */
  cardSignals?: CardSignalDef[];
  /** Why this image is in the current slice */
  sliceReason?: string;
}

/** Format a numeric value based on format type. */
function fmtValue(value: any, format: 'percent' | 'decimal2' | 'raw' | 'tag'): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  switch (format) {
    case 'percent':
      return `${(value * 100).toFixed(0)}%`;
    case 'decimal2':
      return value.toFixed(2);
    default:
      return String(value);
  }
}

/**
 * Resolve badge definitions against data.fields -> WorkspaceBadgeDef[]
 * Exported for ImageInspectionGrid to build card items.
 */
export function resolveBadges(data: ImageCardData, badgeDefs: CardBadgeDef[]): WorkspaceBadgeDef[] {
  return badgeDefs.slice(0, 3).map((bd) => {
    const val = data.fields[bd.field];
    return {
      label: bd.label_zh,
      value: fmtValue(val, bd.format),
      style: bd.style === 'metric' ? 'chip' : bd.style, // metric→chip for shared layer
    };
  });
}

/**
 * 各字段 0-1 归一化参考最大值
 * 用于将原始值映射到 5 段指标条
 */
const SIGNAL_NORMALIZE_MAX: Record<string, number> = {
  // Histogram
  brightness_dark_ratio: 1,
  brightness_bright_ratio: 1,
  brightness_entropy: 8,
  saturation_low_ratio: 1,
  saturation_high_ratio: 1,
  hue_warm_ratio: 1,
  hue_cool_ratio: 1,
  // Quality Edge
  blur_laplacian_var: 1000,
  sharpness_score: 1000,
  edge_density: 1,
  lineart_score_v2: 1,
  flat_color_score: 1,
  // Basic Metadata
  megapixels: 50,
  width: 10000,
  height: 10000,
  file_size_mb: 100,
  aspect_ratio: 10,
  transparent_ratio: 1,
  has_alpha: 1,
  overexposed_ratio: 1,
  underexposed_ratio: 1,
  clipping_ratio: 1,
};

/**
 * 通过 cardSignals 解析指标条（P10-002）
 * 只显示与当前切片相关的指标
 */
function resolveMetricsFromSignals(
  data: ImageCardData,
  signals: CardSignalDef[],
): WorkspaceMetricDef[] {
  const result: WorkspaceMetricDef[] = [];

  for (const sig of signals) {
    const rawVal = data.fields[sig.field];
    if (rawVal == null) continue;
    const max = SIGNAL_NORMALIZE_MAX[sig.field] ?? 1;
    result.push({
      label: sig.label_zh,
      value: Math.min(1, rawVal / max),
    });
    if (result.length >= 3) break;
  }

  return result;
}

/**
 * Pick available metric bar fields based on data available.
 * Falls back to heuristic detection of which channel's data is present.
 * Exported for ImageInspectionGrid to build card items.
 *
 * P10-002: if cardSignals is provided, use it instead of heuristic.
 */
export function resolveMetrics(
  data: ImageCardData,
  cardSignals?: CardSignalDef[],
): WorkspaceMetricDef[] {
  // P10-002: 如果有 cardSignals，使用切片相关指标
  if (cardSignals && cardSignals.length > 0) {
    const fromSignals = resolveMetricsFromSignals(data, cardSignals);
    if (fromSignals.length > 0) return fromSignals;
    // 如果所有信号字段都缺失，降级到启发式
  }

  // 启发式降级：根据可用数据猜测合适的指标
  const result: WorkspaceMetricDef[] = [];

  // Try brightness_entropy (histogram) — normalized 0-1
  if (data.fields['brightness_entropy'] != null) {
    result.push({ label: '亮度', value: Math.min(1, data.fields['brightness_entropy'] / 8) });
  }
  // Try saturation fields (histogram)
  if (data.fields['saturation_high_ratio'] != null) {
    result.push({ label: '饱和', value: Math.min(1, data.fields['saturation_high_ratio']) });
  } else if (data.fields['saturation_low_ratio'] != null) {
    result.push({ label: '彩色', value: Math.min(1, 1 - data.fields['saturation_low_ratio']) });
  }
  // Try sharpness (quality_edge)
  if (data.fields['sharpness_score'] != null && result.length < 3) {
    result.push({ label: '锐度', value: Math.min(1, data.fields['sharpness_score'] / 1000) });
  }
  // Try edge_density (quality_edge)
  if (data.fields['edge_density'] != null && result.length < 3) {
    result.push({ label: '边缘', value: Math.min(1, data.fields['edge_density']) });
  }
  // Try megapixels (basic_metadata)
  if (data.fields['megapixels'] != null && result.length < 3) {
    result.push({ label: '像素', value: Math.min(1, data.fields['megapixels'] / 50) });
  }

  return result;
}

/**
 * Resolve hover field definitions against data.fields + manifest -> WorkspaceHoverField[]
 * Exported for ImageInspectionGrid to build card items.
 */
export function resolveHoverFields(
  data: ImageCardData,
  hoverDefs: HoverFieldDef[],
): WorkspaceHoverField[] {
  return hoverDefs.map((hf) => {
    const val = data.fields[hf.field];
    const hint = getFieldHint(hf.field);
    const explain = getFieldFullExplain(hf.field);
    return {
      label: hf.label_zh,
      value: fmtValue(val, hf.format),
      hint,
      valueHint: explain?.value_hint,
    };
  });
}

export default function ImageInspectionCard({
  jobId,
  data,
  badges,
  hoverFields,
  cardSignals,
  sliceReason,
}: ImageInspectionCardProps) {
  // Resolve badge/metric/hover data from raw fields + preset definitions
  const resolvedBadges = resolveBadges(data, badges);
  // P10-002: pass cardSignals for slice-relevant metrics
  const resolvedMetrics = resolveMetrics(data, cardSignals);
  const resolvedHoverFields = resolveHoverFields(data, hoverFields);

  return (
    <WorkspaceImageCard
      jobId={jobId}
      data={data}
      badges={resolvedBadges}
      metrics={resolvedMetrics}
      hoverFields={resolvedHoverFields}
      sliceReason={sliceReason}
      fitMode="fit"
    />
  );
}
