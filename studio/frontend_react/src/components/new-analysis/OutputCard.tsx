/**
 * OutputCard — 输出位置步骤
 *
 * 输出目录输入 + 自动补全策略 + 锁定状态 badge
 */
import Input from '../ui/Input';
import Button from '../ui/Button';

interface OutputCardProps {
  value: string;
  onChange: (val: string) => void;
  suggestedDir: string;
  isLocked: boolean;
  onUnlock: () => void;
  disabled?: boolean;
}

export default function OutputCard({
  value, onChange, suggestedDir, isLocked, onUnlock, disabled,
}: OutputCardProps) {
  return (
    <div style={styles.card}>
      {/* Step header */}
      <div style={styles.stepHeader}>
        <span style={styles.stepNum}>2</span>
        <div>
          <div style={styles.stepTitle}>输出位置</div>
          <div style={styles.stepDesc}>分析结果和整理数据的存放目录</div>
        </div>
      </div>

      {/* Input + lock badge */}
      <div style={styles.inputRow}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="D:\output\my_analysis"
          disabled={disabled}
          style={{ flex: 1 }}
        />
        {isLocked ? (
          <Button onClick={onUnlock} variant="ghost" size="sm" title="解锁后自动补全将重新生效">
            🔒 已锁定
          </Button>
        ) : (
          <span style={styles.autoBadge}>自动</span>
        )}
      </div>

      {/* Status description */}
      {isLocked ? (
        <div style={styles.lockedNote}>
          🔒 输出目录已手动锁定，不会跟随输入目录变化。点击"已锁定"解锁。
        </div>
      ) : value ? (
        <div style={styles.autoNote}>
          ✅ 自动补全：{suggestedDir}
        </div>
      ) : (
        <div style={styles.autoNote}>
          默认策略：使用 &lt;输入目录&gt;-output 作为输出位置
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'var(--accent, #7c9bff)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  stepDesc: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    marginTop: 1,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 4,
  },
  autoBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: 'var(--accent-soft, rgba(124,155,255,0.15))',
    color: 'var(--accent, #7c9bff)',
    whiteSpace: 'nowrap' as const,
  },
  lockedNote: {
    fontSize: 10,
    color: 'var(--warning, #ffd93d)',
    marginTop: 2,
    lineHeight: 1.5,
  },
  autoNote: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    marginTop: 2,
    lineHeight: 1.5,
  },
};
