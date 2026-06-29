/**
 * boardLayoutStorage.ts — P10-006B-HOTFIX2: localStorage persistence.
 *
 * Saves only positions (x/y), not w/h.
 * w/h are computed fresh each time by buildBoardRects() from current settings.
 */
import type { BoardPosition } from './boardTypes';

const LAYOUT_VERSION = 2;

interface SavedLayout {
  version: number;
  jobId: string;
  positions: Record<string, { x: number; y: number }>;
  updatedAt: string;
}

function storageKey(jobId: string): string {
  return `organize.clusterBoardLayout:${jobId}`;
}

/**
 * Load saved positions from localStorage.
 * Handles version 1 (old items with w/h) by extracting x/y.
 */
export function loadPositions(jobId: string): Record<string, BoardPosition> | null {
  if (!jobId) return null;
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedLayout;

    if (data.version === 2 && data.jobId === jobId && data.positions) {
      const result: Record<string, BoardPosition> = {};
      for (const [id, pos] of Object.entries(data.positions)) {
        result[id] = { clusterId: id, x: pos.x, y: pos.y };
      }
      return result;
    }

    // Version 1 migration: old items had w/h, extract x/y
    if (data.version === 1 && (data as any).items) {
      const oldItems = (data as any).items as Record<string, { x: number; y: number }>;
      const result: Record<string, BoardPosition> = {};
      for (const [id, item] of Object.entries(oldItems)) {
        result[id] = { clusterId: id, x: item.x, y: item.y };
      }
      // Save in new format
      savePositions(jobId, result);
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Save positions to localStorage (positions only, no w/h).
 */
export function savePositions(jobId: string, positions: Record<string, BoardPosition>): void {
  if (!jobId) return;
  try {
    const layout: SavedLayout = {
      version: LAYOUT_VERSION,
      jobId,
      positions: Object.fromEntries(
        Object.entries(positions).map(([id, pos]) => [id, { x: pos.x, y: pos.y }]),
      ),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey(jobId), JSON.stringify(layout));
  } catch { /* quota exceeded */ }
}

/**
 * Clear saved layout for a job.
 */
export function clearLayout(jobId: string): void {
  if (!jobId) return;
  try {
    localStorage.removeItem(storageKey(jobId));
  } catch { /* ignore */ }
}

export function boardModeKey(): string {
  return 'organize.boardMode';
}

export function loadBoardMode(): 'flow' | 'manual' {
  try {
    const raw = localStorage.getItem(boardModeKey());
    if (raw === 'manual') return 'manual';
  } catch { /* ignore */ }
  return 'flow';
}

export function saveBoardMode(mode: 'flow' | 'manual'): void {
  try {
    localStorage.setItem(boardModeKey(), mode);
  } catch { /* ignore */ }
}
