import { useMemo, useState } from 'react';
import type { ClusterData } from './types';

interface TargetClusterOverlayProps {
  clusters: ClusterData[];
  pinnedClusterIds: string[];
  draggedFilename: string | null;
  onDropImage: (filename: string, targetClusterId: string) => void;
  onClose: () => void;
}

export default function TargetClusterOverlay({
  clusters,
  pinnedClusterIds,
  draggedFilename,
  onDropImage,
  onClose,
}: TargetClusterOverlayProps) {
  const [query, setQuery] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const orderedClusters = useMemo(() => {
    const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster]));
    const pinned = pinnedClusterIds
      .map((id) => clusterMap.get(id))
      .filter((cluster): cluster is ClusterData => Boolean(cluster));
    const pinnedSet = new Set(pinned.map((cluster) => cluster.id));
    const rest = clusters.filter((cluster) => !pinnedSet.has(cluster.id));
    return [...pinned, ...rest];
  }, [clusters, pinnedClusterIds]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orderedClusters;
    return orderedClusters.filter((cluster) => {
      return cluster.name.toLowerCase().includes(normalized) || cluster.id.includes(normalized);
    });
  }, [orderedClusters, query]);

  if (!draggedFilename) return null;

  const pinnedSet = new Set(pinnedClusterIds);

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        width: 280,
        maxHeight: '58vh',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface, #1e1e2e)',
        border: '1px solid var(--border, #2a2a3e)',
        boxShadow: '0 18px 52px rgba(0,0,0,0.38)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border, #2a2a3e)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #e0e0e8)' }}>移动到...</div>
            <div style={{
              marginTop: 2,
              fontSize: 10,
              color: 'var(--text-faint, #777)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              正在拖动 {draggedFilename}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            title="关闭目标簇面板"
          >
            x
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索簇名或编号"
          style={searchInputStyle}
        />
      </div>

      <div style={{ overflowY: 'auto', padding: 8 }}>
        {filtered.map((cluster) => {
          const isPinned = pinnedSet.has(cluster.id);
          const isDragOver = dragOverId === cluster.id;
          return (
            <div
              key={cluster.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverId(cluster.id);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragOverId(cluster.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(event) => {
                event.preventDefault();
                const filename = event.dataTransfer.getData('text/plain') || draggedFilename;
                if (filename) onDropImage(filename, cluster.id);
                setDragOverId(null);
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 9px',
                marginBottom: 5,
                borderRadius: 9,
                border: isDragOver ? '1px dashed var(--accent, #7c9bff)' : '1px solid transparent',
                background: isDragOver ? 'var(--accent-soft, rgba(124,155,255,0.12))' : 'var(--surface-2, rgba(255,255,255,0.03))',
                color: 'var(--text, #e0e0e8)',
                fontSize: 12,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: cluster.color || 'var(--success, #46f1c5)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isPinned ? '工作区 · ' : ''}{cluster.name}
              </span>
              <span style={{ color: 'var(--text-faint, #777)', fontSize: 10 }}>{cluster.images.length}</span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-faint, #777)', fontSize: 12 }}>
            没有匹配的簇
          </div>
        )}
      </div>
    </div>
  );
}

const closeButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: '1px solid var(--border, #2a2a3e)',
  borderRadius: 8,
  background: 'var(--surface, #1e1e2e)',
  color: 'var(--text-muted, #888)',
  cursor: 'pointer',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 10,
  padding: '7px 9px',
  border: '1px solid var(--border, #2a2a3e)',
  borderRadius: 8,
  background: 'var(--bg, #12121a)',
  color: 'var(--text, #e0e0e8)',
  outline: 'none',
  fontSize: 12,
};
