/**
 * SourceCard — 图片来源步骤
 *
 * DropZone / 粘贴 / 输入 + 扫描按钮 + 扫描结果 badge
 */
import Input from '../ui/Input';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

interface ScanResult {
  ok: boolean;
  msg: string;
  details?: string;
}

interface SourceCardProps {
  value: string;
  onChange: (val: string) => void;
  onScan: () => void;
  scanning: boolean;
  scanResult: ScanResult | null;
  disabled?: boolean;
  isDragOver: boolean;
}

export default function SourceCard({
  value, onChange, onScan, scanning, scanResult, disabled, isDragOver,
}: SourceCardProps) {
  return (
    <div style={styles.card}>
      {/* Step header */}
      <div style={styles.stepHeader}>
        <span style={styles.stepNum}>1</span>
        <div>
          <div style={styles.stepTitle}>图片来源</div>
          <div style={styles.stepDesc}>选择包含图片的本地文件夹</div>
        </div>
      </div>

      {/* DropZone */}
      <div style={{
        ...styles.dropZone,
        ...(isDragOver ? styles.dropZoneActive : {}),
      }}>
        <div style={styles.dropIcon}>📂</div>
        <div style={styles.dropText}>拖拽图片文件夹，或粘贴本地路径</div>
        <div style={styles.dropHelper}>普通浏览器可能无法读取真实绝对路径，请使用粘贴路径或本地工具能力。</div>
      </div>

      {/* Input + Scan button */}
      <div style={styles.inputRow}>
        <Input
          name="imageRoot"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') onScan();
          }}
          placeholder="D:\Pictures\my_dataset"
          disabled={disabled}
          style={{ flex: 1 }}
        />
        <Button
          onClick={onScan}
          loading={scanning}
          disabled={scanning || !value.trim() || disabled}
          variant="primary"
          size="md"
        >
          {scanning ? '扫描中…' : '扫描目录'}
        </Button>
      </div>

      {/* Scan result */}
      {scanResult && (
        <div style={{
          ...styles.resultBox,
          borderColor: scanResult.ok ? 'var(--success, #46f1c5)' : 'var(--danger, #ff5a6e)',
          background: scanResult.ok
            ? 'rgba(70,241,197,0.06)'
            : 'rgba(255,90,110,0.06)',
        }}>
          <div style={{
            ...styles.resultMsg,
            color: scanResult.ok ? 'var(--success, #46f1c5)' : 'var(--danger, #ff5a6e)',
          }}>
            {scanResult.ok ? '✅ ' : '❌ '}{scanResult.msg}
          </div>
          {scanResult.ok && (
            <div style={styles.badgeRow}>
              <Badge variant="success">可启动分析</Badge>
            </div>
          )}
          {scanResult.details && (
            <pre style={styles.resultDetails}>{scanResult.details}</pre>
          )}
        </div>
      )}

      {!value.trim() && !scanResult && (
        <div style={styles.helper}>
          ⚠️ 浏览器无法直接访问本地文件系统。请手动粘贴图片目录的<strong>绝对路径</strong>，后端将验证路径是否存在。
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'var(--accent, #7c9bff)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  stepDesc: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    marginTop: 1,
  },
  dropZone: {
    padding: '14px 12px',
    border: '1px dashed var(--border-strong, #3a3a55)',
    borderRadius: 8,
    textAlign: 'center',
    marginBottom: 10,
    transition: 'border-color 0.15s, background 0.15s',
    background: 'var(--surface, #1e1e2e)',
  },
  dropZoneActive: {
    borderColor: 'var(--accent, #7c9bff)',
    background: 'var(--accent-soft, rgba(124,155,255,0.08))',
  },
  dropIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  dropText: {
    fontSize: 12,
    color: 'var(--text, #e0e0e8)',
    fontWeight: 500,
  },
  dropHelper: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    marginTop: 2,
    lineHeight: 1.4,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
  },
  resultBox: {
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid',
    marginTop: 4,
  },
  resultMsg: {
    fontSize: 12,
    fontWeight: 600,
  },
  badgeRow: {
    marginTop: 4,
    display: 'flex',
    gap: 4,
  },
  resultDetails: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    marginTop: 4,
    marginBottom: 0,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.5,
  },
  helper: {
    fontSize: 10,
    color: 'var(--warning, #ffd93d)',
    lineHeight: 1.5,
    padding: '6px 8px',
    background: 'rgba(255,217,61,0.06)',
    borderRadius: 4,
  },
};
