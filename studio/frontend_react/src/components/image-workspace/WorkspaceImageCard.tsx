import { useState } from 'react';
import ThumbnailImage from './ThumbnailImage';
import ImageViewerOverlay from '../ImageViewerOverlay';
import type {
  WorkspaceImageData,
  WorkspaceBadgeDef,
  WorkspaceMetricDef,
  WorkspaceHoverField,
  FitMode,
} from './types';

export interface WorkspaceImageCardProps {
  jobId: string;
  data: WorkspaceImageData;
  badges: WorkspaceBadgeDef[];
  metrics: WorkspaceMetricDef[];
  hoverFields: WorkspaceHoverField[];
  sliceReason?: string;
  fitMode?: FitMode;
  thumbnailSize?: number;
  thumbnailQualityKey?: string;
  readOnly?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onInspect?: () => void;
}

function MetricBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const segments = 5;
  const filled = Math.round(clamped * segments);

  return (
    <div style={styles.metricRow}>
      <span style={styles.metricLabel}>{label}</span>
      <span style={styles.metricBarGroup}>
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            style={{
              ...styles.metricSeg,
              background: i < filled ? 'var(--accent, #7c9bff)' : 'var(--border, #2a2a3e)',
              opacity: i < filled ? 0.9 : 0.3,
            }}
          />
        ))}
      </span>
    </div>
  );
}

export default function WorkspaceImageCard({
  jobId,
  data,
  badges,
  metrics,
  hoverFields: _hoverFields,
  sliceReason: _sliceReason,
  fitMode = 'fit',
  thumbnailSize = 240,
  thumbnailQualityKey,
  readOnly = false,
  selected = false,
  onClick,
  onInspect,
}: WorkspaceImageCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const shortName = data.filename.split('/').pop()
    || data.filename.split('\\').pop()
    || data.filename;

  return (
    <div
      style={{ ...styles.card, ...(selected ? styles.cardSelected : {}) }}
      onMouseEnter={() => !readOnly && onInspect?.()}
      onFocus={() => !readOnly && onInspect?.()}
      onClick={onClick}
    >
      <div style={styles.thumbWrap}>
        <ThumbnailImage
          jobId={jobId}
          imagePath={data.image_path}
          thumbnailUrl={data.thumbnailUrl}
          size={thumbnailSize}
          qualityKey={thumbnailQualityKey}
          fitMode={fitMode}
          alt={shortName}
        />
        {data.originalUrl && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            style={styles.previewBtn}
            title="查看原图"
            aria-label="查看原图"
          >
            👁
          </button>
        )}
      </div>

      {badges.length > 0 && (
        <div style={styles.badgeRow}>
          {badges.map((badge, index) => (
            <span
              key={index}
              style={badge.style === 'chip' ? styles.badgeChip : styles.badgeTag}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      <div style={styles.filename} title={data.filename}>
        {shortName}
      </div>

      {metrics.length > 0 && (
        <div style={styles.metrics}>
          {metrics.map((metric, index) => (
            <MetricBar key={index} value={metric.value} label={metric.label} />
          ))}
        </div>
      )}

      {previewOpen && (
        <ImageViewerOverlay
          originalUrl={data.originalUrl || null}
          filename={data.filename || data.image_id}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    position: 'relative',
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
    overflow: 'hidden',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 200,
  },
  cardSelected: {
    borderColor: 'var(--accent, #7c9bff)',
    boxShadow: '0 0 0 1px var(--accent, #7c9bff)',
  },
  thumbWrap: {
    position: 'relative',
  },
  previewBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    width: 26,
    height: 24,
    padding: 0,
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 5,
    background: 'rgba(0,0,0,0.62)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  badgeRow: {
    display: 'flex',
    gap: 4,
    padding: '4px 6px 0',
    flexWrap: 'wrap',
  },
  badgeChip: {
    padding: '1px 6px',
    borderRadius: 'var(--radius-sm, 4px)',
    fontSize: 10,
    fontWeight: 600,
    background: 'var(--accent-soft, rgba(124,155,255,0.15))',
    color: 'var(--accent, #7c9bff)',
    whiteSpace: 'nowrap',
  },
  badgeTag: {
    padding: '1px 5px',
    borderRadius: 2,
    fontSize: 9,
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    color: 'var(--text-muted, #888)',
    whiteSpace: 'nowrap',
  },
  filename: {
    padding: '2px 6px 0',
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metrics: {
    padding: '4px 6px 6px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  metricLabel: {
    fontSize: 9,
    color: 'var(--text-faint, #555)',
    width: 24,
    flexShrink: 0,
  },
  metricBarGroup: {
    display: 'flex',
    gap: 2,
    flex: 1,
  },
  metricSeg: {
    flex: 1,
    height: 4,
    borderRadius: 1,
    transition: 'background 0.1s',
  },
};
