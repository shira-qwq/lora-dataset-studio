/**
 * rglBoardStorage.ts — P10-006C: localStorage persistence for RGL board layouts.
 *
 * Saves only RGL LayoutItem[] (positions + sizes in grid units).
 * Frame dimensions are NOT persisted — they are recomputed from current settings.
 */
import type { LayoutItem } from 'react-grid-layout';
import type { SavedRglBoardLayout } from './rglBoardTypes';

function storageKey(jobId: string): string {
  return `organize.rglLayout:${jobId}`;
}

/**
 * Load saved RGL layout from localStorage.
 */
export function loadRglLayout(jobId: string): LayoutItem[] | null {
  if (!jobId) return null;
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedRglBoardLayout;
    if (data.version === 1 && data.jobId === jobId && Array.isArray(data.items)) {
      // Return a mutable copy
      return data.items.map((item) => ({ ...item }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save RGL layout to localStorage.
 */
export function saveRglLayout(jobId: string, items: LayoutItem[]): void {
  if (!jobId) return;
  try {
    const layout: SavedRglBoardLayout = {
      version: 1,
      jobId,
      items: items.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        minH: item.minH,
        maxW: item.maxW,
        maxH: item.maxH,
        static: item.static,
        isDraggable: item.isDraggable,
        isResizable: item.isResizable,
      })),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey(jobId), JSON.stringify(layout));
  } catch {
    /* quota exceeded — silently ignore */
  }
}

/**
 * Clear saved RGL layout for a job.
 */
export function clearRglLayout(jobId: string): void {
  if (!jobId) return;
  try {
    localStorage.removeItem(storageKey(jobId));
  } catch {
    /* ignore */
  }
}

export { storageKey as rglLayoutKey };
