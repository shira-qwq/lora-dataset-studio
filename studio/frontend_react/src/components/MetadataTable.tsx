import type { MetadataRecord } from '../api/client';
import { fetchMetadataSummary } from '../api/client';
import { useState, useEffect, useCallback } from 'react';
import { getFieldMeta } from '../i18n/fieldDictionary';

interface MetadataTableProps {
  jobId: string;
  sortField: string;
  sortOrder: string;
  onSortChange: (field: string, order: string) => void;
}

/** Fields to display in the metadata table. */
const DISPLAY_FIELDS = [
  { value: 'megapixels', align: 'right' as const },
  { value: 'short_side', align: 'right' as const },
  { value: 'long_side', align: 'right' as const },
  { value: 'aspect_ratio', align: 'right' as const },
  { value: 'width', align: 'right' as const },
  { value: 'height', align: 'right' as const },
  { value: 'clipping_ratio', align: 'right' as const },
  { value: 'overexposed_ratio', align: 'right' as const },
  { value: 'underexposed_ratio', align: 'right' as const },
  { value: 'file_size_mb', align: 'right' as const },
  { value: 'orientation', align: 'center' as const },
];

export default function MetadataTable({
  jobId,
  sortField,
  sortOrder,
  onSortChange,
}: MetadataTableProps) {
  const [records, setRecords] = useState<MetadataRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMetadataSummary(jobId, sortField || undefined, sortOrder, 5000);
      setRecords(data.records || []);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message || 'Failed to load metadata');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [jobId, sortField, sortOrder]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSortClick = (field: string) => {
    if (field === sortField) {
      onSortChange(field, sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      onSortChange(field, 'desc');
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading metadata...</div>;
  }

  if (error) {
    return <div style={styles.error}>Failed to load metadata: {error}</div>;
  }

  if (!records.length) {
    return <div style={styles.empty}>No metadata records found.</div>;
  }

  const sortIndicator = (field: string) => {
    if (field !== sortField) return '';
    return sortOrder === 'desc' ? ' ↓' : ' ↑';
  };

  /** Render a cell value with formatting. */
  const fmtVal = (r: MetadataRecord, field: string): string => {
    const v = (r as any)[field];
    if (v === null || v === undefined) return '—';
    if (field === 'megapixels') return (v as number).toFixed(2);
    if (field === 'aspect_ratio') return (v as number).toFixed(4);
    if (field === 'clipping_ratio' || field === 'overexposed_ratio' || field === 'underexposed_ratio') {
      return (v as number * 100).toFixed(1) + '%';
    }
    return String(v);
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.sortBar}>
        <span style={{ fontSize: 12, color: '#888', marginRight: 8 }}>Sort by:</span>
        {DISPLAY_FIELDS.map((f) => {
          const meta = getFieldMeta(f.value);
          return (
            <button
              key={f.value}
              onClick={() => handleSortClick(f.value)}
              title={`${meta.description_zh}${meta.unit ? ` (${meta.unit})` : ''}`}
              style={{
                ...styles.sortBtn,
                background: f.value === sortField ? '#3a3a5e' : '#1e1e2e',
                color: f.value === sortField ? '#7c9bff' : '#aaa',
                border: f.value === sortField ? '1px solid #7c9bff' : '1px solid #2a2a3e',
              }}
            >
              {meta.label_zh}
              {sortIndicator(f.value)}
            </button>
          );
        })}
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>Image</th>
              {DISPLAY_FIELDS.map((f) => {
                const meta = getFieldMeta(f.value);
                const thStyle = f.align === 'right' ? styles.thRight : f.align === 'center' ? styles.thCenter : styles.th;
                return (
                  <th key={f.value} style={thStyle} title={`${meta.description_zh}${meta.unit ? ` (${meta.unit})` : ''}`}>
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
                {DISPLAY_FIELDS.map((f) => {
                  const meta = getFieldMeta(f.value);
                  const cellVal = fmtVal(r, f.value);
                  const tdStyle = f.align === 'right' ? styles.tdRight : f.align === 'center' ? styles.tdCenter : styles.td;
                  return (
                    <td
                      key={f.value}
                      style={{
                        ...tdStyle,
                        color: (f.value === 'clipping_ratio' || f.value === 'overexposed_ratio')
                          && r.clipping_ratio != null && r.clipping_ratio > 0.1
                          ? '#e74c3c'
                          : tdStyle.color,
                      }}
                      title={`${meta.label_zh}: ${cellVal}${meta.unit ? ` ${meta.unit}` : ''}`}
                    >
                      {cellVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={styles.footer}>Total: {total} images</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { width: '100%' },
  sortBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  sortBtn: {
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  loading: { padding: 24, textAlign: 'center' as const, color: '#888' },
  error: { padding: 24, textAlign: 'center' as const, color: '#e74c3c' },
  empty: { padding: 24, textAlign: 'center' as const, color: '#888' },
  tableWrap: { overflowX: 'auto' as const },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    padding: '6px 8px',
    textAlign: 'left' as const,
    borderBottom: '2px solid #2a2a3e',
    color: '#888',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  thRight: {
    padding: '6px 8px',
    textAlign: 'right' as const,
    borderBottom: '2px solid #2a2a3e',
    color: '#888',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  thCenter: {
    padding: '6px 8px',
    textAlign: 'center' as const,
    borderBottom: '2px solid #2a2a3e',
    color: '#888',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  tr: { borderBottom: '1px solid #2a2a3e' },
  td: { padding: '4px 8px', color: '#ccc' },
  tdMuted: { padding: '4px 8px', color: '#666' },
  tdRight: { padding: '4px 8px', textAlign: 'right' as const, color: '#ccc' },
  tdCenter: { padding: '4px 8px', textAlign: 'center' as const, color: '#ccc' },
  cellText: {
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    display: 'inline-block',
  },
  footer: {
    padding: '8px 0',
    fontSize: 11,
    color: '#888',
    textAlign: 'center' as const,
  },
};
