import { useEffect, useMemo, useState } from 'react';

export interface ImagePreviewMeta {
  filename?: string;
  clusterName?: string;
  width?: number | string;
  height?: number | string;
  fileSizeMb?: number | string;
}

interface ImagePreviewModalProps {
  open: boolean;
  jobId: string;
  imageId?: string;
  originalUrl?: string | null;
  filename: string;
  fallbackSrc?: string;
  meta?: ImagePreviewMeta;
  onClose: () => void;
}

function formatSize(value: number | string | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return `${value.toFixed(value >= 10 ? 1 : 2)} MB`;
  return String(value);
}

export default function ImagePreviewModal({
  open,
  imageId,
  originalUrl,
  filename,
  fallbackSrc,
  meta,
  onClose,
}: ImagePreviewModalProps) {
  const [mode, setMode] = useState<'original' | 'fallback' | 'failed'>('original');
  const [lastError, setLastError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(originalUrl ? 'original' : 'fallback');
    setLastError(imageId ? '' : '没有 image_id，无法请求原图接口。');
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, originalUrl, onClose]);

  const originalSrc = useMemo(() => {
    return originalUrl || '';
  }, [originalUrl]);

  if (!open) return null;

  const src = mode === 'original' ? originalSrc : mode === 'fallback' ? fallbackSrc : '';
  const sizeText = formatSize(meta?.fileSizeMb);
  const dimensionText = meta?.width && meta?.height ? `${meta.width} x ${meta.height}` : null;
  const showingFallback = mode === 'fallback';
  const failed = mode === 'failed' || !src;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.shell} onClick={(event) => event.stopPropagation()}>
        <div style={styles.imageStage}>
          {showingFallback && (
            <div style={styles.notice}>
              原图接口不可用，当前显示最大可用预览图。原因：{lastError || '后端原图 endpoint 返回错误。'}
            </div>
          )}
          {failed ? (
            <div style={styles.failedBox}>
              <div style={styles.failedTitle}>无法显示大图</div>
              <div style={styles.failedText}>
                {lastError || '原图和预览图都加载失败。请检查 image_id、原图路径和后端 results/image endpoint。'}
              </div>
            </div>
          ) : (
            <img
              src={src}
              alt={filename}
              style={styles.image}
              onError={() => {
                if (mode === 'original' && fallbackSrc) {
                  setLastError('image_id 找不到原图，已尝试切换到预览图。');
                  setMode('fallback');
                  return;
                }
                setLastError(mode === 'original'
                  ? '原图 endpoint 报错，且没有可用预览图。'
                  : '预览图也加载失败。');
                setMode('failed');
              }}
            />
          )}
        </div>
        <div style={styles.footer}>
          <div style={styles.title}>{filename}</div>
          <div style={styles.metaRow}>
            {dimensionText && <span>尺寸：{dimensionText}</span>}
            {sizeText && <span>大小：{sizeText}</span>}
            {meta?.clusterName && <span>所属簇：{meta.clusterName}</span>}
            {imageId && <span title={imageId}>image_id：{imageId.slice(0, 18)}...</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} style={styles.closeBtn} title="关闭 (ESC)">
          x
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.86)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    cursor: 'zoom-out',
  },
  shell: {
    position: 'relative',
    maxWidth: '92vw',
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'default',
  },
  imageStage: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 280,
    minHeight: 180,
  },
  image: {
    maxWidth: '92vw',
    maxHeight: '80vh',
    objectFit: 'contain',
    borderRadius: 6,
    boxShadow: '0 14px 42px rgba(0,0,0,0.55)',
    background: 'var(--bg, #12121a)',
  },
  notice: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 1,
    maxWidth: 520,
    padding: '6px 9px',
    borderRadius: 5,
    background: 'rgba(20,20,28,0.9)',
    color: 'var(--warning, #f5a623)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  failedBox: {
    width: 'min(560px, 88vw)',
    padding: 24,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(18,18,26,0.94)',
    color: '#fff',
  },
  failedTitle: { fontSize: 16, fontWeight: 800, marginBottom: 8 },
  failedText: { fontSize: 13, lineHeight: 1.7, color: '#bbb' },
  footer: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    background: 'rgba(18,18,26,0.9)',
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    maxWidth: '88vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 4,
    color: '#aaa',
    fontSize: 11,
  },
  closeBtn: {
    position: 'absolute',
    top: -34,
    right: 0,
    background: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
    fontFamily: 'inherit',
  },
};
