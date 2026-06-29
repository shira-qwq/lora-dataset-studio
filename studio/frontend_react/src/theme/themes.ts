import type { ThemeId } from './tokens';

/**
 * Theme metadata for UI display (ThemeSelector, settings, etc.)
 *
 * Color values themselves live in theme.css — this file only
 * provides labels and representative accent colors for the
 * ThemeSelector UI.
 */
export interface ThemeMeta {
  id: ThemeId;
  label: string;
  labelCn: string;
  description: string;
  /** Representative accent color (used for selector dots / swatches) */
  accent: string;
}

export const THEME_META: ThemeMeta[] = [
  {
    id: 'nebula-dark',
    label: 'Nebula Dark',
    labelCn: '星云暗色',
    description: '蓝紫主色，默认主题',
    accent: '#7c9bff',
  },
  {
    id: 'graphite-dark',
    label: 'Graphite Dark',
    labelCn: '石墨暗色',
    description: '冷静灰蓝专业工具风',
    accent: '#58a6ff',
  },
  {
    id: 'amber-dark',
    label: 'Amber Dark',
    labelCn: '琥珀暗色',
    description: '暖色主色，偏摄影/图片工具',
    accent: '#e8a040',
  },
  {
    id: 'forest-dark',
    label: 'Forest Dark',
    labelCn: '森林暗色',
    description: '绿青主色，偏数据工具',
    accent: '#4cd9a0',
  },
];
