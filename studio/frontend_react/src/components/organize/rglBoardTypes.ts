/**
 * rglBoardTypes.ts — P10-006C: RGL-based Manual Board Mode types.
 *
 * Defines the localStorage format for RGL board layouts.
 * Uses plain LayoutItem[] (from react-grid-layout) for positions.
 */
import type { LayoutItem } from 'react-grid-layout';

export interface SavedRglBoardLayout {
  version: 1;
  jobId: string;
  items: LayoutItem[];
  updatedAt: string;
}

/** RGL grid configuration constants */
export const RGL_COLS = 24;
export const RGL_ROW_HEIGHT = 24;
export const RGL_MARGIN: [number, number] = [16, 16];
export const RGL_CONTAINER_PADDING: [number, number] = [0, 0];
