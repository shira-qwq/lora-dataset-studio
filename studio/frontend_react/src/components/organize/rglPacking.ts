/**
 * rglPacking.ts — P10-006F-HOTFIX: One-shot collision-free RGL rectangle packing.
 *
 * Provides:
 *   1. packRglRectsNoOverlap() — grid-based skyline packing, no overlap.
 *   2. validateRglLayoutNoOverlap() — comprehensive collision check.
 *   3. computeWeightedSizes() — image-count-based card size allocation.
 *
 * All auto-layout operations MUST go through pack → validate → setLayout.
 * Never setLayout without validation.
 */
// ─── Packing types ─────────────────────────────────────────────────────────

/**
 * Input rect: w/h in grid units, no x/y.
 * Used as input for packRglRectsNoOverlap.
 */
export interface RglPackRect {
  i: string;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  imageCount: number;
  order: number;
  label?: string;
}

/**
 * Output item: includes x/y from packing.
 */
export interface RglPackedItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface PackOptions {
  /** Sort strategy */
  sort?: 'order' | 'weight' | 'area' | 'current';
  /** Existing layout for 'current' sort */
  currentLayout?: Array<{ i: string; x: number; y: number }>;
  /** Gap in grid units between items (default 0 — rows are flush, gap handled by RGL margin) */
  gap?: number;
}

export interface SmartShelfLayoutOptions {
  pinnedIds?: string[];
  padding?: number;
  workbenchRowGap?: number;
  workbenchColGap?: number;
  parkingRowGap?: number;
  parkingColGap?: number;
  workbenchGap?: number;
}

// ─── Overlap check ─────────────────────────────────────────────────────────

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a layout for overlaps and out-of-bounds.
 * Returns ok=false with list of error descriptions if problems found.
 */
export function validateRglLayoutNoOverlap(
  layout: Array<{ i: string; x: number; y: number; w: number; h: number }>,
  cols: number,
): ValidationResult {
  const errors: string[] = [];

  for (const item of layout) {
    if (!item.i) errors.push(`Item missing i: ${JSON.stringify(item)}`);
    if (typeof item.x !== 'number' || !Number.isFinite(item.x)) errors.push(`Item ${item.i}: invalid x`);
    if (typeof item.y !== 'number' || !Number.isFinite(item.y)) errors.push(`Item ${item.i}: invalid y`);
    if (typeof item.w !== 'number' || !Number.isFinite(item.w) || item.w <= 0) errors.push(`Item ${item.i}: invalid w=${item.w}`);
    if (typeof item.h !== 'number' || !Number.isFinite(item.h) || item.h <= 0) errors.push(`Item ${item.i}: invalid h=${item.h}`);
    if (item.x < 0) errors.push(`Item ${item.i}: x=${item.x} < 0`);
    if (item.y < 0) errors.push(`Item ${item.i}: y=${item.y} < 0`);
    if (item.x + item.w > cols) errors.push(`Item ${item.i}: overflow right edge x=${item.x} w=${item.w} cols=${cols}`);
  }

  // Check pairwise overlaps
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      if (overlaps(layout[i], layout[j])) {
        errors.push(`Overlap: ${layout[i].i} and ${layout[j].i}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── One-shot packer ───────────────────────────────────────────────────────

/**
 * Sort rects according to the chosen strategy.
 */
function sortRects(
  rects: RglPackRect[],
  sort: PackOptions['sort'],
  currentLayout?: Array<{ i: string; x: number; y: number }>,
): RglPackRect[] {
  const sorted = [...rects];
  switch (sort) {
    case 'weight':
      // imageCount desc → area desc → order asc
      sorted.sort((a, b) => {
        const scoreA = a.imageCount * 100000 + a.w * a.h;
        const scoreB = b.imageCount * 100000 + b.w * b.h;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.order - b.order;
      });
      break;
    case 'area':
      // area desc → imageCount desc → order asc
      sorted.sort((a, b) => {
        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        if (areaB !== areaA) return areaB - areaA;
        if (b.imageCount !== a.imageCount) return b.imageCount - a.imageCount;
        return a.order - b.order;
      });
      break;
    case 'current':
      if (currentLayout && currentLayout.length > 0) {
        const posMap = new Map(currentLayout.map((p) => [p.i, { x: p.x, y: p.y }]));
        sorted.sort((a, b) => {
          const pa = posMap.get(a.i);
          const pb = posMap.get(b.i);
          const ay = pa?.y ?? 999;
          const by = pb?.y ?? 999;
          if (ay !== by) return ay - by;
          const ax = pa?.x ?? 999;
          const bx = pb?.x ?? 999;
          return ax - bx;
        });
      } else {
        sorted.sort((a, b) => a.order - b.order);
      }
      break;
    case 'order':
    default:
      // order asc
      sorted.sort((a, b) => a.order - b.order);
      break;
  }
  return sorted;
}

/**
 * One-shot rectangle packing on a discrete grid.
 *
 * Algorithm:
 *   - Maintain an occupancy grid of cols width.
 *   - For each rect (sorted), scan rows from top, then columns from left.
 *   - Place at the first non-overlapping position.
 *   - Mark occupied cells.
 *
 * Guarantees:
 *   - No overlap.
 *   - Stable output (deterministic for same input + sort).
 *   - Items never exceed cols width (w clamped to cols).
 *   - Every item gets a valid position or an error is thrown.
 *
 * @param rects  Input rectangles (w/h in grid units, no x/y).
 * @param cols   Grid column count (e.g. 24).
 * @param options  Sort strategy and gap.
 * @returns Packed items with x/y positions.
 */
export function packRglRectsNoOverlap(
  rects: RglPackRect[],
  cols: number,
  options: PackOptions = {},
): RglPackedItem[] {
  if (rects.length === 0) return [];
  const safeCols = Math.max(1, cols || 24);
  const gap = options.gap ?? 0;

  const sorted = sortRects(rects, options.sort ?? 'order', options.currentLayout);

  // Occupancy grid: occupied[row][col] = true/false
  const occupied: boolean[][] = [];

  function ensureRows(rowCount: number) {
    while (occupied.length < rowCount) {
      occupied.push(Array(safeCols).fill(false));
    }
  }

  function canPlace(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0) return false;
    if (x + w > safeCols) return false;
    ensureRows(y + h);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (occupied[yy]?.[xx]) return false;
      }
    }
    return true;
  }

  function mark(x: number, y: number, w: number, h: number) {
    ensureRows(y + h + gap);
    for (let yy = y; yy < y + h + gap; yy++) {
      for (let xx = x; xx < x + w + gap; xx++) {
        if (yy < occupied.length && xx < safeCols) {
          occupied[yy][xx] = true;
        }
      }
    }
  }

  const out: RglPackedItem[] = [];

  for (const rect of sorted) {
    // Clamp w to cols, ensure minimums
    const w = Math.min(safeCols, Math.max(1, Math.floor(rect.w)));
    const h = Math.max(1, Math.floor(rect.h));

    let placed = false;

    // Scan rows from top
    for (let y = 0; !placed; y++) {
      ensureRows(y + h + gap);
      // Scan columns from left
      for (let x = 0; x <= safeCols - w; x++) {
        if (canPlace(x, y, w, h)) {
          out.push({
            i: rect.i,
            x,
            y,
            w,
            h,
            minW: rect.minW,
            minH: rect.minH,
          });
          mark(x, y, w, h);
          placed = true;
          break;
        }
      }
    }
  }

  return out;
}

// ─── Smart shelf layout ────────────────────────────────────────────────────

function clampRectWidth(rect: RglPackRect, cols: number, padding: number): RglPackRect {
  const maxWidth = Math.max(1, cols - padding * 2);
  const w = Math.min(maxWidth, Math.max(1, Math.floor(rect.w)));
  return { ...rect, w, h: Math.max(1, Math.floor(rect.h)) };
}

function shelfLayout(
  rects: RglPackRect[],
  cols: number,
  options: { startY: number; padding: number; rowGap: number; colGap: number },
): RglPackedItem[] {
  const safeCols = Math.max(1, cols || 24);
  const padding = Math.max(0, Math.floor(options.padding));
  const rightEdge = Math.max(padding + 1, safeCols - padding);
  let x = padding;
  let y = Math.max(0, Math.floor(options.startY));
  let rowH = 0;

  const out: RglPackedItem[] = [];
  for (const rawRect of rects) {
    const rect = clampRectWidth(rawRect, safeCols, padding);
    if (x > padding && x + rect.w > rightEdge) {
      x = padding;
      y += rowH + options.rowGap;
      rowH = 0;
    }
    out.push({
      i: rect.i,
      x,
      y,
      w: rect.w,
      h: rect.h,
      minW: rect.minW,
      minH: rect.minH,
    });
    x += rect.w + options.colGap;
    rowH = Math.max(rowH, rect.h);
  }
  return out;
}

function maxBottom(items: RglPackedItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

function visualVector(rect: RglPackRect): number[] {
  const text = `${rect.label || ''} ${rect.i}`.toLowerCase();
  const has = (words: string[]) => words.some((word) => text.includes(word));
  return [
    has(['dark', 'dim', 'low', 'night', 'shadow', '暗', '低亮']) ? 1 : 0,
    has(['bright', 'light', 'high', 'white', 'over', '亮', '高亮']) ? 1 : 0,
    has(['warm', 'red', 'orange', 'yellow', 'amber', '暖', '红', '橙', '黄']) ? 1 : 0,
    has(['cool', 'blue', 'cyan', 'green', '冷', '蓝', '青', '绿']) ? 1 : 0,
    has(['vivid', 'saturated', 'color', '高饱和', '鲜艳', '彩色']) ? 1 : 0,
    has(['muted', 'gray', 'mono', 'low saturation', '低饱和', '灰']) ? 1 : 0,
    Math.log1p(Math.max(0, rect.imageCount)) / 8,
  ];
}

function distance(a: RglPackRect, b: RglPackRect): number {
  const av = visualVector(a);
  const bv = visualVector(b);
  let sum = 0;
  for (let i = 0; i < av.length; i++) {
    const d = av[i] - bv[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function orderBySimilarity(rects: RglPackRect[]): RglPackRect[] {
  if (rects.length <= 2) return [...rects].sort((a, b) => a.order - b.order);
  const remaining = [...rects].sort((a, b) => {
    if (b.imageCount !== a.imageCount) return b.imageCount - a.imageCount;
    return a.order - b.order;
  });
  const out: RglPackRect[] = [];
  out.push(remaining.shift()!);

  while (remaining.length > 0) {
    const last = out[out.length - 1];
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let idx = 0; idx < remaining.length; idx++) {
      const candidate = remaining[idx];
      const score = distance(last, candidate) * 1000 + candidate.order / 1000;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }
    out.push(remaining.splice(bestIdx, 1)[0]);
  }

  return out;
}

export function smartShelfLayout(
  rects: RglPackRect[],
  cols: number,
  options: SmartShelfLayoutOptions = {},
): RglPackedItem[] {
  if (rects.length === 0) return [];
  const pinnedIds = options.pinnedIds || [];
  const pinnedOrder = new Map(pinnedIds.map((id, index) => [id, index]));
  const pinned = rects
    .filter((rect) => pinnedOrder.has(rect.i))
    .sort((a, b) => (pinnedOrder.get(a.i) ?? 9999) - (pinnedOrder.get(b.i) ?? 9999));
  const parking = orderBySimilarity(rects.filter((rect) => !pinnedOrder.has(rect.i)));

  const padding = options.padding ?? 1;
  const workbench = shelfLayout(pinned, cols, {
    startY: 0,
    padding,
    rowGap: options.workbenchRowGap ?? 3,
    colGap: options.workbenchColGap ?? 2,
  });
  const parkingStartY = workbench.length > 0
    ? maxBottom(workbench) + (options.workbenchGap ?? 3)
    : 0;
  const parked = shelfLayout(parking, cols, {
    startY: parkingStartY,
    padding,
    rowGap: options.parkingRowGap ?? 2,
    colGap: options.parkingColGap ?? 1,
  });

  return [...workbench, ...parked];
}

// ─── Weighted size computation ─────────────────────────────────────────────

export interface WeightedSizeInput {
  clusterId: string;
  imageCount: number;
  minW: number;
  minH: number;
}

export interface WeightedSizeOutput {
  i: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  imageCount: number;
}

/**
 * Compute RGL w/h based on image-count weight.
 *
 * visualWeight = sqrt(imageCount)
 * targetArea = (visualWeight / totalWeight) * availableArea
 *
 * For each cluster, try w in [minW..maxW] and pick (w,h) with best score:
 *   areaError + aspectPenalty + tooWidePenalty + tooTallPenalty
 *
 * Always ensures h >= minH (no content clipping).
 * Returns list sorted by weight desc (for packer).
 */
export function computeWeightedSizes(
  inputs: WeightedSizeInput[],
  cols: number,
): WeightedSizeOutput[] {
  if (inputs.length === 0) return [];

  const totalWeight = inputs.reduce((sum, inp) => sum + Math.sqrt(Math.max(1, inp.imageCount)), 0);
  const estimatedRows = Math.max(10, Math.ceil(inputs.length * 2.5));
  const availableArea = cols * estimatedRows;

  const outputs: WeightedSizeOutput[] = [];

  for (const inp of inputs) {
    const visualWeight = Math.sqrt(Math.max(1, inp.imageCount));
    const targetArea = (visualWeight / totalWeight) * availableArea;

    const minW = Math.max(1, inp.minW);
    const minH = Math.max(1, inp.minH);
    const maxW = Math.min(10, cols);
    const targetAspect = 1.4;

    let bestScore = Infinity;
    let bestW = minW;
    let bestH = Math.max(minH, Math.max(1, Math.round(targetArea / minW)));

    for (let w = minW; w <= maxW; w++) {
      let h = Math.max(minH, Math.max(1, Math.round(targetArea / w)));
      h = Math.min(h, 20); // soft cap
      const area = w * h;

      const areaError = Math.abs(area - targetArea) / Math.max(targetArea, 1);
      const aspect = w / h;
      const aspectPenalty = aspect > 0 ? Math.abs(Math.log(aspect / targetAspect)) : 5;
      const tooWidePenalty = w > 8 ? (w - 8) * 0.3 : 0;
      const tooTallPenalty = h > 12 ? (h - 12) * 0.2 : 0;

      const score = areaError * 2 + aspectPenalty * 1.5 + tooWidePenalty + tooTallPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestW = w;
        bestH = h;
      }
    }

    outputs.push({
      i: inp.clusterId,
      w: bestW,
      h: bestH,
      minW,
      minH,
      imageCount: inp.imageCount,
    });
  }

  // Sort by weight desc for packing
  outputs.sort((a, b) => {
    const wa = Math.sqrt(Math.max(1, a.imageCount));
    const wb = Math.sqrt(Math.max(1, b.imageCount));
    if (wb !== wa) return wb - wa; // desc
    return a.imageCount - b.imageCount;
  });

  return outputs;
}
