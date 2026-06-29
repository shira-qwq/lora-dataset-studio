/**
 * AppShell — 统一应用壳层
 *
 * 提供两种内容模式：
 * - `normal`: 用于 Home / New Analysis / Analysis，内容区可设 maxWidth
 * - `fullBleed`: 用于 Organize，不限制画板宽度，不设 padding
 *
 * 固定布局：
 * - 左侧：SidebarNav (200px)
 * - 右侧：内容区（flex-grow），右上角 TopRightActions 固定定位
 *
 * P07-002: 只创建壳层，不改页面内部逻辑。
 */
import SidebarNav from './SidebarNav';
import TopRightActions from './TopRightActions';

interface AppShellProps {
  mode?: 'normal' | 'fullBleed';
  children: React.ReactNode;
}

export default function AppShell({ mode = 'normal', children }: AppShellProps) {
  const isFullBleed = mode === 'fullBleed';

  return (
    <div style={isFullBleed ? styles.rootFullBleed : styles.rootNormal}>
      {/* Fixed sidebar */}
      <SidebarNav />

      {/* Content area */}
      <div
        style={{
          ...styles.content,
          ...(isFullBleed ? styles.contentFullBleed : styles.contentNormal),
        }}
      >
        {/* Page content */}
        {children}
      </div>

      {/* Floating top-right actions */}
      <TopRightActions />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  rootNormal: {
    display: 'flex',
    minHeight: '100vh',
    background: 'var(--bg, #12121a)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  rootFullBleed: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--bg, #12121a)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0, /* prevent flex overflow */
  },
  contentNormal: {
    overflowY: 'auto' as const,
  },
  contentFullBleed: {
    overflow: 'hidden',
  },
};
