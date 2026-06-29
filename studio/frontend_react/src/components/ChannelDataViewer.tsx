/**
 * ChannelDataViewer — 通用分析通道数据浏览组件
 *
 * 支持从 backend 加载任意 analysis channel 的摘要数据，
 * 显示可排序表格和标签筛选。
 *
 * P09-002: 所有颜色通过 CSS 变量定义，主题自适应。
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchMetadataSummary,
  fetchHistogramSummary,
  fetchQualityEdgeSummary,
} from '../api/client';
import { getFieldMeta } from '../i18n/fieldDictionary';
import { t } from '../i18n/uiDictionary';

interface ChannelDataViewerProps {
  /** Channel key: basic_metadata | histogram | quality_edge */
  channelKey: string;
  jobId: string;
  /** Whether to show debug-only fields */
  showDebug: boolean;
  /** Called when user clicks close */
  onClose: () => void;
}

/** Sort-only fields from the manifest that are sortable. */
const CHANNEL_SORT_FIELDS: Record<string, string[]> = {
  basic_metadata: [
    'megapixels', 'short_side', 'long_side', 'aspect_ratio',
    'clipping_ratio', 'overexposed_ratio', 'underexposed_ratio',
    'file_size_mb', 'width', 'height', 'orientation',
  ],
  histogram: [
    'brightness_dark_ratio', 'brightness_bright_ratio', 'brightness_entropy',
    'saturation_low_ratio', 'saturation_high_ratio', 'hue_warm_ratio', 'hue_cool_ratio',
    'histogram_outlier_score',
  ],
  quality_edge: [
    'sharpness_score', 'blur_laplacian_var', 'edge_density',
    'edge_strength_p95', 'local_contrast_p95', 'hue_coverage',
    'lineart_score_v2', 'high_contrast_score_v2', 'flat_color_score',
  ],
};

/** Label filter fields per channel (values that can be used for label filtering). */
const CHANNEL_LABEL_FIELDS: Record<string, string[]> = {
  histogram: [
    'low_key', 'high_key', 'high_contrast', 'flat_light',
    'muted', 'vivid', 'warm', 'cool', 'mixed_color', 'lineart_like_candidate',
  ],
  quality_edge: [],
  basic_metadata: [],
};

export default function ChannelDataViewer({
  channelKey,
  jobId,
  showDebug,
  onClose,
}: ChannelDataViewerProps) {
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterLabel, setFilterLabel] = useState<string | null>(null);

  const sortFields = CHANNEL_SORT_FIELDS[channelKey] || [];
  const labelFields = CHANNEL_LABEL_FIELDS[channelKey] || [];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let data: any;
      switch (channelKey) {
        case 'basic_metadata':
          data = await fetchMetadataSummary(jobId, sortField || undefined, sortOrder, 200);
          break;
        case 'histogram':
          data = await fetchHistogramSummary(jobId, sortField || undefined, sortOrder, filterLabel || undefined, 200);
          break;
        case 'quality_edge':
          data = await fetchQualityEdgeSummary(jobId, sortField || undefined, sortOrder, filterLabel || undefined, 200);
          break;
        default:
          throw new Error(`Unknown channel: ${channelKey}`);
      }
      setRecords(data.records || []);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [channelKey, jobId, sortField, sortOrder, filterLabel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSortClick = (field: string) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sortIndicator = (field: string) => {
    if (field !== sortField) return '';
    return sortOrder === 'desc' ? ' ↓' : ' ↑';
  };

  // Determine which columns to display (from sort fields + any extra columns in data)
  const displayFields = sortFields.length > 0
    ? sortFields
    : (records.length > 0 ? Object.keys(records[0]).filter((k) => k !== 'image_path') : []);

  // Format cell value
  const fmtVal = (r: any, field: string): string => {
    const v = r[field];
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(4);
    }
    return String(v);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerTitle}>
            {channelKey === 'basic_metadata'
              ? t('channel.basicMetadata', 'Basic Metadata')
              : channelKey === 'histogram'
                ? t('channel.histogram', 'Histogram')
                : t('channel.qualityEdge', 'Quality/Edge')}
          </span>
          <span style={styles.headerMeta}>
            {total} {total === 1 ? 'record' : 'records'}
          </span>
        </div>
        <button style={styles.closeBtn} onClick={onClose}>
          ✕ {t('common.close', '关闭')}
        </button>
      </div>

      {/* Sort bar */}
      {sortFields.length > 0 && (
        <div style={styles.sortBar}>
          <span style={styles.sortLabel}>{t('analysis.sortAction', '排序')}:</span>
          {sortFields.map((field) => {
            const meta = getFieldMeta(field);
            // Skip debug-only fields in normal view
            if (!showDebug && meta.visibility === 'debug') return null;
            return (
              <button
                key={field}
                onClick={() => handleSortClick(field)}
                title={`${meta.description_zh}${meta.unit ? ` (${meta.unit})` : ''}`}
                style={{
                  ...styles.sortBtn,
                  background: field === sortField ? 'var(--surface-active, #2a2a48)' : 'var(--surface, #1e1e2e)',
                  color: field === sortField ? 'var(--accent, #7c9bff)' : 'var(--text-secondary, #aaa)',
                  border: field === sortField ? '1px solid var(--accent, #7c9bff)' : '1px solid var(--border, #2a2a3e)',
                }}
              >
                {meta.label_zh}
                {sortIndicator(field)}
              </button>
            );
          })}
        </div>
      )}

      {/* Label filter */}
      {labelFields.length > 0 && (
        <div style={styles.filterBar}>
          <span style={styles.sortLabel}>{t('analysis.filterAction', '筛选')}:</span>
          <button
            style={{
              ...styles.filterBtn,
              background: !filterLabel ? 'var(--surface-active, #2a2a48)' : 'var(--surface, #1e1e2e)',
              color: !filterLabel ? 'var(--accent, #7c9bff)' : 'var(--text-secondary, #aaa)',
            }}
            onClick={() => setFilterLabel(null)}
          >
            全部
          </button>
          {labelFields.map((label) => (
            <button
              key={label}
              style={{
                ...styles.filterBtn,
                background: filterLabel === label ? 'var(--surface-active, #2a2a48)' : 'var(--surface, #1e1e2e)',
                color: filterLabel === label ? 'var(--accent, #7c9bff)' : 'var(--text-secondary, #aaa)',
              }}
              onClick={() => setFilterLabel(label === filterLabel ? null : label)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Data table */}
      {loading && <div style={styles.statusText}>{t('common.loading', '加载中...')}</div>}
      {error && <div style={styles.statusError}>{t('common.error', '错误')}: {error}</div>}

      {!loading && !error && records.length === 0 && (
        <div style={styles.statusText}>{t('empty.noData', '暂无数据')}</div>
      )}

      {!loading && !error && records.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>Image</th>
                {displayFields.map((field) => {
                  const meta = getFieldMeta(field);
                  return (
                    <th
                      key={field}
                      style={styles.thRight}
                      title={`${meta.description_zh}${meta.unit ? ` (${meta.unit})` : ''}`}
                    >
                      {meta.label_zh}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.image_path || i} style={styles.tr}>
                  <td style={styles.tdMuted}>{i + 1}</td>
                  <td style={styles.td}>
                    <span title={r.image_path || ''} style={styles.cellText}>
                      {r.image_path || '—'}
                    </span>
                  </td>
                  {displayFields.map((field) => (
                    <td key={field} style={styles.tdRight}>
                      {fmtVal(r, field)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > records.length && (
        <div style={styles.footer}>
          {t('analysis.fieldCount', '{n} 个字段').replace('{n}', String(total))} total (showing {records.length})
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--surface-elevated, #1a1a28)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'var(--table-header-bg, #16161f)',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  headerMeta: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  closeBtn: {
    padding: '4px 10px',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  sortBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    flexWrap: 'wrap',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  sortLabel: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    marginRight: 4,
    flexShrink: 0,
  },
  sortBtn: {
    padding: '4px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.1s',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    flexWrap: 'wrap',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  filterBtn: {
    padding: '3px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'inherit',
    border: '1px solid var(--border, #2a2a3e)',
    whiteSpace: 'nowrap',
  },
  statusText: {
    padding: 24,
    textAlign: 'center',
    color: 'var(--text-muted, #888)',
    fontSize: 13,
  },
  statusError: {
    padding: 24,
    textAlign: 'center',
    color: 'var(--danger, #ff5a6e)',
    fontSize: 13,
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    padding: '6px 8px',
    textAlign: 'left',
    borderBottom: '2px solid var(--border, #2a2a3e)',
    color: 'var(--text-muted, #888)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  thRight: {
    padding: '6px 8px',
    textAlign: 'right',
    borderBottom: '2px solid var(--border, #2a2a3e)',
    color: 'var(--text-muted, #888)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  td: {
    padding: '4px 8px',
    color: 'var(--text, #e0e0e8)',
  },
  tdMuted: {
    padding: '4px 8px',
    color: 'var(--text-faint, #555)',
  },
  tdRight: {
    padding: '4px 8px',
    textAlign: 'right',
    color: 'var(--text, #e0e0e8)',
  },
  cellText: {
    maxWidth: 280,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'inline-block',
  },
  footer: {
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    textAlign: 'center',
    borderTop: '1px solid var(--border, #2a2a3e)',
  },
};
