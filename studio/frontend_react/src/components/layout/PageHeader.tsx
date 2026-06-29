/**
 * PageHeader — 页面标题组件
 *
 * 可用于 AppShell 内容区顶部，展示当前页面名称和可选的描述/操作区。
 * P07-002 批次中作为可选组件，后续页面可自由使用。
 */
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div style={styles.header}>
      <div style={styles.titleArea}>
        <h1 style={styles.title}>{title}</h1>
        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div style={styles.actions}>{actions}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '24px 32px 16px',
    gap: 16,
  },
  titleArea: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    margin: 0,
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-muted, #888)',
    margin: '4px 0 0',
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
};
