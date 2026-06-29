/**
 * TopRightActions — AppShell 右上角功能区
 *
 * 包含 ThemeSelector。
 * 语言切换按钮已隐藏（i18n 架构保留，英文 UI 后续补完）。
 * 使用 position: fixed 固定在右上角（避开 Sidebar 区域）。
 */
import ThemeSelector from '../theme/ThemeSelector';

export default function TopRightActions() {
  return (
    <div style={styles.container}>
      <ThemeSelector />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 8,
    right: 12,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  langBtn: {
    background: 'transparent',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    color: 'var(--text-faint, #888)',
    fontSize: 11,
    padding: '3px 8px',
    cursor: 'pointer',
  },
};
