/**
 * Theme tokens for Dataset Intelligence Studio
 *
 * Core types and constants used across the theme system.
 * Color values are defined in theme.css — this file provides
 * type safety and logical constants for TypeScript code.
 */

export type ThemeId =
  | 'nebula-dark'
  | 'graphite-dark'
  | 'amber-dark'
  | 'forest-dark'
  | 'custom';  // @since P09-002 — custom theme mode

/** Ordered list of all valid theme IDs */
export const THEME_IDS: ThemeId[] = [
  'nebula-dark',
  'graphite-dark',
  'amber-dark',
  'forest-dark',
];

/** Default theme applied when localStorage is empty or invalid */
export const DEFAULT_THEME: ThemeId = 'nebula-dark';

/** localStorage key used for persisting theme choice */
export const STORAGE_KEY = 'dis-theme';

/** @since P09-002 — custom theme is considered a "mode" on top of preset */
export const CUSTOM_ACTIVE_KEY = 'dis-theme-custom-active';
