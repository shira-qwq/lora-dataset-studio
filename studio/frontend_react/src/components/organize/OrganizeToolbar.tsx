import { useState, useEffect, type ReactNode } from 'react';
import type { FitMode } from './types';
import type { ThumbnailQuality } from '../image-workspace/thumbnailQuality';
import { THUMBNAIL_QUALITY_OPTIONS } from '../image-workspace/thumbnailQuality';

interface OrganizeToolbarProps {
  jobId: string;
  totalImages: number;
  clusterCount: number;
  selectedCount: number;
  isDirty: boolean;
  saving?: boolean;
  allExpanded: boolean;
  fitMode: FitMode;
  onFitModeChange: (mode: FitMode) => void;
  thumbnailQuality: ThumbnailQuality;
  onThumbnailQualityChange: (quality: ThumbnailQuality) => void;
  cameraZoom?: number;
  onAutoPack?: () => void;
  onResetLayout?: () => void;
  onFitToView?: () => void;
  onSave: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onBack: () => void;
  onClearSelection: () => void;
  onToggleDebug: () => void;
  onExpandAll: () => void;
  onRepack: () => void;
  onOpenPreview: () => void;
  extraWidget?: ReactNode;
}

export default function OrganizeToolbar({
  jobId,
  totalImages,
  clusterCount,
  selectedCount,
  isDirty,
  saving,
  allExpanded,
  fitMode,
  onFitModeChange,
  thumbnailQuality,
  onThumbnailQualityChange,
  cameraZoom,
  onAutoPack,
  onResetLayout,
  onFitToView,
  onSave,
  onExport,
  onRefresh,
  onBack,
  onClearSelection,
  onToggleDebug,
  onExpandAll,
  onRepack,
  onOpenPreview,
  extraWidget,
}: OrganizeToolbarProps) {
  const [showHelp, setShowHelp] = useState(false);

  // First-time auto-popup
  useEffect(() => {
    try {
      const seen = localStorage.getItem('organize.helpSeen');
      if (seen !== '1') {
        // Small delay to let the page render first
        const timer = setTimeout(() => setShowHelp(true), 300);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, []);

  const handleCloseHelp = () => {
    setShowHelp(false);
    try { localStorage.setItem('organize.helpSeen', '1'); } catch { /* ignore */ }
  };

  return (
    <div className="organize-toolbar" style={styles.toolbar}>
      <button onClick={onBack} style={styles.iconBtn} title="返回首页">←</button>
      <span style={styles.jobTitle} title={jobId}>{jobId}</span>

      <div style={styles.divider} />

      <button
        onClick={onSave}
        disabled={!isDirty || saving}
        style={{
          ...styles.btn,
          ...(isDirty && !saving ? styles.primaryBtn : {}),
        }}
      >
        {saving ? '保存中...' : `保存${isDirty ? ' *' : ''}`}
      </button>
      <button onClick={onExport} style={styles.btn}>导出</button>
      <button onClick={onRefresh} style={styles.btn} title="重新拉取任务与整理状态">刷新</button>
      <button onClick={onFitToView || onRepack} style={{...styles.btn, fontWeight: 600}} title="缩放并居中，让所有簇尽量进入当前视口">
        全框视图
      </button>

      <div style={styles.divider} />

      <div style={styles.segment}>
        <button
          onClick={() => onFitModeChange('cover')}
          style={{ ...styles.segmentBtn, ...(fitMode === 'cover' ? styles.segmentActive : {}) }}
          title="裁切填满固定格子"
        >
          裁切
        </button>
        <button
          onClick={() => onFitModeChange('contain')}
          style={{ ...styles.segmentBtn, ...(fitMode === 'contain' ? styles.segmentActive : {}) }}
          title="完整显示图片，可能留白"
        >
          完整
        </button>
      </div>

      <details style={styles.details}>
        <summary style={styles.summary}>缩略图分辨率</summary>
        <div style={styles.menu}>
          <label style={styles.menuField}>
            <span>分辨率</span>
            <select
              value={thumbnailQuality}
              onChange={(event) => onThumbnailQualityChange(event.target.value as ThumbnailQuality)}
              style={styles.select}
            >
              {THUMBNAIL_QUALITY_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
          <div style={styles.menuHint}>
            切换后 thumbnail URL 的 size 参数会变化。不影响原图预览或导出。
          </div>
        </div>
      </details>

      <button onClick={() => setShowHelp(true)} style={{...styles.btn, ...styles.helpBtn}}>操作说明</button>

      {extraWidget}
      <div style={{ flex: 1 }} />

      <details style={styles.details}>
        <summary style={styles.summary}>更多</summary>
        <div style={styles.menu}>
          <button onClick={onExpandAll} style={styles.menuBtn}>
            {allExpanded ? '全部折叠' : '全部展开'}
          </button>
          {onResetLayout && (
            <button onClick={onResetLayout} style={styles.menuBtn} title="重置簇卡片位置，不改变图片分组">
              重置位置
            </button>
          )}
          {onAutoPack && (
            <button onClick={onAutoPack} style={styles.menuBtn}>
              重新排布
            </button>
          )}
          <button onClick={onOpenPreview} style={styles.menuBtn}>
            重聚类预览
          </button>
          <button onClick={onToggleDebug} style={styles.menuBtn}>
            调试面板
          </button>
        </div>
      </details>

      {selectedCount > 0 && (
        <>
          <span style={styles.selectedText}>已选 {selectedCount} 张</span>
          <button onClick={onClearSelection} style={styles.btn}>清空</button>
        </>
      )}

      <span style={styles.stats}>
        {cameraZoom !== undefined ? `画布 ${Math.round(cameraZoom * 100)}% · ` : ''}
        {totalImages} 图 · {clusterCount} 簇
      </span>

      {showHelp && (
        <div style={styles.helpBackdrop} onClick={handleCloseHelp}>
          <div style={styles.helpModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.helpTitle}>整理画板操作说明</div>

            <div style={styles.helpSection}>基础操作</div>
            <ul style={styles.helpList}>
              <li><strong>滚轮</strong>：调整图片显示大小。</li>
              <li><strong>Alt + 滚轮</strong>：缩放整个画板视角。</li>
              <li><strong>拖动画板空白处</strong>：平移画布。</li>
              <li><strong>拖动簇标题</strong>：移动簇卡片位置。</li>
              <li><strong>拖动图片</strong>：把图片移动到其他簇。</li>
              <li><strong>按 [ / ]</strong>：缩放画板；<strong>0</strong>：重置缩放。</li>
              <li><strong>全框视图</strong>：一次看到所有簇。</li>
            </ul>

            <div style={styles.helpSection}>大图查看</div>
            <ul style={styles.helpList}>
              <li><strong>点击眼睛</strong>：查看原图大图。</li>
              <li><strong>滚轮</strong>：缩放大图。</li>
              <li><strong>拖拽</strong>：平移大图。</li>
              <li><strong>点击背景 / ESC</strong>：关闭大图。</li>
            </ul>

            <div style={styles.helpSection}>导出与数据</div>
            <ul style={styles.helpList}>
              <li>导出结果保存到 <code>output_root/exports/</code>。</li>
              <li>软件内部数据在 <code>_studio/</code> 目录。</li>
              <li>缩略图缓存可删除，软件会重新生成。</li>
            </ul>

            <button onClick={handleCloseHelp} style={styles.btn}>知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    height: 48,
    padding: '0 12px',
    background: 'var(--surface, #1e1e2e)',
    borderBottom: '1px solid var(--border, #2a2a3e)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  iconBtn: {
    padding: '4px 8px',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  btn: {
    padding: '4px 8px',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  helpBtn: {
    background: 'var(--accent, #7c9bff)',
    color: 'var(--bg, #12121a)',
    fontWeight: 700,
    border: '1px solid var(--accent, #7c9bff)',
  },
  primaryBtn: {
    background: 'var(--accent, #7c9bff)',
    color: 'var(--bg, #12121a)',
    fontWeight: 800,
  },
  jobTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  divider: {
    width: 1,
    height: 20,
    background: 'var(--border, #2a2a3e)',
  },
  segment: {
    display: 'flex',
    gap: 0,
  },
  segmentBtn: {
    padding: '3px 8px',
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'inherit',
  },
  segmentActive: {
    background: 'var(--accent, #7c9bff)',
    color: 'var(--bg, #12121a)',
    fontWeight: 800,
  },
  details: {
    position: 'relative',
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  summary: {
    listStyle: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    background: 'var(--surface, #1e1e2e)',
    whiteSpace: 'nowrap',
  },
  menu: {
    position: 'absolute',
    top: 30,
    right: 0,
    zIndex: 20,
    minWidth: 220,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--card-bg, #1e1e2e)',
    boxShadow: '0 12px 30px rgba(0,0,0,0.28)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  menuField: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  menuHint: {
    fontSize: 10,
    lineHeight: 1.5,
    color: 'var(--text-faint, #666)',
  },
  menuBtn: {
    padding: '6px 8px',
    textAlign: 'left',
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 5,
    color: 'var(--text-muted, #888)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  select: {
    padding: '4px 6px',
    fontSize: 11,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 4,
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  selectedText: {
    fontSize: 11,
    color: 'var(--accent, #7c9bff)',
    whiteSpace: 'nowrap',
  },
  stats: {
    fontSize: 11,
    color: 'var(--text-faint, #666)',
    whiteSpace: 'nowrap',
  },
  helpBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.62)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpModal: {
    width: 460,
    maxWidth: '90vw',
    padding: 18,
    borderRadius: 10,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--card-bg, #1e1e2e)',
    color: 'var(--text, #e0e0e8)',
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: 800,
    marginBottom: 12,
  },
  helpSection: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent, #7c9bff)',
    marginTop: 10,
    marginBottom: 4,
  },
  helpList: {
    margin: '0 0 14px',
    paddingLeft: 20,
    lineHeight: 1.8,
    fontSize: 12,
    color: 'var(--text-muted, #888)',
  },
};
