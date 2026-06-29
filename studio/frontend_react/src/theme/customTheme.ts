/**
 * customTheme — 自定义主题持久化和应用工具
 *
 * 在 preset 主题之上叠加自定义 CSS 变量覆盖。
 * 保存到 localStorage，刷新后恢复。
 */

import {
  CUSTOM_STORAGE_KEY,
  CUSTOM_ACTIVE_KEY,
  DEFAULT_CUSTOM_CONFIG,
  customConfigToCSSVariables,
} from './themeConfig';
import type { CustomThemeConfig } from './themeConfig';

/**
 * 读取 localStorage 中保存的自定义配置
 */
export function getStoredCustomConfig(): CustomThemeConfig {
  try {
    const stored = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 合并默认值，保证新字段也有值
      return { ...DEFAULT_CUSTOM_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CUSTOM_CONFIG };
}

/**
 * 保存自定义配置到 localStorage
 */
export function saveCustomConfig(config: CustomThemeConfig): void {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // non-critical
  }
}

/**
 * 检查当前是否为自定义主题模式
 */
export function isCustomActive(): boolean {
  try {
    return localStorage.getItem(CUSTOM_ACTIVE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * 设置自定义主题模式开启/关闭
 */
export function setCustomActive(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem(CUSTOM_ACTIVE_KEY, 'true');
    } else {
      localStorage.removeItem(CUSTOM_ACTIVE_KEY);
    }
  } catch {
    // non-critical
  }
}

/**
 * 应用自定义主题：在 preset 基础上叠加 CSS 变量覆盖
 * 自定义模式启用时，创建一个 <style> 标签覆盖 theme.css 中的变量
 */
export function applyCustomTheme(config: CustomThemeConfig): void {
  const vars = customConfigToCSSVariables(config);
  let styleEl = document.getElementById('dis-custom-theme');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dis-custom-theme';
    document.head.appendChild(styleEl);
  }

  const cssVars = Object.entries(vars)
    .map(([key, val]) => `  ${key}: ${val};`)
    .join('\n');

  styleEl.textContent = `:root {\n${cssVars}\n}`;
}

/**
 * 清除自定义主题覆盖
 */
export function clearCustomTheme(): void {
  const styleEl = document.getElementById('dis-custom-theme');
  if (styleEl) {
    styleEl.remove();
  }
}

/**
 * 重置自定义配置为默认值并应用
 */
export function resetCustomTheme(): CustomThemeConfig {
  const defaults = { ...DEFAULT_CUSTOM_CONFIG };
  saveCustomConfig(defaults);
  setCustomActive(false);
  clearCustomTheme();
  return defaults;
}

/**
 * 初始化时恢复自定义主题（在 preset 应用之后调用）
 */
export function initCustomTheme(): void {
  if (isCustomActive()) {
    const config = getStoredCustomConfig();
    applyCustomTheme(config);
  }
}
