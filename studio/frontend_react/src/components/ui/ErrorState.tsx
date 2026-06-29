/**
 * ErrorState — 错误状态展示
 *
 * 显示错误信息和可选的重试按钮。
 */
interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  style?: React.CSSProperties;
}

export default function ErrorState({ title, message, onRetry, style }: ErrorStateProps) {
  return (
    <div style={{ ...styles.container, ...style }}>
      <div style={styles.icon}>⚠️</div>
      {title && <div style={styles.title}>{title}</div>}
      <div style={styles.message}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={styles.retryBtn}>
          重试
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
    textAlign: 'center',
  },
  icon: {
    fontSize: 24,
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--danger, #ff5a6e)',
    marginBottom: 4,
  },
  message: {
    fontSize: 13,
    color: 'var(--text-muted, #888)',
    maxWidth: 400,
    lineHeight: 1.5,
    marginBottom: 12,
  },
  retryBtn: {
    padding: '6px 16px',
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
};
