/**
 * TopNav — 共享导航栏组件
 *
 * 所有 React 页面统一使用的顶部导航栏。
 * Home 链接始终回到 /react/（新版首页），不再跳回旧版 /app/。
 *
 * P07-002: 使用 CSS 变量以响应主题切换。
 * 注意：此组件暂未被任何页面使用（页面使用 SidebarNav + TopRightActions）。
 */

interface TopNavProps {
  title: string;
  subtitle?: string;
}

export default function TopNav({ title, subtitle }: TopNavProps) {
  return (
    <div style={{
      padding: '12px 20px',
      background: 'var(--bg-elevated, #1a1a2e)',
      borderBottom: '1px solid var(--border, #2a2a3e)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <a
        href="/react/"
        style={{
          color: 'var(--accent, #7c9bff)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 600,
        }}
        title="返回首页"
      >
        ← Home
      </a>
      <span style={{
        width: 1,
        height: 18,
        background: 'var(--border, #2a2a3e)',
      }} />
      <span style={{
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text, #eee)',
      }}>
        {title}
      </span>
      {subtitle && (
        <span style={{
          fontSize: 11,
          color: 'var(--text-faint, #666)',
        }}>
          {subtitle}
        </span>
      )}
    </div>
  );
}
