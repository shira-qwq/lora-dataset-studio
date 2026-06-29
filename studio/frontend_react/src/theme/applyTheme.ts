/**
 * Theme application and persistence utilities.
 *
 * - applyTheme(themeId): sets data-theme on <html> AND persists to localStorage
 * - getStoredTheme(): reads persisted theme from localStorage (falls back to default)
 * - initTheme(): convenience for main.tsx — applies the persisted/default theme
 *
 * @since P09-002 — supports custom theme mode with localStorage persistence.
 */

import type { ThemeId } from './tokens';
import { THEME_IDS, DEFAULT_THEME, STORAGE_KEY } from './tokens';
import {
  getStoredCustomConfig,
  applyCustomTheme,
  clearCustomTheme,
  isCustomActive,
  setCustomActive,
} from './customTheme';

/**
 * Read the persisted theme from localStorage.
 * Falls back to DEFAULT_THEME if nothing is stored or the value is invalid.
 */
export function getStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEME_IDS as readonly string[]).includes(stored)) {
      return stored as ThemeId;
    }
    // "custom" was stored as a theme in P07 — resolve to default for safety
    if (stored === 'custom' && isCustomActive()) {
      return 'custom' as ThemeId;
    }
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.)
  }
  return DEFAULT_THEME;
}

/**
 * Apply a theme: set data-theme on <html> and persist to localStorage.
 *
 * Supports:
 * - Preset themes (nebula-dark, graphite-dark, etc.)
 * - Custom theme: sets a base theme + CSS variable overrides
 *
 * Calling this with an unknown themeId silently falls back to DEFAULT_THEME.
 */
export function applyTheme(themeId: string): void {
  if (themeId === 'custom') {
    // Custom mode: apply default nebula-dark as base, then overlay custom vars
    document.documentElement.dataset.theme = DEFAULT_THEME;
    try {
      localStorage.setItem(STORAGE_KEY, 'custom');
    } catch { /* ignore */ }
    setCustomActive(true);
    const config = getStoredCustomConfig();
    applyCustomTheme(config);
    return;
  }

  // Preset theme
  const resolved: ThemeId = (THEME_IDS as readonly string[]).includes(themeId)
    ? (themeId as ThemeId)
    : DEFAULT_THEME;

  document.documentElement.dataset.theme = resolved;
  clearCustomTheme();
  setCustomActive(false);

  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {
    // non-critical — theme is applied for this session
  }
}

/**
 * Get the current effective theme ID from the DOM.
 */
export function getCurrentEffectiveTheme(): string {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}

/**
 * Reset to default theme and clear any custom overrides.
 */
export function resetToDefault(): void {
  applyTheme(DEFAULT_THEME);
}

/**
 * Initialize theme on app boot.
 * Reads localStorage (or uses default) and applies it before React renders.
 *
 * @since P09-002 — also restores custom theme if active.
 */
export function initTheme(): void {
  const stored = getStoredTheme();

  if (stored === ('custom' as string) || isCustomActive()) {
    // Apply base preset, then custom overlay
    document.documentElement.dataset.theme = DEFAULT_THEME;
    setCustomActive(true);
    const config = getStoredCustomConfig();
    applyCustomTheme(config);
  } else {
    document.documentElement.dataset.theme = stored;
    clearCustomTheme();
  }
}
