import { useMemo, useState } from 'react';
import WorkspaceImageCard from './WorkspaceImageCard';
import ImageFitControls from './ImageFitControls';
import type {
  WorkspaceImageData,
  WorkspaceBadgeDef,
  WorkspaceMetricDef,
  WorkspaceHoverField,
  FitMode,
} from './types';

export interface WorkspaceImageCardItem {
  key: string;
  data: WorkspaceImageData;
  badges: WorkspaceBadgeDef[];
  metrics: WorkspaceMetricDef[];
  hoverFields: WorkspaceHoverField[];
  sliceReason?: string;
  rank?: number;
}

export interface WorkspaceImageGridProps {
  jobId: string;
  items: WorkspaceImageCardItem[];
  total: number;
  loading?: boolean;
  headerLabel?: string;
  headerHint?: string;
  fitMode?: FitMode;
  thumbnailSize?: number;
  thumbnailQualityKey?: string;
  onFitModeChange?: (mode: FitMode) => void;
  onLoadMore?: () => void;
  loadMoreText?: string;
  selectedImageIds?: Set<string>;
  onToggleImageSelection?: (imageId: string) => void;
}

function getFieldNumber(fields: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatFileSize(fields: Record<string, any>): string {
  const mb = getFieldNumber(fields, ['file_size_mb']);
  if (mb !== null) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  const bytes = getFieldNumber(fields, ['original_file_size_bytes', 'file_size_bytes']);
  if (bytes !== null) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return '未知';
}

function formatDimensions(fields: Record<string, any>): string {
  const width = fields.original_width ?? fields.width;
  const height = fields.original_height ?? fields.height;
  return width && height ? `${width} x ${height}` : '未知';
}

function DetailPanel({ item }: { item: WorkspaceImageCardItem | null }) {
  const fields = item?.data.fields || {};
  const imageId = item?.data.image_id || '';
  return (
    <aside style={styles.detailPanel}>
      <div style={styles.detailTitle}>图片详情</div>
      {!item ? (
        <div style={styles.detailEmpty}>将鼠标停在图片上，或点击图片选择后，这里会显示命中原因和关键字段。</div>
      ) : (
        <>
          <div style={styles.detailFilename} title={item.data.filename}>{item.data.filename}</div>
          <div style={styles.detailGrid}>
            <span>原图尺寸</span><strong>{formatDimensions(fields)}</strong>
            <span>文件大小</span><strong>{formatFileSize(fields)}</strong>
            <span>当前切片</span><strong>{item.sliceReason || '当前结果'}</strong>
            <span>切片排序</span><strong>{item.rank ? `第 ${item.rank} 张` : '未记录'}</strong>
          </div>

          {item.badges.length > 0 && (
            <div style={styles.detailSection}>
              <div style={styles.detailSectionTitle}>判断标签</div>
              <div style={styles.badgeList}>
                {item.badges.map((badge, index) => (
                  <span key={index} style={styles.detailBadge}>{badge.label}</span>
                ))}
              </div>
            </div>
          )}

          {item.hoverFields.length > 0 && (
            <div style={styles.detailSection}>
              <div style={styles.detailSectionTitle}>为什么命中</div>
              {item.hoverFields.slice(0, 6).map((field, index) => (
                <div key={index} style={styles.reasonRow}>
                  <div>
                    <strong>{field.label}</strong>
                    {field.hint && <p>{field.hint}</p>}
                  </div>
                  <code>{field.value}</code>
                </div>
              ))}
            </div>
          )}

          <details style={styles.debugDetails}>
            <summary>调试字段</summary>
            <div style={styles.debugText}>image_id: {imageId || '无'}</div>
          </details>
        </>
      )}
    </aside>
  );
}

export default function WorkspaceImageGrid({
  jobId,
  items,
  total,
  loading = false,
  headerLabel,
  headerHint,
  fitMode = 'fit',
  thumbnailSize = 240,
  thumbnailQualityKey,
  onFitModeChange,
  onLoadMore,
  loadMoreText,
  selectedImageIds,
  onToggleImageSelection,
}: WorkspaceImageGridProps) {
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const inspectedItem = useMemo(() => {
    const selected = items.find((item) => item.data.image_id && selectedImageIds?.has(item.data.image_id));
    return selected || items.find((item) => item.key === inspectedKey) || items[0] || null;
  }, [inspectedKey, items, selectedImageIds]);

  if (loading && items.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.loadingState}>
          <span style={styles.loadingIcon}>⌛</span>
          <span style={styles.loadingText}>正在加载图片...</span>
        </div>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.emptyState}>
          <span style={styles.emptyIcon}>□</span>
          <span style={styles.emptyText}>暂无图片</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {headerLabel && <span style={styles.headerLabel}>{headerLabel}</span>}
          {headerHint && <span style={styles.headerHint}>{headerHint}</span>}
        </div>
        {onFitModeChange && (
          <ImageFitControls fitMode={fitMode} onChange={onFitModeChange} />
        )}
      </div>

      <div style={styles.body}>
        <div style={styles.grid}>
          {items.map((item) => (
            <WorkspaceImageCard
              key={item.key}
              jobId={jobId}
              data={item.data}
              badges={item.badges}
              metrics={item.metrics}
              hoverFields={item.hoverFields}
              sliceReason={item.sliceReason}
              fitMode={fitMode}
              thumbnailSize={thumbnailSize}
              thumbnailQualityKey={thumbnailQualityKey}
              selected={!!(item.data.image_id && selectedImageIds?.has(item.data.image_id))}
              onInspect={() => setInspectedKey(item.key)}
              onClick={
                item.data.image_id && onToggleImageSelection
                  ? () => {
                    setInspectedKey(item.key);
                    onToggleImageSelection(item.data.image_id as string);
                  }
                  : undefined
              }
            />
          ))}
        </div>
        <DetailPanel item={inspectedItem} />
      </div>

      {total > items.length && onLoadMore && (
        <div style={styles.footer}>
          <button
            onClick={onLoadMore}
            disabled={loading}
            style={{ ...styles.loadMoreBtn, ...(loading ? styles.loadMoreBtnDisabled : {}) }}
          >
            {loading ? '加载中...' : (loadMoreText || `加载更多 (${items.length}/${total})`)}
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 4px 8px',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  headerHint: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
  },
  body: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 280px',
    gap: 14,
    alignItems: 'start',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
  },
  detailPanel: {
    position: 'sticky',
    top: 12,
    minHeight: 220,
    padding: 12,
    borderRadius: 'var(--radius-md, 8px)',
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--surface, #1e1e2e)',
  },
  detailTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 8,
  },
  detailEmpty: {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--text-muted, #888)',
  },
  detailFilename: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginBottom: 8,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '70px minmax(0, 1fr)',
    gap: '6px 8px',
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  detailSection: {
    marginTop: 12,
  },
  detailSectionTitle: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 6,
  },
  badgeList: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
  },
  detailBadge: {
    padding: '2px 7px',
    borderRadius: 999,
    background: 'var(--accent-soft, rgba(124,155,255,0.14))',
    color: 'var(--accent, #7c9bff)',
    fontSize: 11,
    fontWeight: 700,
  },
  reasonRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    padding: '7px 0',
    borderBottom: '1px solid var(--border, #2a2a3e)',
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  debugDetails: {
    marginTop: 10,
    fontSize: 11,
    color: 'var(--text-faint, #666)',
  },
  debugText: {
    marginTop: 6,
    wordBreak: 'break-all',
    fontFamily: 'monospace',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    padding: '12px 0',
  },
  loadMoreBtn: {
    padding: '6px 16px',
    fontSize: 11,
    fontWeight: 500,
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
  loadMoreBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 0',
    gap: 12,
  },
  loadingIcon: { fontSize: 32, opacity: 0.4 },
  loadingText: { fontSize: 12, color: 'var(--text-faint, #555)' },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 0',
    gap: 12,
  },
  emptyIcon: { fontSize: 32, opacity: 0.4 },
  emptyText: { fontSize: 12, color: 'var(--text-faint, #555)' },
};
