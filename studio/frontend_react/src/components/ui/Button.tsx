/**
 * Button — 基础按钮组件
 *
 * variant: default | primary | ghost | danger
 * size: sm | md
 * loading / disabled 支持
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  children?: ReactNode;
  style?: React.CSSProperties;
}

export default function Button({
  variant = 'default',
  size = 'md',
  loading,
  disabled,
  children,
  style,
  onClick,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      onClick={onClick}
      style={{
        ...styles.base,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...(isDisabled ? styles.disabled : {}),
        ...style,
      }}
      {...rest}
    >
      {loading && <span style={styles.spinner} />}
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
    whiteSpace: 'nowrap',
    lineHeight: 1,
  },
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: '2px solid var(--text-faint, #555)',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: {
    padding: '4px 10px',
    fontSize: 12,
  },
  md: {
    padding: '6px 14px',
    fontSize: 13,
  },
};

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text, #e0e0e8)',
  },
  primary: {
    background: 'var(--accent, #7c9bff)',
    borderColor: 'var(--accent, #7c9bff)',
    color: '#fff',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: 'var(--text-muted, #888)',
  },
  danger: {
    background: 'var(--danger, #ff5a6e)',
    borderColor: 'var(--danger, #ff5a6e)',
    color: '#fff',
  },
};
