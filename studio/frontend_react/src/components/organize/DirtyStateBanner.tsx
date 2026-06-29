interface DirtyStateBannerProps {
  pendingMoves: number;
  pendingRenames: number;
  onSave: () => void;
  onRefresh: () => void;
}

export default function DirtyStateBanner({
  pendingMoves,
  pendingRenames,
  onSave,
  onRefresh,
}: DirtyStateBannerProps) {
  const total = pendingMoves + pendingRenames;
  if (total === 0) return null;

  return (
    <div
      style={{
        padding: '6px 16px',
        background: 'var(--surface, #1e1e2e)',
        borderBottom: '1px solid var(--warning, #ffd93d)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
        color: 'var(--warning, #ffd93d)',
      }}
    >
      <span>● {total} 个待保存修改</span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onSave}
        style={{
          padding: '4px 12px',
          background: 'var(--warning, #ffd93d)',
          color: 'var(--bg, #12121a)',
          border: 'none',
          borderRadius: 3,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 11,
          fontFamily: 'inherit',
        }}
      >
        💾 保存 ({total})
      </button>
      <button
        onClick={onRefresh}
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--warning, #ffd93d)',
          border: '1px solid var(--warning, #ffd93d)',
          borderRadius: 3,
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'inherit',
        }}
      >
        丢弃并刷新
      </button>
    </div>
  );
}
