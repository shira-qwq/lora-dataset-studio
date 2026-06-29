/**
 * ImageFitControls — 共享缩略图适配模式控制
 *
 * 提供"完整显示"(fit) 和"填满卡片"(cover) 两个按钮切换。
 * 可受控（通过父组件提供 state）或使用内部 state。
 *
 * 中文标签：完整显示 / 填满卡片
 */
import type { FitMode } from './types';

export interface ImageFitControlsProps {
  /** 当前适配模式 */
  fitMode: FitMode;
  /** 切换回调 */
  onChange: (mode: FitMode) => void;
}

export default function ImageFitControls({
  fitMode,
  onChange,
}: ImageFitControlsProps) {
  return (
    <div style={styles.control}>
      <button
        onClick={() => onChange('fit')}
        style={{
          ...styles.btn,
          ...(fitMode === 'fit' ? styles.btnActive : {}),
        }}
        title="完整显示整张图片"
      >
        完整显示
      </button>
      <button
        onClick={() => onChange('cover')}
        style={{
          ...styles.btn,
          ...(fitMode === 'cover' ? styles.btnActive : {}),
        }}
        title="填满卡片，可能裁剪边缘"
      >
        填满卡片
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  control: {
    display: 'inline-flex',
    gap: 2,
    borderRadius: 'var(--radius-sm, 4px)',
    overflow: 'hidden',
    border: '1px solid var(--border, #2a2a3e)',
  },
  btn: {
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 500,
    border: 'none',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    transition: 'all 0.1s',
  },
  btnActive: {
    background: 'var(--accent-soft, rgba(124,155,255,0.15))',
    color: 'var(--accent, #7c9bff)',
    fontWeight: 600,
  },
};
