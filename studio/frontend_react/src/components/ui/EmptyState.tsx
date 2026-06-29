/**
 * EmptyState — 空态占位
 *
 * 当列表/页面无数据时显示，带图标和说明文字。
 */
interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export default function EmptyState({ icon, title, description, action, style }: EmptyStateProps) {
  return (
    <div style={{ ...styles.container, ...style }}>
      {icon && <div style={styles.icon}>{icon}</div>}
      <div style={styles.title}>{title}</div>
      {description && <div style={styles.desc}>{description}</div>}
      {action && <div style={styles.action}>{action}</div>}
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
    textAlign: 'center',
  },
  icon: {
    fontSize: 32,
    marginBottom: 12,
    opacity: 0.5,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 4,
  },
  desc: {
    fontSize: 12,
    color: 'var(--text-muted, #888)',
    maxWidth: 360,
    lineHeight: 1.5,
  },
  action: {
    marginTop: 16,
  },
};
