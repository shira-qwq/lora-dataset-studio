/**
 * ImageHoverInspector — 共享悬停解释层
 *
 * 在图片上方半透明覆盖层中显示中文字段解释和数值。
 * 纯展示组件，不涉及业务数据获取。
 *
 * 通过字段 key 从 manifest 获取解释文案（inspectionManifest 级别）,
 * 保持与 Analysis 场景的解释一致性。
 */
import type { WorkspaceHoverField } from './types';

export interface ImageHoverInspectorProps {
  /** 悬停字段列表（已解析为展示层数据） */
  fields: WorkspaceHoverField[];
  /** "为什么出现" 解释 */
  sliceReason?: string;
}

export default function ImageHoverInspector({
  fields,
  sliceReason,
}: ImageHoverInspectorProps) {
  if (fields.length === 0 && !sliceReason) {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <div style={styles.noData}>当前通道没有足够的指标解释这张图。</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {fields.map((f, i) => (
          <div key={i} style={styles.field}>
            <div style={styles.label}>{f.label}</div>
            <div style={styles.value}>{f.value}</div>
            {f.hint && <div style={styles.hint}>{f.hint}</div>}
            {f.valueHint && (
              <div style={styles.valueHint}>{f.valueHint}</div>
            )}
          </div>
        ))}

        {sliceReason && (
          <div style={styles.reason}>
            <div style={styles.reasonLabel}>为什么出现</div>
            <div style={styles.reasonText}>{sliceReason}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)',
    padding: 8,
  },
  card: {
    width: '100%',
    maxHeight: '100%',
    overflowY: 'auto',
    background: 'var(--tooltip-bg, #2a2a40)',
    border: '1px solid var(--tooltip-border, #3a3a55)',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent, #7c9bff)',
  },
  value: {
    fontSize: 11,
    color: 'var(--tooltip-text, #e0e0e8)',
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 9,
    color: 'var(--text-muted, #888)',
    lineHeight: 1.3,
  },
  valueHint: {
    fontSize: 9,
    color: 'var(--text-faint, #555)',
    fontStyle: 'italic',
  },
  reason: {
    marginTop: 4,
    paddingTop: 4,
    borderTop: '1px solid var(--border, #2a2a3e)',
  },
  reasonLabel: {
    fontSize: 9,
    color: 'var(--text-faint, #555)',
    marginBottom: 1,
  },
  reasonText: {
    fontSize: 9,
    color: 'var(--text-muted, #888)',
  },
  noData: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    textAlign: 'center',
    padding: '4px 0',
  },
};
