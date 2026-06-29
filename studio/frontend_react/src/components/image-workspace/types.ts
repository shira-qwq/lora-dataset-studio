/**
 * image-workspace/types.ts — 共享图片展示类型定义
 *
 * 定义 Workspace 内通用展示类型，
 * 不包含 Organize 业务类型（pendingMoves、cluster_layout 等）。
 * 不导入 analysis 或 organize 数据层。
 */

/** 图片展示模式 */
export type FitMode = 'fit' | 'cover';

/** 卡片上的一条 badge/标签 */
export interface WorkspaceBadgeDef {
  /** 中文标签 */
  label: string;
  /** 格式化后的值 */
  value: string;
  /** 显示样式: chip | tag */
  style: 'chip' | 'tag';
}

/** 小指标条定义 */
export interface WorkspaceMetricDef {
  /** 中文标签，如"亮度""饱和""锐度" */
  label: string;
  /** 0-1 归一化值 */
  value: number;
}

/** 悬停时要显示的字段定义（已解析的展示层数据） */
export interface WorkspaceHoverField {
  /** 中文标签 */
  label: string;
  /** 格式化后的值 */
  value: string;
  /** 简短解释（"这代表什么 / 你可以用它找什么图"） */
  hint: string;
  /** 数值理解提示 */
  valueHint?: string;
}

/** 卡片数据源 */
export interface WorkspaceImageData {
  /** Stable identity for original-image actions such as export and preview. */
  image_id?: string;
  /** 图片路径（用于缩略图 URL） */
  image_path: string;
  /** 文件名（展示用） */
  filename: string;
  thumbnailUrl?: string | null;
  originalUrl?: string | null;
  exists?: boolean;
  missingReason?: string | null;
  /** 字段原始值（供 badges/metrics/hover 计算） */
  fields: Record<string, any>;
}
