/**
 * Card — 基础卡片容器
 *
 * 使用 CSS 变量适配主题。支持 variant 和可选的 title/subtitle/actions 插槽。
 */
import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  variant?: 'default' | 'elevated' | 'bordered';
  children?: ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export default function Card({
  title, subtitle, actions,
  variant = 'default',
  children, style, onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        ...styles.base,
        ...variantStyles[variant],
        ...(onClick ? styles.clickable : {}),
        ...style,
      }}
    >
      {(title || actions) && (
        <div style={styles.header}>
          <div style={styles.headerText}>
            {title && <div style={styles.title}>{title}</div>}
            {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
          </div>
          {actions && <div style={styles.actions}>{actions}</div>}
        </div>
      )}
      {children && <div style={styles.body}>{children}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  base: {
    background: 'var(--surface, #1e1e2e)',
    borderRadius: 'var(--radius-md, 8px)',
    padding: 16,
    transition: 'background 0.15s, border-color 0.15s',
  },
  clickable: {
    cursor: 'pointer',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    lineHeight: 1.4,
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--text-muted, #888)',
    marginTop: 2,
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  body: {
    fontSize: 13,
    color: 'var(--text, #e0e0e8)',
    lineHeight: 1.5,
  },
};

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    border: '1px solid var(--border, #2a2a3e)',
  },
  elevated: {
    border: '1px solid var(--border, #2a2a3e)',
    boxShadow: 'var(--shadow-soft, 0 2px 8px rgba(0,0,0,0.3))',
  },
  bordered: {
    border: '1px solid var(--border-strong, #3a3a55)',
  },
};
