/**
 * InspectionQueuePanel — Organize 巡检队列面板 (P10-004)
 *
 * 在 Organize 顶部的只读提示面板，显示从 Analysis 带来的巡检上下文。
 * 不涉及任何后端持久化或编辑操作。
 */
import { useState, useCallback } from 'react';
import { readHandoff, clearHandoff } from '../../analysis/handoff';
import Button from '../ui/Button';

interface InspectionQueuePanelProps {
  jobId: string;
  /** URL 中的 inspection preset ID */
  inspectionPresetId?: string;
}

export default function InspectionQueuePanel({
  jobId,
  inspectionPresetId,
}: InspectionQueuePanelProps) {
  // Persist dismissal across refreshes via sessionStorage
  const dismissKey = inspectionPresetId ? `org_inspection_dismissed_${jobId}_${inspectionPresetId}` : null;
  const [visible, setVisible] = useState(() => {
    if (!dismissKey) return true;
    try { return sessionStorage.getItem(dismissKey) !== '1'; } catch { return true; }
  });

  // Read handoff from sessionStorage
  const payload = inspectionPresetId ? readHandoff(jobId, inspectionPresetId) : null;

  const handleClear = useCallback(() => {
    if (inspectionPresetId) {
      clearHandoff(jobId, inspectionPresetId);
    }
    if (dismissKey) {
      try { sessionStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
    }
    setVisible(false);
  }, [jobId, inspectionPresetId, dismissKey]);

  if (!visible || !inspectionPresetId) return null;

  // Payload expired or missing
  if (!payload) {
    return (
      <div style={styles.banner}>
        <div style={styles.bannerContent}>
          <span style={styles.icon}>📋</span>
          <span style={styles.text}>
            巡检队列已过期，请从图片巡检重新进入。
          </span>
          <Button variant="ghost" size="sm" onClick={handleClear}>
            关闭
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.banner}>
      <div style={styles.bannerContent}>
        <span style={styles.icon}>📋</span>
        <div style={styles.info}>
          <span style={styles.label}>
            巡检队列：{payload.presetLabel}
          </span>
          <span style={styles.meta}>
            {payload.imageCount} 张图片
            · 来自图片巡检
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear}>
          清除巡检队列
        </Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    background: 'var(--surface, #1e1e2e)',
    borderBottom: '1px solid var(--accent-soft, rgba(124,155,255,0.2))',
    padding: '6px 16px',
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    maxWidth: 1100,
    margin: '0 auto',
  },
  icon: {
    fontSize: 14,
    flexShrink: 0,
  },
  info: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--accent, #7c9bff)',
  },
  text: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    flex: 1,
  },
  meta: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
  },
};
