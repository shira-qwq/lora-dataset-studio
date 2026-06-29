/**
 * Badge — 小标签/状态标记
 *
 * variant: success | warning | danger | info | default
 * 使用语义 CSS 变量: --success, --warning, --danger, --info
 */
import type { ReactNode } from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'default';
  children?: ReactNode;
  style?: React.CSSProperties;
}

export default function Badge({ variant = 'default', children, style }: BadgeProps) {
  return (
    <span style={{ ...styles.base, ...variantStyles[variant], ...style }}>
      {children}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm, 4px)',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  },
};

const variantStyles: Record<string, React.CSSProperties> = {
  success: {
    background: 'rgba(70, 241, 197, 0.12)',
    color: 'var(--success, #46f1c5)',
  },
  warning: {
    background: 'rgba(255, 217, 61, 0.12)',
    color: 'var(--warning, #ffd93d)',
  },
  danger: {
    background: 'rgba(255, 90, 110, 0.12)',
    color: 'var(--danger, #ff5a6e)',
  },
  info: {
    background: 'rgba(91, 192, 222, 0.12)',
    color: 'var(--info, #5bc0de)',
  },
  default: {
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    color: 'var(--text-muted, #888)',
  },
};
