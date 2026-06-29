interface DebugInfo {
  jobId: string;
  clusterCount: number;
  imageCount: number;
  firstImagePath: string | null;
  firstThumbUrl: string | null;
  lastError: string | null;
  apiBase: string;
  serverBase: string;
  missingThumbCount: number;
  hasThumbCount: number;
  firstRawImage?: string;
  firstNormalizedImage?: string;
}

export default function DebugPanel({ info }: { info: DebugInfo }) {
  return (
    <details style={{
      position: 'fixed', bottom: 8, right: 8, zIndex: 999,
      background: '#1a1a2e', border: '1px solid #3a3a4e',
      borderRadius: 6, padding: '4px 8px', fontSize: 10,
      color: '#888', maxWidth: 500, fontFamily: 'monospace',
    }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
        🐛 Debug
      </summary>
      <div style={{ marginTop: 4, lineHeight: 1.6 }}>
        <div>jobId: {info.jobId || '—'}</div>
        <div>server: {info.serverBase}</div>
        <div>api: {info.apiBase}</div>
        <div>clusters: {info.clusterCount}</div>
        <div>images: {info.imageCount}</div>
        <div>thumbs: {info.hasThumbCount} ok, {info.missingThumbCount} missing</div>
        <div>first img_path: {info.firstImagePath || '—'}</div>
        <div>
          first thumb:{' '}
          {info.firstThumbUrl ? (
            <a href={info.firstThumbUrl} target="_blank" rel="noreferrer"
               style={{ color: '#7c9bff', wordBreak: 'break-all' }}>
              {info.firstThumbUrl.substring(0, 80)}…
            </a>
          ) : '—'}
        </div>
        {info.lastError && (
          <div style={{ color: '#e74c3c', marginTop: 4 }}>
            last error: {info.lastError}
          </div>
        )}
      </div>
    </details>
  );
}
