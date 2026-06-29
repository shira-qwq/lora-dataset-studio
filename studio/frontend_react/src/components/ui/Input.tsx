/**
 * Input — 暗色风格输入框
 *
 * 使用 CSS 变量适配主题，转发原生 input 属性。
 */
import type { InputHTMLAttributes } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style'> {
  style?: React.CSSProperties;
}

export default function Input({ style, ...rest }: InputProps) {
  return (
    <input
      style={{
        ...styles.input,
        ...style,
      }}
      {...rest}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  input: {
    padding: '8px 12px',
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s',
    width: '100%',
  },
};
