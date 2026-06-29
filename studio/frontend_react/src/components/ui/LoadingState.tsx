/**
 * LoadingState — 加载中占位
 *
 * 简单的 spinner + 文字提示。
 */
interface LoadingStateProps {
  text?: string;
  style?: React.CSSProperties;
}

export default function LoadingState({ text = '加载中…', style }: LoadingStateProps) {
  return (
    <div style={{ ...styles.container, ...style }}>
      <div style={styles.spinner} />
      <div style={styles.text}>{text}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    gap: 12,
  },
  spinner: {
    width: 24,
    height: 24,
    border: '3px solid var(--border, #2a2a3e)',
    borderTopColor: 'var(--accent, #7c9bff)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  text: {
    fontSize: 13,
    color: 'var(--text-muted, #888)',
  },
};
