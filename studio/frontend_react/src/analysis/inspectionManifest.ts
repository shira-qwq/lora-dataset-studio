/**
 * inspectionManifest — 图片巡检清单入口
 *
 * 统一读取配置层，为 Analysis 页面提供：
 * - 切片预设列表（带中文 label/description）
 * - 切片可用性检查（通道是否存在、字段是否完整）
 * - 字段解释查询
 * - 通道中文信息
 *
 * AnalysisPage 不应直接引用 inspectionPresets 或 fieldExplain，
 * 通过此 manifest 统一获取。
 */

import {
  getAllPresets,
  getPresetById,
  getPresetsByGroup,
  getGroupLabel,
  SLICE_GROUPS,
} from './inspectionPresets';
import type { InspectionPreset, SliceGroup, GroupMeta } from './inspectionPresets';
import { getSliceLabel, getSliceCopyWithLang } from './inspectionDictionary.zh';
import type { SliceCopy } from './inspectionDictionary.zh';
import { getFieldExplain, getFieldExplainShort } from './fieldExplain';
import type { FieldExplain } from './fieldExplain';
import { getChannelInfo, getChannelUnavailableReason } from './channelDictionary';
import type { AnalysisCapability } from '../api/client';

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export interface ResolvedPreset extends InspectionPreset {
  copy: SliceCopy;
}

export interface SliceAvailability {
  /** 预设是否可用 */
  available: boolean;
  /** 不可用原因（中文） */
  reason: string;
  /** 是否因通道缺失 */
  channelMissing: boolean;
  /** 是否因字段缺失 */
  fieldMissing: boolean;
}

/* ══════════════════════════════════════════════════════════════
   Public API
   ══════════════════════════════════════════════════════════════ */

/**
 * 获取预设，同时绑定额外的中文信息
 */
export function resolvePreset(id: string): ResolvedPreset | undefined {
  const preset = getPresetById(id);
  if (!preset) return undefined;
  const copy = getSliceCopyWithLang(id);
  return {
    ...preset,
    copy: copy ?? {
      label_zh: preset.id,
      description_zh: '',
      emptyStateTitle: '暂无图片',
      emptyStateDescription: '当前切片没有匹配图片。',
      unavailableReason: '',
    },
  };
}

/**
 * 获取所有已解析的预设（带中文信息）
 */
export function resolveAllPresets(): ResolvedPreset[] {
  return getAllPresets().map((p) => {
    const copy = getSliceCopyWithLang(p.id);
    return {
      ...p,
      copy: copy ?? {
        label_zh: p.id,
        description_zh: '',
        emptyStateTitle: '暂无图片',
        emptyStateDescription: '当前切片没有匹配图片。',
        unavailableReason: '',
      },
    };
  });
}

/**
 * 获取某个分组的所有已解析预设
 */
export function resolvePresetsByGroup(group: SliceGroup): ResolvedPreset[] {
  return getPresetsByGroup(group).map((p) => {
    const copy = getSliceCopyWithLang(p.id);
    return {
      ...p,
      copy: copy ?? {
        label_zh: p.id,
        description_zh: '',
        emptyStateTitle: '暂无图片',
        emptyStateDescription: '当前切片没有匹配图片。',
        unavailableReason: '',
      },
    };
  });
}

/**
 * 检查预设在当前 capability 下的可用性
 */
export function checkSliceAvailability(
  preset: InspectionPreset,
  capability: AnalysisCapability | null,
): SliceAvailability {
  // "全部"始终可用
  if (preset.id === 'all') {
    return { available: true, reason: '', channelMissing: false, fieldMissing: false };
  }

  // 无 capability = 无数据
  if (!capability) {
    return {
      available: false,
      reason: '暂无分析数据',
      channelMissing: true,
      fieldMissing: false,
    };
  }

  const channels = capability.channels ?? {};

  // 检查通道
  if (preset.requiredChannel) {
    const ch = channels[preset.requiredChannel];
    if (!ch || !ch.built) {
      const reason = getChannelUnavailableReason(preset.requiredChannel);
      return { available: false, reason, channelMissing: true, fieldMissing: false };
    }

    // 检查依赖字段
    if (preset.requiredFields && preset.requiredFields.length > 0) {
      const availableFields = [...(ch.sort_fields || []), ...(ch.filter_fields || [])];
      const missingFields = preset.requiredFields.filter(
        (f) => !availableFields.includes(f),
      );
      if (missingFields.length > 0) {
        return {
          available: false,
          reason: `当前切片需要的部分数据暂不可用（${missingFields.join('、')}），可以切换到其他切片。`,
          channelMissing: false,
          fieldMissing: true,
        };
      }
    }
  }

  return { available: true, reason: '', channelMissing: false, fieldMissing: false };
}

/**
 * 获取字段的中文解释（简短版，用于 hover）
 */
export function getFieldHint(fieldKey: string): string {
  return getFieldExplainShort(fieldKey);
}

/**
 * 获取字段的完整解释
 */
export function getFieldFullExplain(fieldKey: string): FieldExplain | undefined {
  return getFieldExplain(fieldKey);
}

/**
 * 获取切片的 分组 + 排序权重的排序 key（用于切片栏排序）
 */
export function getSliceOrderKey(preset: InspectionPreset): string {
  return `${String(preset.groupOrder).padStart(3, '0')}_${preset.id}`;
}

export {
  getAllPresets,
  getPresetById,
  getPresetsByGroup,
  getGroupLabel,
  SLICE_GROUPS,
  getSliceLabel,
  getChannelInfo,
  getChannelUnavailableReason,
};

export type { SliceGroup, GroupMeta, InspectionPreset };
