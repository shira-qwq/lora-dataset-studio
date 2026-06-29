/**
 * RunStatusPanel — 右侧状态面板
 *
 * 显示扫描结果、任务摘要、运行进度、日志、完成后操作。
 * 使用 sticky 定位，随页面滚动保持在视口内。
 */
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import LogPanel from '../ui/LogPanel';

interface ScanResult {
  ok: boolean;
  msg: string;
  details?: string;
}

interface RunStatusPanelProps {
  /** 扫描结果 */
  scanResult: ScanResult | null;
  /** 输出目录 */
  outputDir: string;
  /** 输出是否锁定 */
  isOutputLocked: boolean;
  /** 任务 ID */
  jobId: string | null;
  /** 任务状态 */
  jobStatus: string | null;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 是否完成 */
  isJobDone: boolean;
  /** 是否失败 */
  isJobFailed: boolean;
  /** 任务日志 */
  jobLog: string;
  /** 任务错误 */
  error: string | null;
  /** 扫描结果中的图片数量描述 */
  imageCountText?: string;
  /** 跳转到整理画板 */
  onOpenOrganize: () => void;
  /** 跳转到分析通道 */
  onOpenAnalysis: () => void;
}

export default function RunStatusPanel({
  scanResult, outputDir, isOutputLocked,
  jobId, jobStatus, isRunning, isJobDone, isJobFailed,
  jobLog, error, imageCountText,
  onOpenOrganize, onOpenAnalysis,
}: RunStatusPanelProps) {
  return (
    <div style={styles.panel}>
      {/* Title */}
      <div style={styles.panelTitle}>状态摘要</div>

      {/* Scan result */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>扫描结果</div>
        {scanResult ? (
          <div>
            <Badge variant={scanResult.ok ? 'success' : 'danger'}>
              {scanResult.ok ? '就绪' : '失败'}
            </Badge>
            {scanResult.ok && imageCountText && (
              <div style={styles.metaText}>{imageCountText}</div>
            )}
          </div>
        ) : (
          <span style={styles.emptyText}>尚未扫描</span>
        )}
      </div>

      {/* Task summary */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>任务摘要</div>
        {outputDir ? (
          <div>
            <div style={styles.metaLabel}>输出目录</div>
            <div style={styles.metaText} title={outputDir}>
              {outputDir.length > 30 ? outputDir.slice(0, 30) + '…' : outputDir}
              {isOutputLocked && <span style={styles.lockIcon}> 🔒</span>}
            </div>
          </div>
        ) : (
          <span style={styles.emptyText}>未设置</span>
        )}
        {jobId && (
          <div style={{ marginTop: 4 }}>
            <div style={styles.metaLabel}>任务 ID</div>
            <code style={styles.jobId}>{jobId.slice(0, 20)}…</code>
          </div>
        )}
      </div>

      {/* Job status */}
      {jobId && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>运行状态</div>
          <Badge
            variant={isJobDone ? 'success' : isJobFailed ? 'danger' : isRunning ? 'info' : 'default'}
          >
            {jobStatus === 'completed' ? '已完成' :
             jobStatus === 'failed' ? '失败' :
             jobStatus === 'running' ? '运行中' :
             jobStatus === 'pending' ? '排队中' :
             jobStatus || '—'}
          </Badge>
          {isRunning && (
            <span style={styles.runningHint}>每 2 秒刷新</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorBox}>
          ❌ {error}
        </div>
      )}

      {/* Log */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>运行日志</div>
      </div>
      <LogPanel lines={jobLog ? jobLog.split('\n') : []} maxHeight={240} />

      {/* Completion actions */}
      {isJobDone && (
        <div style={styles.completion}>
          <div style={styles.completionTitle}>✅ 分析完成</div>
          <div style={styles.completionActions}>
            <Button onClick={onOpenOrganize} variant="primary" size="sm" style={{ width: '100%' }}>
              📂 打开整理画板
            </Button>
            <Button onClick={onOpenAnalysis} variant="default" size="sm" style={{ width: '100%' }}>
              📊 查看分析通道
            </Button>
          </div>
        </div>
      )}

      {/* Failed */}
      {isJobFailed && (
        <div style={styles.failedBox}>
          任务失败。请检查日志获取详细信息，调整后重试。
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 16,
    position: 'sticky' as const,
    top: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 8,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-muted, #888)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  emptyText: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
  },
  metaLabel: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    marginBottom: 1,
  },
  metaText: {
    fontSize: 11,
    color: 'var(--text, #e0e0e8)',
    wordBreak: 'break-all' as const,
    lineHeight: 1.4,
  },
  lockIcon: {
    color: 'var(--warning, #ffd93d)',
  },
  jobId: {
    fontSize: 10,
    color: 'var(--accent, #7c9bff)',
    fontFamily: 'monospace',
  },
  runningHint: {
    fontSize: 9,
    color: 'var(--text-faint, #555)',
    marginLeft: 6,
  },
  errorBox: {
    padding: '6px 8px',
    background: 'rgba(255,90,110,0.08)',
    borderRadius: 4,
    fontSize: 11,
    color: 'var(--danger, #ff5a6e)',
    marginBottom: 8,
  },
  completion: {
    marginTop: 8,
    padding: '10px 12px',
    background: 'rgba(70,241,197,0.06)',
    border: '1px solid rgba(70,241,197,0.15)',
    borderRadius: 8,
  },
  completionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--success, #46f1c5)',
    marginBottom: 8,
  },
  completionActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  failedBox: {
    marginTop: 8,
    padding: '8px 10px',
    background: 'rgba(255,90,110,0.08)',
    borderRadius: 6,
    border: '1px solid rgba(255,90,110,0.2)',
    fontSize: 12,
    color: 'var(--danger, #ff5a6e)',
    lineHeight: 1.5,
  },
};
