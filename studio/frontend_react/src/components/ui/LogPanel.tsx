/**
 * LogPanel — 日志面板
 *
 * 保持 monospace 日志显示，暗色面板，自动滚动到底部。
 * 使用 `var(--font-mono)`，适配主题。
 */
import { useEffect, useRef } from 'react';

interface LogPanelProps {
  lines: string[];
  maxHeight?: number | string;
  style?: React.CSSProperties;
}

export default function LogPanel({ lines, maxHeight = 300, style }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={scrollRef}
      style={{
        ...styles.container,
        maxHeight,
        ...style,
      }}
    >
      {lines.length === 0 ? (
        <div style={styles.empty}>暂无日志</div>
      ) : (
        lines.map((line, i) => (
          <div key={i} style={styles.line}>{line}</div>
        ))
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
    padding: '8px 12px',
    overflowY: 'auto',
    fontFamily: 'var(--font-mono, "SF Mono", "Cascadia Code", Consolas, monospace)',
    fontSize: 12,
    lineHeight: 1.6,
  },
  line: {
    color: 'var(--text-muted, #888)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  empty: {
    color: 'var(--text-faint, #555)',
    textAlign: 'center',
    padding: 12,
    fontSize: 12,
  },
};
