/**
 * ManualBoardLayout.tsx — P10-006B-HOTFIX2: Rect-first manual board.
 *
 * Receives pre-computed rects (frames) and positions (x/y) separately.
 * Renders cluster cards at computed positions using rect.w for width.
 * Rect.h is NEVER used as a CSS height — only for canvas sizing.
 *
 * Rect-first principle:
 * - rects come from buildBoardRects() — pure math from settings + imageCount
 * - positions come from layout algorithms — only x/y
 * - DOM ResizeObserver only validates, never drives layout
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ClusterData } from './types';
import type { BoardRect, BoardPosition } from './boardTypes';

interface ManualBoardLayoutProps {
  clusters: ClusterData[];
  rects: Record<string, BoardRect>;
  positions: Record<string, BoardPosition>;
  onPositionsChange: (positions: Record<string, BoardPosition>) => void;
  renderClusterCard: (cluster: ClusterData, handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
  }) => ReactNode;
}

const GRID_SIZE = 24;
const CANVAS_GAP = 16;

export default function ManualBoardLayout({
  clusters, rects, positions, onPositionsChange,
  renderClusterCard,
}: ManualBoardLayoutProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // Mutable ref for latest positions — used during drag to avoid stale closures
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});

  const [dragging, setDragging] = useState<{
    clusterId: string;
    startX: number;
    startY: number;
    itemStartX: number;
    itemStartY: number;
    pointerId: number;
  } | null>(null);

  // Sync positions ref
  useEffect(() => {
    positionsRef.current = {};
    for (const [id, pos] of Object.entries(positions)) {
      positionsRef.current[id] = { x: pos.x, y: pos.y };
    }
  }, [positions]);

  // Compute canvas height from rects + positions
  const canvasHeight = (() => {
    if (clusters.length === 0) return 400;
    let maxBottom = 0;
    for (const c of clusters) {
      const rect = rects[c.id];
      const pos = positions[c.id];
      if (rect && pos) {
        const bottom = pos.y + Math.max(rect.h, 100) + CANVAS_GAP;
        if (bottom > maxBottom) maxBottom = bottom;
      }
    }
    return Math.max(maxBottom, 400);
  })();

  // Pointer event handlers for dragging
  const handlePointerDown = useCallback(
    (clusterId: string, e: React.PointerEvent) => {
      const pos = positionsRef.current[clusterId];
      if (!pos) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      document.body.style.userSelect = 'none';
      setDragging({
        clusterId,
        startX: e.clientX,
        startY: e.clientY,
        itemStartX: pos.x,
        itemStartY: pos.y,
        pointerId: e.pointerId,
      });
    },
    [],
  );

  // Global pointer move/up when dragging
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      if (e.pointerId !== dragging.pointerId) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      const nextX = Math.max(0, Math.round((dragging.itemStartX + dx) / GRID_SIZE) * GRID_SIZE);
      const nextY = Math.max(0, Math.round((dragging.itemStartY + dy) / GRID_SIZE) * GRID_SIZE);
      const currentPos = positionsRef.current[dragging.clusterId];
      if (currentPos) {
        currentPos.x = nextX;
        currentPos.y = nextY;
      }
      // Notify parent with all current positions
      const updated: Record<string, { clusterId: string; x: number; y: number }> = {};
      for (const [id, p] of Object.entries(positionsRef.current)) {
        updated[id] = { clusterId: id, x: p.x, y: p.y };
      }
      onPositionsChange(updated);
    };
    const handleUp = () => {
      document.body.style.userSelect = '';
      setDragging(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, onPositionsChange]);

  return (
    <div
      ref={canvasRef}
      style={{
        position: 'relative',
        minHeight: canvasHeight,
        width: '100%',
      }}
    >
      {clusters.map((cluster) => {
        const rect = rects[cluster.id];
        const pos = positions[cluster.id];
        if (!rect || !pos) return null;
        const isDragging = dragging?.clusterId === cluster.id;
        return (
          <div
            key={cluster.id}
            id={`cluster-${cluster.id}`}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: rect.w,
              // NO height — content naturally expands
              // NO overflow hidden — don't clip content
              zIndex: isDragging ? 100 : 1,
              transition: isDragging ? 'none' : 'box-shadow 0.15s',
              boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.4)' : 'none',
            }}
          >
            {renderClusterCard(cluster, {
              onPointerDown: (e: React.PointerEvent) => handlePointerDown(cluster.id, e),
            })}
          </div>
        );
      })}
      {clusters.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted, #888)' }}>
          没有找到簇
        </div>
      )}
    </div>
  );
}
