/**
 * boardFrameBuilder.ts — P10-006B-HOTFIX2: Rect-first frame builder.
 *
 * Computes cluster card frames (w/h) from cluster data + settings.
 * Layout algorithms consume these rects and output only x/y positions.
 * No DOM measurements involved.
 */
import type { BoardRect } from './boardTypes';

export interface FrameBuildSettings {
  tileSizePx: number;
  clusterColumns: number;
  tileGap: number;
  cardPaddingX: number;
  cardPaddingY: number;
  headerHeight: number;
  borderWidth: number;
}

export interface ClusterFrame {
  w: number;
  h: number;
  rows: number;
  columns: number;
}

/**
 * Build a single cluster card frame (w/h) from image count and settings.
 *
 * Example:
 *   10 images, 4 columns → rows = ceil(10/4) = 3
 *   13 images, 4 columns → rows = ceil(13/4) = 4
 *   5 images,  3 columns → rows = ceil(5/3)  = 2
 *   1 image,  4 columns → rows = ceil(1/4)  = 1
 */
export function buildClusterFrame(
  imageCount: number,
  settings: FrameBuildSettings,
): ClusterFrame {
  const columns = Math.max(1, Math.floor(settings.clusterColumns));
  const rows = Math.max(1, Math.ceil(imageCount / columns));

  const contentWidth = columns * settings.tileSizePx + (columns - 1) * settings.tileGap;
  const contentHeight = rows * settings.tileSizePx + (rows - 1) * settings.tileGap;

  const w = contentWidth + settings.cardPaddingX * 2 + settings.borderWidth * 2;
  const h = settings.headerHeight + contentHeight + settings.cardPaddingY * 2 + settings.borderWidth * 2;

  return { w, h, rows, columns };
}

/**
 * Build BoardRect array for all clusters.
 * Saved positions (from localStorage) are used as currentX/currentY hints.
 */
export function buildBoardRects(
  clusters: Array<{ id: string; name: string; images: Array<unknown> }>,
  settings: FrameBuildSettings,
  savedPositions?: Record<string, { x: number; y: number }> | null,
): BoardRect[] {
  return clusters.map((cluster, index) => {
    const frame = buildClusterFrame(cluster.images.length, settings);
    const saved = savedPositions?.[cluster.id];
    return {
      clusterId: cluster.id,
      label: cluster.name,
      imageCount: cluster.images.length,
      order: index,
      w: frame.w,
      h: frame.h,
      currentX: saved?.x,
      currentY: saved?.y,
    };
  });
}
