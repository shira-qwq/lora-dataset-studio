/**
 * themeConfig — 自定义主题配置类型和默认值
 *
 * 定义用户可以调节的主题参数。
 * 所有设置存储于 localStorage，通过 CSS 变量生效。
 */

/** 密度模式 */
export type DensityMode = 'compact' | 'standard' | 'comfortable';

/** 用户可自定义的主题字段 */
export interface CustomThemeConfig {
  /** 主色 accent — hex 颜色值 */
  accent: string;
  /** 背景深浅 (0~100, 0=最深, 100=最亮) */
  backgroundTone: number;
  /** 面板对比 (0~100, 0=最柔和, 100=最清晰) */
  surfaceContrast: number;
  /** 边框强度 (0~100, 0=最弱, 100=最强) */
  borderStrength: number;
  /** 圆角 (0~100, 0=最方, 100=最圆) */
  radius: number;
  /** 密度模式 */
  density: DensityMode;
}

export const CUSTOM_STORAGE_KEY = 'dis-theme-custom';
export const CUSTOM_ACTIVE_KEY = 'dis-theme-custom-active';

export const DEFAULT_CUSTOM_CONFIG: CustomThemeConfig = {
  accent: '#7c9bff',
  backgroundTone: 50,
  surfaceContrast: 50,
  borderStrength: 50,
  radius: 50,
  density: 'standard',
};

/** 将 CustomThemeConfig 转换为 CSS 变量覆盖值 */
export function customConfigToCSSVariables(config: CustomThemeConfig): Record<string, string> {
  const t = config.backgroundTone / 100;
  const s = config.surfaceContrast / 100;
  const b = config.borderStrength / 100;
  const r = config.radius / 100;

  // 背景色插值：nebula-dark (#12121a) 到亮灰 (#2a2a3a)
  const bgR = Math.round(18 + t * 24);
  const bgG = Math.round(18 + t * 24);
  const bgB = Math.round(26 + t * 32);
  const bg = `rgb(${bgR}, ${bgG}, ${bgB})`;

  // 面板色
  const sfR = Math.round(30 + s * 20);
  const sfG = Math.round(30 + s * 20);
  const sfB = Math.round(46 + s * 20);
  const surface = `rgb(${sfR}, ${sfG}, ${sfB})`;

  // 边框强度
  const br = Math.round(42 + b * 30);
  const border = `rgb(${br}, ${br + 10}, ${br + 30})`;

  // 圆角
  const radiusSm = `${4 + r * 4}px`;
  const radiusMd = `${8 + r * 8}px`;
  const radiusLg = `${12 + r * 12}px`;

  // 密度 — 间距缩放
  let spacingScale: number;
  switch (config.density) {
    case 'compact': spacingScale = 0.75; break;
    case 'comfortable': spacingScale = 1.25; break;
    default: spacingScale = 1;
  }

  return {
    '--bg': bg,
    '--bg-elevated': surface,
    '--surface': surface,
    '--surface-hover': `rgb(${sfR + 8}, ${sfG + 8}, ${sfB + 10})`,
    '--surface-active': `rgb(${sfR + 14}, ${sfG + 14}, ${sfB + 18})`,
    '--border': border,
    '--border-strong': `rgb(${br + 20}, ${br + 30}, ${br + 50})`,
    '--accent': config.accent,
    '--accent-soft': `${config.accent}26`,    // 15% alpha
    '--accent-strong': config.accent,
    '--radius-sm': radiusSm,
    '--radius-md': radiusMd,
    '--radius-lg': radiusLg,
    '--spacing-scale': String(spacingScale),
  };
}
