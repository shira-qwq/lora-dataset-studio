/**
 * boardColumnSolver.ts — P10-006C-HOTFIX: Per-cluster auto column solver.
 *
 * When the toolbar columns mode is "auto", this solver picks the optimal
 * number of contact-sheet columns for each cluster individually, based on
 * image count, tile size, and frame geometry.
 *
 * Goal: avoid wasteful layouts like 5 images in 4 columns (4+1 with large
 * empty cell). Instead prefer layouts that produce compact, well-proportioned
 * cards (e.g. 5 images → 3 columns → 3+2).
 *
 * Scoring factors (lower is better):
 *   - aspect: close to 1.15–1.45 (slightly wider than tall)
 *   - empty cells: wasted grid cells
 *   - card width: prefer ≤350px (fits 3+ cards per row)
 *   - row count: prefer 2–4 rows (good density)
 *   - single wide row penalty
 *   - tiny cluster preference for minimal columns
 */

export interface ColumnSolverInput {
  imageCount: number;
  tileSizePx: number;
  tileGap: number;
  cardPaddingX: number;
  cardPaddingY: number;
  headerHeight: number;
  borderWidth: number;
  maxColumns?: number;
}

/**
 * Solve optimal column count for a single cluster.
 * Returns 1–6 columns.
 *
 * Expected results (medium tiles 96px, gap 6, padding 8, header 44, border 1):
 *   1 image  → 1 col (tall card, wasted space minimal)
 *   2 images → 2 cols (1 row, clean single row)
 *   3 images → 2 cols (rows=2: 2+1)
 *   5 images → 3 cols (rows=2: 3+2)       — not 4+1
 *   7 images → 3 cols (rows=3: 3+3+1)     — not 4+3
 *  10 images → 4 cols (rows=3: 4+4+2)
 *  13 images → 4 cols (rows=4: 4+4+4+1)   — not 5+5+3
 *  16 images → 4 cols (rows=4: 4+4+4+4)
 *  20 images → 5 cols (rows=4: 5+5+5+5)
 */
export function solveOptimalColumns(input: ColumnSolverInput): number {
  const {
    imageCount,
    tileSizePx,
    tileGap,
    cardPaddingX,
    cardPaddingY,
    headerHeight,
    borderWidth,
    maxColumns = 6,
  } = input;

  if (imageCount <= 0) return 3;

  // Compute frame dimensions for a given column count
  function computeFrame(cols: number): {
    rows: number;
    emptyCells: number;
    frameWidth: number;
    frameHeight: number;
    aspect: number;
  } {
    const safeCols = Math.max(1, Math.floor(cols));
    const rows = Math.max(1, Math.ceil(imageCount / safeCols));
    const emptyCells = rows * safeCols - imageCount;
    const contentWidth = safeCols * tileSizePx + (safeCols - 1) * tileGap;
    const contentHeight = rows * tileSizePx + (rows - 1) * tileGap;
    const frameWidth = contentWidth + cardPaddingX * 2 + borderWidth * 2;
    const frameHeight = headerHeight + contentHeight + cardPaddingY * 2 + borderWidth * 2;
    return {
      rows,
      emptyCells,
      frameWidth,
      frameHeight,
      aspect: frameWidth / frameHeight,
    };
  }

  // Score each candidate column count
  const candidates: Array<{ cols: number; score: number }> = [];

  for (let cols = 1; cols <= maxColumns; cols++) {
    const { rows, emptyCells, frameWidth, frameHeight, aspect } = computeFrame(cols);

    // Guard against division by zero or negative frames
    if (frameHeight <= 0 || frameWidth <= 0) {
      candidates.push({ cols, score: Infinity });
      continue;
    }

    let score = 0;

    // ── 1. Aspect ratio ──────────────────────────────────────────────
    // Target range: 1.15 ~ 1.45 (slightly wider than tall).
    // Very tall (<0.8) or very wide (>1.8) penalized heavily.
    if (aspect < 0.8) {
      score += (0.8 - aspect) * 5;
    } else if (aspect > 1.8) {
      score += (aspect - 1.8) * 3;
    } else if (aspect < 1.0) {
      // Slightly tall: mild penalty
      score += (1.0 - aspect) * 1;
    }

    // ── 2. Empty cell penalty ────────────────────────────────────────
    // Each wasted grid cell adds to the card's visual empty space.
    score += emptyCells * 0.3;

    // ── 3. Card width penalty ────────────────────────────────────────
    // Prefer cards narrow enough to fit 3+ per row (~350px).
    // Very wide cards (>500px) penalized heavily.
    if (frameWidth > 350) {
      score += (frameWidth - 350) / 150;
    }

    // ── 4. Row count preference ──────────────────────────────────────
    // 2–4 rows is the sweet spot for scanning.
    if (rows >= 2 && rows <= 4) {
      score -= 0.15; // small bonus
    }
    if (rows > 5) {
      score += (rows - 5) * 0.3; // too many rows
    }

    // ── 5. Single wide row penalty ───────────────────────────────────
    // A single wide row looks unbalanced in the board.
    if (rows === 1 && cols >= 4) {
      score += 0.6;
    }

    // ── 6. Small cluster preference ──────────────────────────────────
    // For 1–2 images, prefer using at most imageCount columns
    // so cards aren't needlessly wide.
    if (imageCount <= 2 && cols > imageCount) {
      score += 0.5;
    }

    // ── 7. Balanced rows bonus ───────────────────────────────────────
    // Prefer layouts where rows are roughly equal width.
    // Lots of empty cells in the last row means unbalanced rows.
    if (emptyCells > cols * 0.5 && cols > 2) {
      score += 0.2;
    }

    candidates.push({ cols, score: Math.round(score * 100) / 100 });
  }

  // Sort by score ascending, break ties by width (lower is better)
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aW = computeFrame(a.cols).frameWidth;
    const bW = computeFrame(b.cols).frameWidth;
    return aW - bW;
  });

  return candidates[0]?.cols ?? 3;
}
