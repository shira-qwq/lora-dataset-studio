import { useState, useCallback } from 'react';
import type { ClusterData, ImageData } from './types';
import ImageViewerOverlay from '../ImageViewerOverlay';
import { getOriginalImageUrl } from '../../api/client';
import { getStableImageId } from '../../analysis/exportCart';

interface ClusterCardProps {
  jobId: string;
  cluster: ClusterData;
  selectedFilenames: Set<string>;
  collapsed: boolean;
  /** P10-005D: tile size in pixels — fixed stable frame for each image */
  tilePixelSize: number;
  /** P10-005F: explicit columns for this cluster contact sheet */
  clusterColumns: number;
  /** P10-005D: fit mode — 'cover' (cropped) or 'contain' (full image) */
  fitMode: 'cover' | 'contain';
  /** P10-006A: board mode — shows/hides drag handle for manual board */
  boardMode?: 'flow' | 'manual';
  /** P10-007: workbench pin state for smart arrange */
  isPinned?: boolean;
  /** P10-006A: pointer event handler for manual board drag (only on the handle) */
  dragHandleProps?: {
    onPointerDown: (event: React.PointerEvent) => void;
  };
  onSelectImage: (filename: string, shiftKey: boolean, ctrlKey: boolean) => void;
  onDragStart: (filename: string) => void;
  onDragEnd?: () => void;
  onDrop: (filename: string, targetClusterId: string) => void;
  onRename: (clusterId: string, newName: string) => void;
  onToggleCollapse: (clusterId: string) => void;
  onTogglePin?: (clusterId: string) => void;
  /** Called when the whole cluster card is dragged to reorder (flow mode) */
  onClusterDragStart?: (clusterId: string) => void;
  onClusterDrop?: (clusterId: string, targetClusterId: string) => void;
}

const CARD_PADDING = 8;
const CARD_BORDER_WIDTH = 1;

function getGap(tilePx: number): number {
  if (tilePx <= 72) return 4;
  if (tilePx <= 96) return 6;
  if (tilePx <= 128) return 8;
  return 10;
}

export default function ClusterCard({
  jobId, cluster, selectedFilenames, collapsed, tilePixelSize, clusterColumns,
  fitMode = 'cover', boardMode = 'flow', dragHandleProps, isPinned = false,
  onSelectImage, onDragStart, onDragEnd, onDrop, onRename, onToggleCollapse, onTogglePin,
  onClusterDragStart, onClusterDrop,
}: ClusterCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(cluster.name);
  const [previewImage, setPreviewImage] = useState<ImageData | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault(); setIsDragOver(false);
      const fn = e.dataTransfer.getData('text/plain');
      if (fn) { onDrop(fn, cluster.id); }
    }, [cluster.id, onDrop]);

  const handleClusterDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault(); setIsDragOver(false);
      const cid = e.dataTransfer.getData('text/cluster-id');
      if (cid && cid !== cluster.id && onClusterDrop) {
        onClusterDrop(cid, cluster.id);
      }
    }, [cluster.id, onClusterDrop]);

  const handleRenameSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== cluster.name) onRename(cluster.id, trimmed);
    setEditing(false);
  };

  const gap = getGap(tilePixelSize);
  const safeColumns = Math.max(1, Math.floor(clusterColumns));
  const cardContentWidth = safeColumns * tilePixelSize + (safeColumns - 1) * gap;
  const cardWidth = cardContentWidth + CARD_PADDING * 2 + CARD_BORDER_WIDTH * 2;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        const hasClusterId = e.dataTransfer.types.includes('text/cluster-id');
        const hasFile = e.dataTransfer.types.includes('text/plain') && !hasClusterId;
        if (hasClusterId) {
          handleClusterDrop(e);
        } else if (hasFile) {
          handleDrop(e);
        }
      }}
      style={{
        background: isDragOver ? 'var(--accent-soft, rgba(124,155,255,0.08))' : 'var(--card-bg, #1e1e2e)',
        border: `${CARD_BORDER_WIDTH}px solid var(--card-border, #2a2a3e)`,
        outline: isDragOver ? '2px dashed var(--accent, #7c9bff)' : 'none',
        outlineOffset: 2,
        borderRadius: 8,
        padding: CARD_PADDING,
        width: cardWidth,
        flex: '0 0 auto',
        boxSizing: 'border-box',
        transition: 'outline-color 0.15s, background 0.15s',
      }}
    >
      {/* Header */}
      <div
        draggable={boardMode !== 'manual'}
        onDragStart={boardMode !== 'manual' ? (e) => {
          e.dataTransfer.setData('text/cluster-id', cluster.id);
          onClusterDragStart?.(cluster.id);
        } : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: collapsed ? 0 : 8,
          cursor: boardMode === 'manual' ? 'default' : 'grab',
          touchAction: boardMode === 'manual' ? 'none' : 'auto',
        }}
        title={boardMode === 'manual' ? undefined : '拖动簇卡片调整顺序'}
      >
        {boardMode === 'manual' && (
          <span
            className="cluster-card-drag-handle"
            onPointerDown={(e) => dragHandleProps?.onPointerDown(e)}
            style={{
              cursor: 'grab', fontSize: 14, lineHeight: 1,
              color: 'var(--text-faint, #555)', padding: '2px 4px',
              borderRadius: 3, userSelect: 'none', touchAction: 'none',
            }}
            title="拖动画板块"
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover, #262640)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >⠿</span>
        )}
        <button onClick={() => onToggleCollapse(cluster.id)}
          style={{ background: 'none', border: 'none', color: 'var(--text-faint, #555)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
          {collapsed ? '▶' : '▼'}
        </button>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: cluster.color || 'var(--success, #46f1c5)', flexShrink: 0 }} />
        {editing ? (
          <input autoFocus value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setEditing(false); }}
            style={{
              flex: 1, padding: '2px 6px', background: 'var(--bg, #12121a)', border: '1px solid var(--accent, #7c9bff)',
              borderRadius: 3, color: 'var(--text, #e0e0e8)', fontSize: 13, fontWeight: 600, outline: 'none', fontFamily: 'inherit',
            }} />
        ) : (
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text, #e0e0e8)', cursor: 'pointer' }}
            onDoubleClick={() => { setEditValue(cluster.name); setEditing(true); }} title="双击重命名">
            {cluster.name}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--text-faint, #555)' }}>#{cluster.id}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>{cluster.images.length}</span>
        {onTogglePin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(cluster.id);
            }}
            style={{
              padding: '2px 6px',
              border: `1px solid ${isPinned ? 'var(--accent, #7c9bff)' : 'var(--border, #2a2a3e)'}`,
              borderRadius: 999,
              background: isPinned ? 'var(--accent-soft, rgba(124,155,255,0.14))' : 'transparent',
              color: isPinned ? 'var(--accent, #7c9bff)' : 'var(--text-faint, #777)',
              cursor: 'pointer',
              fontSize: 10,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
            }}
            title={isPinned ? '移出工作区' : '加入工作区'}
          >
            {isPinned ? '已钉住' : '钉住'}
          </button>
        )}
        {boardMode !== 'manual' && (
          <span style={{ fontSize: 9, color: 'var(--text-faint, #555)', cursor: 'grab' }} title="拖动调整簇顺序">⠿</span>
        )}
      </div>

      {/* P10-005E: Contact sheet grid — denser, gap by tile size */}
      {!collapsed && cluster.images.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${safeColumns}, ${tilePixelSize}px)`,
          gap: `${gap}px`,
          justifyContent: 'start',
        }}>
          {cluster.images.map((img) => (
            <div
              key={img.filename}
              className="organize-image-tile"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', img.filename);
                onDragStart(img.filename);
              }}
              onDragEnd={() => onDragEnd?.()}
              onClick={(e) => onSelectImage(img.filename, e.shiftKey, e.ctrlKey || e.metaKey)}
              style={{
                width: tilePixelSize,
                height: tilePixelSize,
                boxSizing: 'border-box',
                overflow: 'hidden',
                borderRadius: 4,
                border: selectedFilenames.has(img.filename) ? '2px solid var(--accent, #7c9bff)' : '2px solid transparent',
                cursor: 'pointer',
                position: 'relative',
                flexShrink: 0,
              }}
              title="点击选择，Ctrl+点击多选"
            >
              <img
                src={img.thumbUrl}
                alt={img.filename}
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: fitMode === 'cover' ? 'cover' : 'contain',
                  display: 'block',
                }}
              />

              {/* Preview icon — appears on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewImage(img);
                }}
                style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 18, height: 18, padding: 0,
                background: 'rgba(0,0,0,0.5)', border: 'none',
                borderRadius: 3, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0.72, transition: 'opacity 0.15s',
                  color: '#fff', fontSize: 10, lineHeight: 1,
                }}
                className="thumb-preview-btn"
                title="点击预览完整图"
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.72')}
                onFocus={(e) => (e.currentTarget.style.opacity = '1')}
                onBlur={(e) => (e.currentTarget.style.opacity = '0')}
              >
                👁
              </button>

              {selectedFilenames.has(img.filename) && (
                <div style={{
                  position: 'absolute', top: 2, left: 2,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--accent, #7c9bff)', color: 'var(--bg, #12121a)',
                  fontSize: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700,
                }}>
                  ✓
                </div>
              )}

              {/* Filename overlay on hover */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '1px 3px', background: 'rgba(0,0,0,0.6)',
                fontSize: 8, color: '#ccc', textAlign: 'center',
                opacity: 0, transition: 'opacity 0.15s',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
                className="thumb-filename"
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
              >
                {img.filename}
              </div>
            </div>
          ))}
        </div>
      )}

      {!collapsed && cluster.images.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-faint, #555)', fontSize: 12 }}>
          拖入图片到这里
        </div>
      )}

      {previewImage && (
        <ImageViewerOverlay
          src={getOriginalImageUrl(jobId, previewImage.image_id || getStableImageId(previewImage))}
          filename={previewImage.filename}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}
