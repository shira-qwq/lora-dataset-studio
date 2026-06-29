/**
 * boardLayoutPresets.ts — P10-006B-HOTFIX2: Rect-first layout presets.
 *
 * All algorithms consume BoardRect[] (from boardFrameBuilder) and output
 * Record<string, BoardPosition> — only x/y. w/h are NEVER modified.
 * No randomness — same inputs always produce same outputs.
 * No DOM measurements.
 */
import type { BoardRect, BoardPosition } from './boardTypes';

// ─── Shared utilities ────────────────────────────────────────────────────────

function snap(v: number, gridSize: number): number {
  return Math.round(v / gridSize) * gridSize;
}

/**
 * Check if two rectangles overlap.
 */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 0,
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

// ─── Layout validation ──────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a complete layout.
 */
export function validateLayout(
  rects: BoardRect[],
  positions: Record<string, BoardPosition>,
  boardWidth: number,
  gap = 0,
): ValidationResult {
  const errors: string[] = [];

  for (const rect of rects) {
    const pos = positions[rect.clusterId];
    if (!pos) {
      errors.push(`Missing position for cluster ${rect.clusterId}`);
      continue;
    }
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      errors.push(`Invalid position for ${rect.clusterId}: x=${pos.x} y=${pos.y}`);
    }
    if (pos.x < 0) errors.push(`x < 0 for ${rect.clusterId}`);
    if (pos.y < 0) errors.push(`y < 0 for ${rect.clusterId}`);
    if (pos.x + rect.w > boardWidth + 10) {
      errors.push(`Overflow right edge for ${rect.clusterId}: x=${pos.x} w=${rect.w} bw=${boardWidth}`);
    }
    if (rect.w <= 0 || rect.h <= 0) {
      errors.push(`Invalid dimensions for ${rect.clusterId}: w=${rect.w} h=${rect.h}`);
    }
  }

  // Check inter-rect overlap
  const placed = rects
    .filter((r) => positions[r.clusterId])
    .map((r) => ({ ...r, ...positions[r.clusterId] }));

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (rectsOverlap(placed[i], placed[j], gap)) {
        errors.push(`Overlap between ${placed[i].clusterId} and ${placed[j].clusterId}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Algorithm 1: Compact Pack ──────────────────────────────────────────────

/**
 * Compact grid packing — first-fit, left-to-right, top-to-bottom.
 * Preserves input order. Uses rect.w/h for grid occupancy.
 * Outputs Record<string, BoardPosition> — only x/y.
 */
export function compactPack(
  rects: BoardRect[],
  boardWidth: number,
  gridSize = 24,
  gap = 16,
): Record<string, BoardPosition> {
  const result: Record<string, BoardPosition> = {};
  if (rects.length === 0) return result;

  const safeWidth = boardWidth > 0 ? boardWidth : 800;
  const cols = Math.max(1, Math.floor(safeWidth / gridSize));
  const occupied: boolean[][] = [];

  function ensureRows(rowCount: number) {
    while (occupied.length < rowCount) occupied.push(Array(cols).fill(false));
  }

  function canPlace(cx: number, cy: number, cw: number, ch: number): boolean {
    if (cx < 0 || cx + cw > cols) return false;
    ensureRows(cy + ch);
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

  // Sort by currentY/Y, then currentX/X, then order
  const sorted = [...rects].sort((a, b) => {
    const ay = a.currentY ?? 0;
    const by = b.currentY ?? 0;
    if (ay !== by) return ay - by;
    const ax = a.currentX ?? 0;
    const bx = b.currentX ?? 0;
    if (ax !== bx) return ax - bx;
    return a.order - b.order;
  });

  for (const rect of sorted) {
    const cw = Math.max(1, Math.ceil((rect.w + gap) / gridSize));
    const ch = Math.max(1, Math.ceil((rect.h + gap) / gridSize));
    let placed = false;
    for (let cy = 0; !placed; cy++) {
      ensureRows(cy + ch);
      for (let cx = 0; cx <= cols - cw; cx++) {
        if (canPlace(cx, cy, cw, ch)) {
          mark(cx, cy, cw, ch);
          result[rect.clusterId] = {
            clusterId: rect.clusterId,
            x: cx * gridSize,
            y: cy * gridSize,
          };
          placed = true;
          break;
        }
      }
    }
  }

  return result;
}

// ─── Algorithm 2: Center-biased Pack ────────────────────────────────────────

/**
 * Center-biased rect packing.
 *
 * Sorts by importance (imageCount desc), then places each rect at the
 * closest non-overlapping grid position to the canvas center.
 * Uses discrete grid rings expanding outward.
 *
 * Falls back to compactPack if the board is too narrow or too few rects.
 */
export function centerPack(
  rects: BoardRect[],
  boardWidth: number,
  gridSize = 24,
  gap = 20,
): Record<string, BoardPosition> {
  const result: Record<string, BoardPosition> = {};
  if (rects.length === 0) return result;

  const safeWidth = boardWidth > 100 ? boardWidth : 800;

  if (rects.length < 2) {
    return compactPack(rects, safeWidth, gridSize, gap);
  }

  // Sort by importance: imageCount desc, area desc, order asc
  const sorted = [...rects].sort((a, b) => {
    const scoreA = a.imageCount * 100000 + a.w * a.h;
    const scoreB = b.imageCount * 100000 + b.w * a.h;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.order - b.order;
  });

  const centerX = safeWidth / 2;
  const centerY = 160;
  const placed: Array<{ clusterId: string; x: number; y: number; w: number; h: number }> = [];

  function isFree(cx: number, cy: number, cw: number, ch: number): boolean {
    if (cx < 0 || cy < 0 || cx + cw > safeWidth) return false;
    for (const item of placed) {
      if (rectsOverlap({ x: cx, y: cy, w: cw, h: ch }, item, gap)) return false;
    }
    return true;
  }

  for (const rect of sorted) {
    let pos: { x: number; y: number } | null = null;

    // Generate candidates from center outward
    const maxRing = 40;
    for (let ring = 0; ring <= maxRing && !pos; ring++) {
      const radius = ring * gridSize;
      const candidates: Array<{ x: number; y: number; dist: number }> = [];

      // Collect all positions on the current ring boundary
      for (let dy = -radius; dy <= radius; dy += gridSize) {
        for (let dx = -radius; dx <= radius; dx += gridSize) {
          // Only include positions ON the ring boundary
          if (ring > 0 && Math.abs(Math.abs(dx) - radius) > 1 && Math.abs(Math.abs(dy) - radius) > 1) {
            continue; // skip interior points for outer rings
          }
          // For ring 0, only the center point
          if (ring === 0 && (dx !== 0 || dy !== 0)) continue;

          const cx = snap(centerX + dx - rect.w / 2, gridSize);
          const cy = snap(centerY + dy - rect.h / 2, gridSize);
          const dist = Math.sqrt(dx * dx + dy * dy);
          candidates.push({ x: cx, y: cy, dist });
        }
      }

      // Sort by distance from center, then y, then x
      candidates.sort((a, b) => {
        if (a.dist !== b.dist) return a.dist - b.dist;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });

      for (const cand of candidates) {
        if (isFree(cand.x, cand.y, rect.w, rect.h)) {
          pos = { x: cand.x, y: cand.y };
          break;
        }
      }
    }

    if (!pos) {
      // Fallback: scan grid from top-left
      pos = findGridPosition(rect, placed, safeWidth, gridSize, gap);
    }

    placed.push({ clusterId: rect.clusterId, x: pos.x, y: pos.y, w: rect.w, h: rect.h });
    result[rect.clusterId] = { clusterId: rect.clusterId, x: pos.x, y: pos.y };
  }

  return result;
}

/**
 * Fallback grid scan: find first non-overlapping position.
 */
function findGridPosition(
  rect: BoardRect,
  placed: Array<{ x: number; y: number; w: number; h: number }>,
  boardWidth: number,
  gridSize: number,
  gap: number,
): { x: number; y: number } {
  const cols = Math.max(1, Math.floor(boardWidth / gridSize));
  const cw = Math.max(1, Math.ceil((rect.w + gap) / gridSize));

  for (let cy = 0; cy < 200; cy++) {
    for (let cx = 0; cx <= cols - cw; cx++) {
      const x = cx * gridSize;
      const y = cy * gridSize;
      let overlaps = false;
      for (const item of placed) {
        if (rectsOverlap({ x, y, w: rect.w, h: rect.h }, item, gap)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) return { x, y };
    }
  }

  return { x: 0, y: placed.length * 300 };
}

// ─── Algorithm 3: By Size Pack ──────────────────────────────────────────────

/**
 * Sort by imageCount desc, area desc, order asc, then compact pack.
 */
export function bySizePack(
  rects: BoardRect[],
  boardWidth: number,
  gridSize = 24,
  gap = 16,
): Record<string, BoardPosition> {
  const sorted = [...rects].sort((a, b) => {
    const scoreA = a.imageCount * 100000 + a.w * a.h;
    const scoreB = b.imageCount * 100000 + b.w * b.h;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.order - b.order;
  });
  return compactPack(sorted, boardWidth, gridSize, gap);
}

// ─── Preset dispatcher ──────────────────────────────────────────────────────

/**
 * Apply a named layout preset.
 * Falls back to compactPack if the chosen preset's output fails validation.
 */
export function applyLayoutPreset(
  preset: 'compact' | 'cake' | 'by-size',
  rects: BoardRect[],
  boardWidth: number,
): Record<string, BoardPosition> {
  const safeWidth = boardWidth > 100 ? boardWidth : 800;

  let positions: Record<string, BoardPosition>;
  switch (preset) {
    case 'compact':
      positions = compactPack(rects, safeWidth);
      break;
    case 'cake':
      positions = centerPack(rects, safeWidth);
      break;
    case 'by-size':
      positions = bySizePack(rects, safeWidth);
      break;
    default:
      positions = compactPack(rects, safeWidth);
  }

  // Validate and fallback
  const validation = validateLayout(rects, positions, safeWidth, 0);
  if (!validation.ok) {
    positions = compactPack(rects, safeWidth);
  }

  return positions;
}
