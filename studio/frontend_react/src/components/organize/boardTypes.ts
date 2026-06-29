/** P10-006A/B: Manual Board Mode types */

export type BoardMode = 'flow' | 'manual';

// ─── Legacy types (kept for import compat during transition) ───────────────

export interface ClusterBoardItem {
  clusterId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  order: number;
}

export interface ClusterBoardLayout {
  version: 1;
  jobId: string;
  mode: BoardMode;
  gridSize: number;
  items: Record<string, ClusterBoardItem>;
  updatedAt: string;
}

/** P10-006B: Layout presets */
export type BoardLayoutPreset = 'compact' | 'cake' | 'by-size' | 'reset';

// ─── Rect-first types (P10-006B-HOTFIX2) ──────────────────────────────────

/**
 * BoardRect: the computed frame for a cluster card.
 * w/h come from buildClusterFrame(), NOT from DOM measurements.
 */
export interface BoardRect {
  clusterId: string;
  label: string;
  imageCount: number;
  order: number;
  w: number;
  h: number;
  currentX?: number;
  currentY?: number;
}

/**
 * BoardPosition: only x/y output from layout algorithms.
 * w/h remain in BoardRect and are never modified by layout.
 */
export interface BoardPosition {
  clusterId: string;
  x: number;
  y: number;
}

export interface BoardLayoutResult {
  positions: Record<string, BoardPosition>;
  rects: Record<string, BoardRect>;
}

// ─── Legacy input/output types (kept for backward compat) ────────────────────

/** Input for layout algorithms (old style) */
export interface BoardRectInput {
  id: string;
  clusterId: string;
  label: string;
  imageCount: number;
  w: number;
  h: number;
  order: number;
  currentX?: number;
  currentY?: number;
}

/** Output from layout algorithms (old style) */
export interface BoardRectOutput {
  id: string;
  clusterId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
