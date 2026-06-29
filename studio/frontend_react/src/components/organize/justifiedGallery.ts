/**
 * justifieGallery.ts — Adaptive Justified Gallery Layout
 *
 * Computes row-based layout positions for a list of images such that:
 *  - Images preserve their natural aspect ratio (no cropping).
 *  - Each row fills the container width (except the last row).
 *  - Row heights are clamped to [minRowHeight, maxRowHeight].
 *  - Image order is preserved (no grid-auto-flow: dense).
 *  - Wide images get proportionally more width; tall images don't dominate.
 *  - The algorithm avoids installing any third-party dependency.
 *
 * Usage:
 *   const rows = computeJustifiedRows(images, containerWidth, density);
 *   // Each row contains items with computed { width, height } in pixels.
 */

export interface GalleryImage {
  /** Unique key (e.g. filename) */
  key: string;
  /** Aspect ratio (width / height). Must be > 0. */
  aspectRatio: number;
  /** Any additional data to pass through (e.g. the original ImageData) */
  data?: unknown;
}

export interface GalleryRowItem {
  key: string;
  aspectRatio: number;
  width: number;
  height: number;
  data?: unknown;
}

export interface GalleryRow {
  items: GalleryRowItem[];
  rowHeight: number;
  /** Whether this is the last row (handled differently — no stretching) */
  isLastRow: boolean;
}

export interface DensityConfig {
  targetRowHeight: number;
  minRowHeight: number;
  maxRowHeight: number;
  gap: number;
}

export type GalleryDensity = 'compact' | 'standard' | 'loose';

const DENSITY_MAP: Record<GalleryDensity, DensityConfig> = {
  compact:  { targetRowHeight: 120, minRowHeight: 80,  maxRowHeight: 200, gap: 4 },
  standard: { targetRowHeight: 170, minRowHeight: 110, maxRowHeight: 300, gap: 6 },
  loose:    { targetRowHeight: 220, minRowHeight: 150, maxRowHeight: 400, gap: 8 },
};

/**
 * Compute justified gallery rows from a list of images.
 *
 * @param images     Ordered array of GalleryImage items.
 * @param containerWidth  Available width in pixels for the gallery area.
 * @param density    'compact' | 'standard' | 'loose'
 * @param maxPanoramaRatio  Images with aspectRatio >= this value get a
 *                          clamped height to avoid absurdly wide rows.
 *                          Default 3.0.
 */
export function computeJustifiedRows(
  images: GalleryImage[],
  containerWidth: number,
  density: GalleryDensity = 'standard',
  maxPanoramaRatio = 3.0,
): GalleryRow[] {
  if (images.length === 0) return [];

  const config = DENSITY_MAP[density] || DENSITY_MAP.standard;
  const { targetRowHeight, minRowHeight, maxRowHeight, gap } = config;
  const rows: GalleryRow[] = [];
  let cursor = 0;

  while (cursor < images.length) {
    const rowItems: GalleryImage[] = [];
    let totalAspect = 0;
    let i = cursor;

    // Accumulate images for this row
    while (i < images.length) {
      const clampedAspect = clampAspectRatio(images[i].aspectRatio, maxPanoramaRatio);
      const nextAspect = totalAspect + clampedAspect;

      // Estimated width if we add this image
      const estimatedWidth = (nextAspect) * targetRowHeight + rowItems.length * gap;

      // If adding this image would exceed container AND row already has items,
      // cut the row here (unless this is the very first image of a row).
      if (estimatedWidth > containerWidth && rowItems.length > 0) {
        break;
      }

      rowItems.push(images[i]);
      totalAspect += clampedAspect;
      i++;
    }

    const isLastRow = i >= images.length;

    // Determine row height
    let rowHeight: number;
    if (isLastRow) {
      // Last row: use targetRowHeight (don't stretch to fill)
      rowHeight = targetRowHeight;
    } else {
      // Normal row: calculate height to fill container width exactly
      rowHeight = (containerWidth - (rowItems.length - 1) * gap) / totalAspect;
      rowHeight = clamp(rowHeight, minRowHeight, maxRowHeight);
    }

    // Cap rowHeight for last row too
    rowHeight = clamp(rowHeight, minRowHeight, maxRowHeight);
    // Ensure rowHeight doesn't go below a sensible minimum
    rowHeight = Math.max(rowHeight, 40);

    // Build row items with computed dimensions
    const row: GalleryRow = {
      items: rowItems.map((img, idx) => {
        const ratio = clampAspectRatio(img.aspectRatio, maxPanoramaRatio);
        let width = rowHeight * ratio;
        // If last row, the last item should not overflow
        if (isLastRow && idx === rowItems.length - 1) {
          width = Math.min(width, containerWidth - (rowItems.length - 1) * gap - rowItems.slice(0, -1).reduce((s, _, j) => {
            const r = clampAspectRatio(rowItems[j].aspectRatio, maxPanoramaRatio);
            return s + rowHeight * r + gap;
          }, 0));
        }
        // Ensure minimum width
        width = Math.max(width, 40);
        return {
          key: img.key,
          aspectRatio: ratio,
          width,
          height: rowHeight,
          data: img.data,
        };
      }),
      rowHeight,
      isLastRow,
    };

    rows.push(row);
    cursor = i;
  }

  return rows;
}

/**
 * Get container-appropriate density config for responsive behavior.
 * Returns the density config object.
 */
export function getDensityConfig(density: GalleryDensity): DensityConfig {
  return DENSITY_MAP[density] || DENSITY_MAP.standard;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp extreme aspect ratios for layout stability.
 * Extremely wide images (panoramas) get a minimum height so they don't
 * create a single-image row that's too short to interact with.
 */
function clampAspectRatio(ratio: number | undefined, maxPanorama: number): number {
  if (!ratio || ratio <= 0) return 1;
  // Very tall images — don't let them exceed the inverse of maxPanorama
  const minRatio = 1 / maxPanorama;
  return clamp(ratio, minRatio, maxPanorama);
}
