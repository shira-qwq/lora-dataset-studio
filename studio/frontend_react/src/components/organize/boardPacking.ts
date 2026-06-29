/**
 * boardPacking.ts — Discrete grid packing for manual board mode.
 *
 * Takes a list of rects and packs them into a grid from top-left,
 * preserving input order. Used for "auto-pack" in manual board mode.
 * Not a bin-packing optimizer — stable, predictable, no dense reordering.
 */

export interface Rect {
  id: string;
  w: number;
  h: number;
}

export interface PackedRect extends Rect {
  x: number;
  y: number;
}

/**
 * Pack rectangles into a discrete grid.
 *
 * @param rects   Input rectangles in order (order is preserved).
 * @param boardWidth  Available board width in pixels.
 * @param gridSize    Discrete grid unit (default 24).
 * @param gap         Gap between cards (default 16).
 * @returns Packed rectangles with computed x, y positions.
 */
export function packRects(
  rects: Rect[],
  boardWidth: number,
  gridSize = 24,
  gap = 16,
): PackedRect[] {
  if (rects.length === 0) return [];
  if (boardWidth <= 0) boardWidth = 800;

  const cols = Math.max(1, Math.floor(boardWidth / gridSize));
  const occupied: boolean[][] = [];

  function ensureRows(rows: number) {
    while (occupied.length < rows) {
      occupied.push(Array(cols).fill(false));
    }
  }

  function canPlace(cx: number, cy: number, cw: number, ch: number): boolean {
    ensureRows(cy + ch);
    if (cx < 0 || cx + cw > cols) return false;
    for (let y = cy; y < cy + ch; y++) {
      for (let x = cx; x < cx + cw; x++) {
        if (occupied[y]?.[x]) return false;
      }
    }
    return true;
  }

  function mark(cx: number, cy: number, cw: number, ch: number) {
    ensureRows(cy + ch);
    for (let y = cy; y < cy + ch; y++) {
      for (let x = cx; x < cx + cw; x++) {
        occupied[y][x] = true;
      }
    }
  }

  const out: PackedRect[] = [];

  for (const rect of rects) {
    const cw = Math.max(1, Math.ceil((rect.w + gap) / gridSize));
    const ch = Math.max(1, Math.ceil((rect.h + gap) / gridSize));

    let placed = false;
    // Scan rows from top
    for (let cy = 0; !placed; cy++) {
      ensureRows(cy + ch);
      // Scan columns from left
      for (let cx = 0; cx <= cols - cw; cx++) {
        if (canPlace(cx, cy, cw, ch)) {
          mark(cx, cy, cw, ch);
          out.push({
            ...rect,
            x: cx * gridSize,
            y: cy * gridSize,
          });
          placed = true;
          break;
        }
      }
    }
  }

  return out;
}
