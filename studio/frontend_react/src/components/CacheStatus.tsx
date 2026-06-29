import type { AnalysisStatus } from '../api/client';
import { t } from '../i18n/uiDictionary';

interface CacheStatusProps {
  status: AnalysisStatus | null;
  loading: boolean;
  error: string | null;
  jobId: string;
}

export default function CacheStatus({ status, loading, error, jobId }: CacheStatusProps) {
  if (loading) {
    return <div style={styles.container}>{t('common.loading', 'Loading analysis status...')}</div>;
  }

  if (error) {
    return <div style={{ ...styles.container, color: '#e74c3c' }}>{t('common.error', 'Error')}: {error}</div>;
  }

  if (!status) {
    return <div style={styles.container}>No status data</div>;
  }

  if (!status.basic_metadata_ready) {
    return (
      <div style={styles.container}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', marginBottom: 8 }}>
          Basic metadata analysis not built
        </div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>
          Run the following command to build metadata cache:
          <br />
          <code
            style={{
              background: '#1a1a2e',
              padding: '2px 6px',
              borderRadius: 3,
              fontSize: 11,
            }}
          >
            python tools/build_basic_metadata_channel.py --job-output &lt;job_output&gt;
          </code>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: '#888' }}>
          Job ID: {jobId}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge label={t('channel.basicMetadata', 'Basic Metadata')} ready={status.basic_metadata_ready} />
        <StatusBadge label={t('channel.histogram', 'Histogram')} ready={status.histogram_ready} />
        <StatusBadge label={t('channel.qualityEdge', 'Quality/Edge')} ready={status.quality_edge_ready} />
      </div>
      {status.capability && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
          已构建 {status.capability.total_built}/{status.capability.total_buildable} 通道
        </div>
      )}
      <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
        Job: {jobId}
      </div>
    </div>
  );
}

function StatusBadge({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        fontSize: 12,
        background: ready ? 'rgba(46,204,113,0.15)' : 'rgba(231,76,60,0.1)',
        color: ready ? '#2ecc71' : '#e74c3c',
        border: `1px solid ${ready ? 'rgba(46,204,113,0.3)' : 'rgba(231,76,60,0.2)'}`,
      }}
    >
      {ready ? '✅' : '❌'} {label}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    background: '#1e1e2e',
    borderRadius: 8,
    border: '1px solid #2a2a3e',
    marginBottom: 16,
  },
};
