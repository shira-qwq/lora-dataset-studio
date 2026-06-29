/**
 * SidebarNav — AppShell 左侧固定导航栏（中英双语）
 *
 * 使用 react-router-dom 的 NavLink 实现当前路由高亮。
 * 所有链接 path 相对于 basename /react。
 * 导航项: Overview (Home) / New Analysis / Organize / Analysis
 */
import { NavLink } from 'react-router-dom';
import { getLanguage } from '../../i18n/uiDictionary';

interface NavItem {
  to: string;
  label_zh: string;
  label_en: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label_zh: '首页', label_en: 'Home', icon: '◈' },
  { to: '/new-analysis', label_zh: '新建分析', label_en: 'New Analysis', icon: '＋' },
  { to: '/organize', label_zh: '整理画板', label_en: 'Organize', icon: '🗂️' },
  { to: '/analysis', label_zh: '分析通道', label_en: 'Analysis', icon: '📊' },
];

function _(zh: string, en: string): string {
  return getLanguage() === 'en' ? en : zh;
}

export default function SidebarNav() {
  return (
    <nav style={styles.sidebar}>
      {/* App logo / name */}
      <div style={styles.logo}>
        <div style={styles.logoIcon}>◈</div>
        <div style={styles.logoText}>
          <div style={styles.logoTitle}>{_('光影分类', 'Lighting Studio')}</div>
          <div style={styles.logoSub}>Studio</div>
        </div>
      </div>

      {/* Navigation links */}
      <div style={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              ...styles.navItem,
              background: isActive ? 'var(--surface-active, #2a2a48)' : 'transparent',
              color: isActive ? 'var(--accent, #7c9bff)' : 'var(--text-muted, #888)',
            })}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span>{_(item.label_zh, item.label_en)}</span>
          </NavLink>
        ))}
      </div>

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />

      {/* Version info */}
      <div style={styles.version}>v0.1.0</div>
    </nav>
  );
}

const SIDEBAR_WIDTH = 200;

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-elevated, #1a1a28)',
    borderRight: '1px solid var(--border, #2a2a3e)',
    overflow: 'hidden',
    userSelect: 'none',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 16px 20px',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  logoIcon: {
    fontSize: 22,
    color: 'var(--accent, #7c9bff)',
  },
  logoText: {
    display: 'flex',
    flexDirection: 'column',
  },
  logoTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    lineHeight: 1.2,
  },
  logoSub: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  navList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '8px 8px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    transition: 'background 0.12s, color 0.12s',
    cursor: 'pointer',
  } as React.CSSProperties,
  navIcon: {
    fontSize: 16,
    width: 20,
    textAlign: 'center' as const,
  },
  version: {
    padding: '8px 16px',
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    textAlign: 'center' as const,
  },
};

/** Exported for use by AppShell */
export { SIDEBAR_WIDTH };
