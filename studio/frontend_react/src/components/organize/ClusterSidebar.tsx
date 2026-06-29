import { useState, useCallback } from 'react';
import type { ClusterData } from './types';

interface ClusterSidebarProps {
  clusters: ClusterData[];
  pinnedClusterIds?: string[];
  onScrollTo: (clusterId: string) => void;
  onTogglePin?: (clusterId: string) => void;
  /** P10-006D: Allow dragging images onto sidebar cluster items */
  onDropImage?: (filename: string, targetClusterId: string) => void;
}

export default function ClusterSidebar({
  clusters,
  pinnedClusterIds = [],
  onScrollTo,
  onTogglePin,
  onDropImage,
}: ClusterSidebarProps) {
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [dragOverClusterId, setDragOverClusterId] = useState<string | null>(null);

  const filtered = search
    ? clusters.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : clusters;
  const pinnedSet = new Set(pinnedClusterIds);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Only accept text/plain (image filenames), not cluster-id drags
    if (e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('text/cluster-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, clusterId: string) => {
      e.preventDefault();
      setDragOverClusterId(null);
      const fn = e.dataTransfer.getData('text/plain');
      if (fn && onDropImage) {
        onDropImage(fn, clusterId);
      }
    },
    [onDropImage],
  );

  return (
    <div className="cluster-sidebar" style={{
      width: 200, flexShrink: 0, background: 'var(--bg-elevated, #1a1a28)',
      borderRight: '1px solid var(--border, #2a2a3e)', display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #2a2a3e)' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="搜索簇..." style={{
            width: '100%', padding: '4px 8px',
            background: 'var(--surface, #1e1e2e)',
            border: searchFocused ? '1px solid var(--accent, #7c9bff)' : '1px solid var(--border, #2a2a3e)',
            borderRadius: 3,
            color: 'var(--text, #e0e0e8)',
            fontSize: 11, outline: 'none', fontFamily: 'inherit',
            boxShadow: searchFocused ? '0 0 0 2px var(--accent-soft, rgba(124,155,255,0.16))' : '0 0 0 1px transparent',
            transition: 'border-color 0.12s, box-shadow 0.12s, background 0.12s',
          }} />
      </div>
      <div style={{
        padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-faint, #555)',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        簇 ({filtered.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map((c) => {
          const isDragOver = dragOverClusterId === c.id;
          const isPinned = pinnedSet.has(c.id);
          return (
            <div
              key={c.id}
              onClick={() => onScrollTo(c.id)}
              onDragOver={handleDragOver}
              onDragEnter={(e) => {
                if (e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('text/cluster-id')) {
                  e.preventDefault();
                  setDragOverClusterId(c.id);
                }
              }}
              onDragLeave={() => setDragOverClusterId(null)}
              onDrop={(e) => handleDrop(e, c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                cursor: 'pointer', borderBottom: '1px solid var(--border, #2a2a3e)', fontSize: 12,
                transition: 'background 0.1s',
                outline: isDragOver ? '2px dashed var(--accent, #7c9bff)' : 'none',
                outlineOffset: -2,
                background: isDragOver ? 'var(--accent-soft, rgba(124,155,255,0.08))' : '',
              }}
              onMouseOver={(e) => {
                if (!isDragOver) e.currentTarget.style.background = 'var(--surface-active, #2a2a48)';
              }}
              onMouseOut={(e) => {
                if (!isDragOver) e.currentTarget.style.background = '';
              }}
              title="点击定位簇，拖入图片到此簇名可移动图片"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color || 'var(--success, #46f1c5)', flexShrink: 0 }} />
              <span style={{
                flex: 1, color: 'var(--text, #e0e0e8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{isPinned ? '工作区 · ' : ''}{c.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint, #555)' }}>{c.images.length}</span>
              {onTogglePin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(c.id);
                  }}
                  title={isPinned ? '移出工作区' : '加入工作区'}
                  style={{
                    padding: '1px 5px',
                    border: `1px solid ${isPinned ? 'var(--accent, #7c9bff)' : 'var(--border, #2a2a3e)'}`,
                    borderRadius: 999,
                    background: isPinned ? 'var(--accent-soft, rgba(124,155,255,0.14))' : 'transparent',
                    color: isPinned ? 'var(--accent, #7c9bff)' : 'var(--text-faint, #777)',
                    cursor: 'pointer',
                    fontSize: 9,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isPinned ? '已钉' : '钉'}
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-faint, #555)', fontSize: 11 }}>
            无匹配簇
          </div>
        )}
      </div>
    </div>
  );
}
