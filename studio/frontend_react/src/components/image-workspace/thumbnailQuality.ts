export type ThumbnailQuality = 'small' | 'medium' | 'large';

export interface ThumbnailQualityOption {
  key: ThumbnailQuality;
  label: string;
  size: number;
}

export const THUMBNAIL_QUALITY_OPTIONS: ThumbnailQualityOption[] = [
  { key: 'small', label: '小 256px', size: 256 },
  { key: 'medium', label: '中 384px', size: 384 },
  { key: 'large', label: '大 768px', size: 768 },
];

const VALID_KEYS = new Set<ThumbnailQuality>(['small', 'medium', 'large']);

export function normalizeThumbnailQuality(value: string | null | undefined): ThumbnailQuality {
  if (value && VALID_KEYS.has(value as ThumbnailQuality)) return value as ThumbnailQuality;
  if (value === '256') return 'small';
  if (value === '384' || value === '512') return 'medium';
  if (value === '768') return 'large';
  return 'medium';
}

export function thumbnailQualityToSize(value: ThumbnailQuality): number {
  return THUMBNAIL_QUALITY_OPTIONS.find((item) => item.key === value)?.size ?? 384;
}

export function loadThumbnailQuality(storageKey: string): ThumbnailQuality {
  try {
    return normalizeThumbnailQuality(window.localStorage.getItem(storageKey));
  } catch {
    return 'medium';
  }
}

export function saveThumbnailQuality(storageKey: string, value: ThumbnailQuality): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // localStorage can be unavailable in restricted browsers.
  }
}
