/**
 * RglManualBoardLayout.tsx — P10-006H: Semantic tile zoom + full canvas pan.
 *
 * Wheel on viewport → changes tileSizePx (semantic zoom, not CSS scale).
 * Wheel stops 250ms → debounced auto-pack.
 * Drag empty space → pan viewport via scrollTop/scrollLeft.
 * RGL at native scale (no transformScale), width = viewportWidth.
 */
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import type { ReactNode } from 'react';
import GridLayout from 'react-grid-layout/legacy';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { BoardRect } from './boardTypes';
import type { ClusterData } from './types';
import { RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING } from './rglBoardTypes';
import { loadRglLayout, saveRglLayout, clearRglLayout } from './rglBoardStorage';
import {
  packRglRectsNoOverlap,
  smartShelfLayout,
  validateRglLayoutNoOverlap,
} from './rglPacking';
import type { RglPackRect, RglPackedItem } from './rglPacking';

const CANVAS_PAD = 400;

// ─── Public handle type ─────────────────────────────────────────────────────

export interface RglManualBoardHandle {
  autoPack: () => void;
  resetLayout: () => void;
  fitToView: () => void;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface RglManualBoardLayoutProps {
  jobId: string;
  clusters: ClusterData[];
  boardRects: BoardRect[];
  pinnedClusterIds?: string[];
  renderClusterCard: (cluster: ClusterData) => ReactNode;
  onLayoutChanged?: () => void;
  /** Called on wheel for semantic tile zoom (delta: 1 = zoom in, -1 = zoom out) */
  onTileDelta?: (delta: 1 | -1) => void;
  /** Canvas camera zoom (0.4–2.0). Visual-only, does not change layout. */
  cameraZoom?: number;
  /** Called when camera zoom changes (Alt+Wheel, [ / ] / 0) */
  onCameraZoomChange?: (zoom: number) => void;
}

// ─── Frame → grid units conversion ──────────────────────────────────────────

function pxToGridUnits(
  cardWidthPx: number,
  cardHeightPx: number,
  containerWidth: number,
  cols: number,
  rowHeight: number,
  margin: readonly [number, number],
  containerPadding: readonly [number, number],
): { w: number; h: number } {
  const [marginX, marginY] = margin;
  const padX = containerPadding[0];
  const colWidth = (containerWidth - marginX * (cols - 1) - padX * 2) / cols;
  const w = Math.max(1, Math.ceil((cardWidthPx + marginX) / (colWidth + marginX)));
  const h = Math.max(1, Math.ceil((cardHeightPx + marginY) / (rowHeight + marginY)));
  return { w, h };
}

// ─── Build input rects from board rects ─────────────────────────────────────

function buildRglItemsWithSize(
  rects: BoardRect[],
  containerWidth: number,
  cols: number,
  rowHeight: number,
  margin: readonly [number, number],
  containerPadding: readonly [number, number],
): RglPackRect[] {
  return rects.map((rect, idx) => {
    const { w, h } = pxToGridUnits(rect.w, rect.h, containerWidth, cols, rowHeight, margin, containerPadding);
    return {
      i: rect.clusterId,
      w, h,
      minW: Math.max(1, w - 1),
      minH: Math.max(1, h - 1),
      imageCount: rect.imageCount,
      order: idx,
      label: rect.label,
    };
  });
}

// ─── Validate + set + save ─────────────────────────────────────────────────

function validateAndSetLayout(
  items: RglPackedItem[] | LayoutItem[],
  jobId: string,
  cols: number,
  setter: (items: LayoutItem[]) => void,
  layoutRef: React.MutableRefObject<LayoutItem[]>,
  fallbackRects: RglPackRect[] | null,
): LayoutItem[] {
  const validation = validateRglLayoutNoOverlap(items, cols);
  if (validation.ok) {
    const safeItems = items.map((item) => ({
      i: item.i, x: item.x, y: item.y, w: item.w, h: item.h,
      minW: item.minW ?? Math.max(1, item.w - 1),
      minH: item.minH ?? Math.max(1, item.h - 1),
      maxW: cols, static: false, isDraggable: true, isResizable: false,
    }));
    setter(safeItems);
    layoutRef.current = safeItems;
    saveRglLayout(jobId, safeItems);
    return safeItems;
  }
  console.warn(`Layout validation failed. Running fallback pack.`, validation.errors);
  if (fallbackRects && fallbackRects.length > 0) {
    const fallback = packRglRectsNoOverlap(fallbackRects, cols, { sort: 'order' });
    const fv = validateRglLayoutNoOverlap(fallback, cols);
    if (fv.ok) {
      const safeItems = fallback.map((item) => ({
        i: item.i, x: item.x, y: item.y, w: item.w, h: item.h,
        minW: item.minW ?? Math.max(1, item.w - 1),
        minH: item.minH ?? Math.max(1, item.h - 1),
        maxW: cols, static: false, isDraggable: true, isResizable: false,
      }));
      setter(safeItems);
      layoutRef.current = safeItems;
      saveRglLayout(jobId, safeItems);
      return safeItems;
    }
  }
  console.error('Fallback packing also failed! Keeping current layout.');
  return layoutRef.current;
}

// ─── Component ──────────────────────────────────────────────────────────────

function RglManualBoardLayout(
  {
    jobId,
    clusters,
    boardRects,
    pinnedClusterIds = [],
    renderClusterCard,
    onLayoutChanged,
    onTileDelta,
    cameraZoom = 1,
    onCameraZoomChange,
  }: RglManualBoardLayoutProps,
  ref: React.Ref<RglManualBoardHandle>,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const initializedRef = useRef(false);
  const layoutRef = useRef<LayoutItem[]>([]);
  const debounceRef = useRef<number | null>(null);
  const [isSemanticZooming, setIsSemanticZooming] = useState(false);
  const isSemanticZoomingRef = useRef(false);
  const isDraggingClusterRef = useRef(false);
  const pendingReflowRef = useRef(false);
  const scrollSaveRef = useRef<number | null>(null);

  // ── Measure viewport ──────────────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0) {
          setViewportWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
        }
        if (h > 0) {
          setViewportHeight((prev) => (Math.abs(prev - h) >= 2 ? h : prev));
        }
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setViewportWidth(rect.width);
    if (rect.height > 0) setViewportHeight(rect.height);
    return () => ro.disconnect();
  }, []);

  // ── Unscaled width for RGL (viewportWidth adjusted for camera zoom) ───
  const unscaledWidth = viewportWidth > 0 ? viewportWidth : 0;

  // ── Refs for latest values ────────────────────────────────────────────
  const boardRectsRef = useRef(boardRects);
  boardRectsRef.current = boardRects;

  // ── Init / reconcile ──────────────────────────────────────────────────
  useEffect(() => {
    const br = boardRectsRef.current;
    const uw = unscaledWidth;
    if (uw <= 0 || br.length === 0) return;
    if (initializedRef.current && isSemanticZoomingRef.current) return;

    function resetToPacked() {
      clearRglLayout(jobId);
      const rects = buildRglItemsWithSize(
        br, uw,
        RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
      );
      const packed = smartShelfLayout(rects, RGL_COLS, { pinnedIds: pinnedClusterIds });
      const items = packed.map((item) => ({
        i: item.i, x: item.x, y: item.y, w: item.w, h: item.h,
        minW: item.minW ?? Math.max(1, item.w - 1),
        minH: item.minH ?? Math.max(1, item.h - 1),
        maxW: RGL_COLS, static: false, isDraggable: true, isResizable: false,
      }));
      setLayout(items);
      layoutRef.current = items;
      saveRglLayout(jobId, items);
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      const saved = loadRglLayout(jobId);
      if (saved && saved.length > 0) {
        const validation = validateRglLayoutNoOverlap(saved, RGL_COLS);
        if (validation.ok) {
          const reconciled = reconcileLayout(
            saved, br, uw,
            RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
          );
          setLayout(reconciled);
          layoutRef.current = reconciled;
        } else {
          console.warn('Saved layout has overlaps. Regenerating...', validation.errors);
          resetToPacked();
        }
      } else {
        resetToPacked();
      }
    } else if (br.length > 0) {
      const reconciled = reconcileLayout(
        layoutRef.current, br, uw,
        RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
      );
      const validation = validateRglLayoutNoOverlap(reconciled, RGL_COLS);
      if (validation.ok) {
        setLayout(reconciled);
        layoutRef.current = reconciled;
        saveRglLayout(jobId, reconciled);
      } else {
        resetToPacked();
      }
    }
  }, [jobId, unscaledWidth, boardRects, pinnedClusterIds]);

  // ── RGL onLayoutChange ────────────────────────────────────────────────
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (isSemanticZoomingRef.current || isDraggingClusterRef.current) return;
      const items = newLayout.map((item) => ({ ...item, maxW: RGL_COLS }));
      const validation = validateRglLayoutNoOverlap(items, RGL_COLS);
      if (validation.ok) {
        layoutRef.current = items;
        setLayout(items);
        saveRglLayout(jobId, items);
        onLayoutChanged?.();
      } else {
        console.warn('onLayoutChange produced overlapping items — not saving.', validation.errors);
        if (layoutRef.current.length > 0) {
          setLayout([...layoutRef.current]);
        }
      }
    },
    [jobId, onLayoutChanged],
  );

  // ── Reflow current order after semantic tile zoom ─────────────────────
  const reflowCurrentFn = useCallback(() => {
    if (isDraggingClusterRef.current) {
      pendingReflowRef.current = true;
      return;
    }
    const br = boardRectsRef.current;
    const uw = unscaledWidthRef.current;
    if (uw <= 0 || br.length === 0) return;
    const rects = buildRglItemsWithSize(
      br, uw,
      RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
    );
    const currentLayout = layoutRef.current.map((item) => ({ i: item.i, x: item.x, y: item.y }));
    const packed = packRglRectsNoOverlap(rects, RGL_COLS, { sort: 'current', currentLayout });
    validateAndSetLayout(packed, jobId, RGL_COLS, setLayout, layoutRef, rects);
    pendingReflowRef.current = false;
  }, [jobId]);

  const scheduleSemanticReflow = useCallback(() => {
    isSemanticZoomingRef.current = true;
    pendingReflowRef.current = true;
    setIsSemanticZooming(true);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      isSemanticZoomingRef.current = false;
      setIsSemanticZooming(false);
      reflowCurrentFn();
    }, 280);
  }, [reflowCurrentFn]);

  // ── Imperative: smart arrange ─────────────────────────────────────────
  const smartArrangeFn = useCallback(() => {
    const br = boardRectsRef.current;
    const uw = unscaledWidthRef.current;
    if (uw <= 0 || br.length === 0) return;
    const rects = buildRglItemsWithSize(
      br, uw,
      RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
    );
    const packed = smartShelfLayout(rects, RGL_COLS, { pinnedIds: pinnedClusterIds });
    validateAndSetLayout(packed, jobId, RGL_COLS, setLayout, layoutRef, rects);
  }, [jobId, pinnedClusterIds]);

  // ── Imperative: resetLayout ──────────────────────────────────────────
  const resetLayout = useCallback(() => {
    const br = boardRectsRef.current;
    const uw = unscaledWidthRef.current;
    if (uw <= 0 || br.length === 0) return;
    clearRglLayout(jobId);
    const rects = buildRglItemsWithSize(
      br, uw,
      RGL_COLS, RGL_ROW_HEIGHT, RGL_MARGIN, RGL_CONTAINER_PADDING,
    );
    const packed = smartShelfLayout(rects, RGL_COLS, { pinnedIds: pinnedClusterIds });
    const items = packed.map((item) => ({
      i: item.i, x: item.x, y: item.y, w: item.w, h: item.h,
      minW: item.minW ?? Math.max(1, item.w - 1),
      minH: item.minH ?? Math.max(1, item.h - 1),
      maxW: RGL_COLS, static: false, isDraggable: true, isResizable: false,
    }));
    setLayout(items);
    layoutRef.current = items;
    saveRglLayout(jobId, items);
  }, [jobId, pinnedClusterIds]);

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const currentLayout = layoutRef.current;
    const uw = unscaledWidthRef.current;
    if (!vp || currentLayout.length === 0 || uw <= 0) return;
    const marginX = RGL_MARGIN[0];
    const marginY = RGL_MARGIN[1];
    const colPx = (uw - marginX * (RGL_COLS - 1) - RGL_CONTAINER_PADDING[0] * 2) / RGL_COLS;
    const minX = Math.min(...currentLayout.map((item) => item.x));
    const minY = Math.min(...currentLayout.map((item) => item.y));
    const maxX = Math.max(...currentLayout.map((item) => item.x + item.w));
    const maxY = Math.max(...currentLayout.map((item) => item.y + item.h));
    const left = CANVAS_PAD + minX * (colPx + marginX);
    const top = CANVAS_PAD + minY * (RGL_ROW_HEIGHT + marginY);
    const width = Math.max(1, (maxX - minX) * (colPx + marginX));
    const height = Math.max(1, (maxY - minY) * (RGL_ROW_HEIGHT + marginY));
    const zoom = Math.max(0.4, Math.min(1.2, Math.min(
      vp.clientWidth / (width + 120),
      vp.clientHeight / (height + 120),
    )));
    const nextZoom = Math.round(zoom * 100) / 100;
    onCameraZoomChange?.(nextZoom);
    requestAnimationFrame(() => {
      vp.scrollLeft = (left + width / 2) * nextZoom - vp.clientWidth / 2;
      vp.scrollTop = (top + height / 2) * nextZoom - vp.clientHeight / 2;
    });
  }, [onCameraZoomChange]);

  useImperativeHandle(ref, () => ({ autoPack: smartArrangeFn, resetLayout, fitToView }), [
    smartArrangeFn, resetLayout, fitToView,
  ]);

  // ── Refs for camera zoom and unscaled width ───────────────────────────
  const cameraZoomRef = useRef(cameraZoom);
  cameraZoomRef.current = cameraZoom;
  const unscaledWidthRef = useRef(unscaledWidth);
  unscaledWidthRef.current = unscaledWidth;

  // ── Dual zoom wheel handler ───────────────────────────────────────────
  //   Plain wheel → semantic tile zoom (via onTileDelta)
  //   Alt + Wheel → canvas camera zoom (via onCameraZoomChange)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (target.closest('button')) return;
      if (target.closest('.cluster-card-drag-handle')) return;
      if (target.closest('.organize-image-tile')) return;

      e.preventDefault();
      e.stopPropagation();

      const direction = e.deltaY > 0 ? -1 : 1;

      if (e.altKey) {
        // ── Alt + Wheel: canvas camera zoom ─────────────────────────────
        const oldZoom = cameraZoomRef.current;
        const factor = direction > 0 ? 1.08 : 0.92;
        const newZoom = Math.max(0.4, Math.min(2.0, Math.round(oldZoom * factor * 100) / 100));
        if (newZoom === oldZoom) return;

        // Mouse-centered zoom formula
        const rect = vp.getBoundingClientRect();
        const mX = e.clientX - rect.left;
        const mY = e.clientY - rect.top;
        const worldX = (vp.scrollLeft + mX) / oldZoom;
        const worldY = (vp.scrollTop + mY) / oldZoom;

        onCameraZoomChange?.(newZoom);

        requestAnimationFrame(() => {
          (vp as HTMLElement).scrollLeft = worldX * newZoom - mX;
          (vp as HTMLElement).scrollTop = worldY * newZoom - mY;
        });
      } else {
        // ── Plain wheel: semantic tile zoom ─────────────────────────────
        onTileDelta?.(direction as 1 | -1);
        scheduleSemanticReflow();
      }
    };

    vp.addEventListener('wheel', handler, { passive: false });
    return () => {
      vp.removeEventListener('wheel', handler);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [onTileDelta, scheduleSemanticReflow, onCameraZoomChange]);

  // ── Keyboard shortcuts for camera zoom ───────────────────────────────
  //   [ → zoom out, ] → zoom in, 0 → reset to 100%
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.target && (e.target as HTMLElement).tagName === 'SELECT') return;

      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const currentZoom = cameraZoomRef.current;

      let newZoom: number | null = null;

      if (e.key === ']') {
        newZoom = Math.max(0.4, Math.min(2.0, Math.round((currentZoom + 0.1) * 100) / 100));
      } else if (e.key === '[') {
        newZoom = Math.max(0.4, Math.min(2.0, Math.round((currentZoom - 0.1) * 100) / 100));
      } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        newZoom = 1.0;
      }

      if (newZoom !== null && newZoom !== currentZoom) {
        e.preventDefault();
        const worldX = (vp.scrollLeft + centerX) / currentZoom;
        const worldY = (vp.scrollTop + centerY) / currentZoom;

        onCameraZoomChange?.(newZoom);

        requestAnimationFrame(() => {
          (vp as HTMLElement).scrollLeft = worldX * newZoom - centerX;
          (vp as HTMLElement).scrollTop = worldY * newZoom - centerY;
        });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCameraZoomChange]);

  // Restore and persist canvas scroll position. Layout is still stored separately.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    try {
      const raw = localStorage.getItem(`organize.boardViewport:${jobId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        requestAnimationFrame(() => {
          if (typeof saved.scrollLeft === 'number') vp.scrollLeft = saved.scrollLeft;
          if (typeof saved.scrollTop === 'number') vp.scrollTop = saved.scrollTop;
        });
      }
    } catch { /* ignore */ }

    const handleScroll = () => {
      if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current);
      scrollSaveRef.current = window.setTimeout(() => {
        try {
          localStorage.setItem(`organize.boardViewport:${jobId}`, JSON.stringify({
            scrollLeft: vp.scrollLeft,
            scrollTop: vp.scrollTop,
          }));
        } catch { /* ignore */ }
      }, 160);
    };
    vp.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      vp.removeEventListener('scroll', handleScroll);
      if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current);
    };
  }, [jobId, layout.length]);

  // ── Canvas pan via Pointer Events ─────────────────────────────────────
  const panRef = useRef<{
    active: boolean; pointerId: number;
    startX: number; startY: number;
    scrollLeft: number; scrollTop: number;
  }>({ active: false, pointerId: -1, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const isPanTarget = useCallback((el: HTMLElement | null): boolean => {
    if (!el) return false;

    // ── RGL item wrapper hit detection ──────────────────────────────────
    // If clicking ON the .react-grid-item wrapper div itself (not on its
    // children), this is the margin/gap area between cards — visually empty
    // but covered by the wrapper. Allow pan here.
    if (el.matches('.react-grid-item')) return true;

    // If clicking on any child inside a .react-grid-item = card content
    // area. Reject pan — user may be interacting with the card.
    if (el.closest('.react-grid-item')) return false;

    // ── Outside RGL items: exclude specific interactive elements ─────────
    if (el.closest('.cluster-card-drag-handle')) return false;
    if (el.closest('.organize-image-tile')) return false;
    if (el.closest('.react-resizable-handle')) return false;
    if (el.closest('button')) return false;
    if (el.closest('input')) return false;
    if (el.closest('textarea')) return false;
    if (el.closest('select')) return false;
    if (el.closest('.thumb-preview-btn')) return false;

    // Everything else = empty board surface. Allow pan.
    return true;
  }, []);

  const handlePointerDownPan = useCallback((e: React.PointerEvent) => {
    if (!isPanTarget(e.target as HTMLElement)) return;
    if (e.button !== 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    e.preventDefault();
    vp.setPointerCapture(e.pointerId);
    panRef.current = {
      active: true, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      scrollLeft: vp.scrollLeft, scrollTop: vp.scrollTop,
    };
    setIsPanning(true);
  }, [isPanTarget]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handleMove = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active || e.pointerId !== pan.pointerId) return;
      vp.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
      vp.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
    };
    const handleUp = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active || e.pointerId !== pan.pointerId) return;
      pan.active = false;
      setIsPanning(false);
      if (pendingReflowRef.current && !isSemanticZoomingRef.current) reflowCurrentFn();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [reflowCurrentFn]);

  // ── Reset on job change ───────────────────────────────────────────────
  useEffect(() => {
    initializedRef.current = false;
    setLayout([]);
    layoutRef.current = [];
  }, [jobId]);

  // ── Canvas sizing for pan room ────────────────────────────────────────
  // Compute a canvas large enough to allow panning even with few clusters
  // Estimate board content size from layout (or fallback)
  const layoutBounds = layout.length > 0 ? layout.reduce(
    (acc, item) => ({
      maxX: Math.max(acc.maxX, item.x + item.w),
      maxY: Math.max(acc.maxY, item.y + item.h),
    }),
    { maxX: 0, maxY: 0 },
  ) : { maxX: 0, maxY: 0 };
  // Rough pixel estimate of board size
  const marginPx = RGL_MARGIN[0];
  const colPx = viewportWidth > 0
    ? (viewportWidth - marginPx * (RGL_COLS - 1) - RGL_CONTAINER_PADDING[0] * 2) / RGL_COLS
    : 40;
  const boardPxW = layoutBounds.maxX * (colPx + marginPx) + CANVAS_PAD * 2;
  const boardPxH = (layoutBounds.maxY + 2) * (RGL_ROW_HEIGHT + RGL_MARGIN[1]) + CANVAS_PAD * 2;
  const contentW = Math.max(boardPxW, viewportWidth * 1.5);
  const contentH = Math.max(boardPxH, viewportHeight * 1.5);

  // ── Render: not ready ────────────────────────────────────────────────
  if (layout.length === 0) {
    return (
      <div
        ref={viewportRef}
        style={{
          width: '100%', minHeight: 400,
          color: 'var(--text-muted, #888)',
          padding: 40, textAlign: 'center',
        }}
      >
        {boardRects.length === 0 ? '没有找到簇' : '加载画板布局...'}
      </div>
    );
  }

  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const pinnedSet = new Set(pinnedClusterIds);
  const firstParkingItem = layout.find((item) => !pinnedSet.has(item.i));
  const parkingLabelTop = firstParkingItem ? firstParkingItem.y * (RGL_ROW_HEIGHT + RGL_MARGIN[1]) - 28 : 0;

  return (
    <div
      ref={viewportRef}
      className={`organize-board${isSemanticZooming ? ' is-semantic-zooming' : ''}`}
      style={{
        width: '100%', height: '100%',
        overflow: 'hidden',
        position: 'relative',
        cursor: isPanning ? 'grabbing' : 'default',
      }}
      onPointerDown={handlePointerDownPan}
    >
      <style>{`
        .organize-board-rgl .react-grid-item img {
          pointer-events: auto !important;
          user-select: none;
        }
        .organize-board-rgl .react-grid-item {
          transition: none;
        }
        .organize-board.is-semantic-zooming * {
          transition: none !important;
        }
        .organize-board-rgl .react-grid-placeholder {
          background: var(--accent, #7c9bff) !important;
          border-radius: 8px;
          opacity: 0.25;
        }
        /* grab cursor for empty surface */
        .organize-board-content {
          min-width: ${contentW}px;
          min-height: ${contentH}px;
          padding: ${CANVAS_PAD}px;
          box-sizing: border-box;
          cursor: grab;
        }
        .organize-board-content .react-grid-item {
          cursor: default;
        }
        .organize-board-content .react-grid-item .cluster-card-drag-handle {
          cursor: move !important;
        }
      `}</style>

      {/* Camera scale layer — transforms the entire RGL board visually */}
      <div
        className="organize-board-camera-layer"
        style={{
          transform: `scale(${cameraZoom})`,
          transformOrigin: '0 0',
          width: `${(1 / cameraZoom) * 100}%`,
          height: `${(1 / cameraZoom) * 100}%`,
        }}
      >
        <div
          className="organize-board-content"
          style={{
            position: 'relative',
            pointerEvents: isPanning ? 'none' : undefined,
          }}
        >
          {pinnedClusterIds.length > 0 && (
            <div style={{
              position: 'absolute',
              left: 0,
              top: -28,
              color: 'var(--accent, #7c9bff)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}>
              工作区
            </div>
          )}
          {firstParkingItem && (
            <div style={{
              position: 'absolute',
              left: 0,
              top: parkingLabelTop,
              color: 'var(--text-faint, #777)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}>
              其他簇
            </div>
          )}
          <GridLayout
            className="organize-board-rgl"
            layout={layout}
            width={unscaledWidth}
            cols={RGL_COLS}
            rowHeight={RGL_ROW_HEIGHT}
            margin={RGL_MARGIN}
            containerPadding={RGL_CONTAINER_PADDING}
            draggableHandle=".cluster-card-drag-handle"
            draggableCancel=".organize-image-tile, .organize-image-tile *, .organize-image-tile img"
            compactType={null}
            isResizable={false}
            isDraggable={true}
            autoSize={true}
            transformScale={cameraZoom}
            onLayoutChange={handleLayoutChange}
            onDragStart={() => {
              isDraggingClusterRef.current = true;
            }}
            onDragStop={() => {
              isDraggingClusterRef.current = false;
              if (pendingReflowRef.current && !isSemanticZoomingRef.current) reflowCurrentFn();
            }}
          >
            {layout.map((item) => {
              const cluster = clusterMap.get(item.i);
              if (!cluster) return <div key={item.i} style={{ display: 'none' }} />;
              return <div key={item.i} id={`cluster-${item.i}`}>{renderClusterCard(cluster)}</div>;
            })}
          </GridLayout>
        </div>
      </div>
    </div>
  );
}

// ─── Reconcile (preserve positions, update sizes) ─────────────────────────

function reconcileLayout(
  currentItems: LayoutItem[],
  rects: BoardRect[],
  containerWidth: number,
  cols: number,
  rowHeight: number,
  margin: readonly [number, number],
  containerPadding: readonly [number, number],
): LayoutItem[] {
  const itemMap = new Map<string, LayoutItem>();
  for (const item of currentItems) itemMap.set(item.i, { ...item });
  const activeIds = new Set(rects.map((r) => r.clusterId));
  for (const id of itemMap.keys()) if (!activeIds.has(id)) itemMap.delete(id);
  const result: LayoutItem[] = [];
  for (const rect of rects) {
    const { w: newW, h: newH } = pxToGridUnits(rect.w, rect.h, containerWidth, cols, rowHeight, margin, containerPadding);
    const minW = Math.max(1, newW - 1);
    const minH = Math.max(1, newH - 1);
    const existing = itemMap.get(rect.clusterId);
    if (existing) {
      result.push({
        ...existing,
        w: Math.max(existing.w, minW),
        h: Math.max(existing.h, minH),
        minW, minH, maxW: cols,
      });
    } else {
      const maxY = currentItems.reduce((m, item) => Math.max(m, item.y + item.h), 0);
      result.push({
        i: rect.clusterId, x: 0, y: maxY,
        w: newW, h: newH, minW, minH, maxW: cols,
        static: false, isDraggable: true, isResizable: false,
      });
    }
  }
  return result;
}

export default forwardRef(RglManualBoardLayout);
