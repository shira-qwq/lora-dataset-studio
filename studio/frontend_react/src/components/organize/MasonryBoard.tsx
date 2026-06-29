import { useRef, useEffect, useState, useCallback } from 'react';
import type { ClusterData } from './types';

const HEADER_HEIGHT = 56;
const PADDING = 24;
const GAP = 8;
const MIN_COLUMN_WIDTH = 340;
const CARD_GAP = 16;

function estimateClusterCardHeight(
  cluster: ClusterData,
  collapsed: boolean,
  thumbSize: number,
  columnWidth: number,
): number {
  const headerH = HEADER_HEIGHT;
  const pad = PADDING;
  if (collapsed || cluster.images.length === 0) {
    return headerH + pad;
  }
  const thumb = thumbSize;
  const gap = GAP;
  const imagesPerRow = Math.max(1, Math.floor((columnWidth - pad) / (thumb + gap)));
  const rows = Math.ceil(cluster.images.length / imagesPerRow);
  const gridH = rows * thumb + Math.max(0, rows - 1) * gap;
  return headerH + gridH + pad;
}

function getColumnCount(containerWidth: number): number {
  return Math.max(1, Math.floor(containerWidth / MIN_COLUMN_WIDTH));
}

function packClustersIntoColumns(
  clusters: ClusterData[],
  columnCount: number,
  collapsedMap: Set<string>,
  thumbSize: number,
  columnWidth: number,
): ClusterData[][] {
  const columns: ClusterData[][] = Array.from({ length: columnCount }, () => []);
  const heights: number[] = new Array(columnCount).fill(0);

  clusters.forEach((cluster) => {
    const h = estimateClusterCardHeight(
      cluster,
      collapsedMap.has(cluster.id),
      thumbSize,
      columnWidth,
    );
    let shortestIdx = 0;
    for (let i = 1; i < heights.length; i++) {
      if (heights[i] < heights[shortestIdx]) shortestIdx = i;
    }
    columns[shortestIdx].push(cluster);
    heights[shortestIdx] += h + CARD_GAP;
  });

  return columns;
}

interface MasonryBoardProps {
  clusters: ClusterData[];
  collapsedClusters: Set<string>;
  thumbSize: number;
  renderClusterCard: (cluster: ClusterData) => React.ReactNode;
}

export default function MasonryBoard({
  clusters, collapsedClusters, thumbSize, renderClusterCard,
}: MasonryBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(2);
  const [columnWidth, setColumnWidth] = useState(400);

  // Re-calculate on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const cc = getColumnCount(w);
        setColumnCount(cc);
        setColumnWidth((w - (cc - 1) * CARD_GAP) / cc);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Force re-pack trigger
  const [packKey, setPackKey] = useState(0);
  const requestRepack = useCallback(() => setPackKey((k) => k + 1), []);

  // Expose repack for parent
  useEffect(() => {
    (containerRef.current as any)?.__repack?.();
  }, []);

  // Notify parent that repack is available
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any).__repack = requestRepack;
      (containerRef.current as any).__columnCount = () => columnCount;
    }
  }, [columnCount, requestRepack]);

  // Re-pack when dependencies change
  const columns = packClustersIntoColumns(
    clusters, columnCount, collapsedClusters, thumbSize, columnWidth,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {}, [packKey, clusters.length, collapsedClusters.size, thumbSize, columnCount]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
        gap: CARD_GAP,
        alignItems: 'start',
        width: '100%',
      }}
    >
      {columns.map((col, ci) => (
        <div
          key={ci}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: CARD_GAP,
            minWidth: 0,
          }}
        >
          {col.map((cluster) => (
            <div key={cluster.id} style={{ breakInside: 'avoid' }}>
              {renderClusterCard(cluster)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
