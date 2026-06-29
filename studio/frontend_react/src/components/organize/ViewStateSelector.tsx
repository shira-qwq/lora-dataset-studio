import type { ViewMode } from './types';

interface ViewStateSelectorProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  isDirty: boolean;
}

const MODES: { value: ViewMode; label: string; title: string }[] = [
  { value: 'cluster', label: '簇内排序', title: '按簇分组，内部按特征排序' },
  { value: 'global', label: '全局排序', title: '所有图片按特征全局排序' },
  { value: 'manual', label: '手动顺序', title: '恢复用户手工排列顺序' },
];

export default function ViewStateSelector({ mode, onChange, isDirty }: ViewStateSelectorProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '2px 4px', background: '#12121a',
      borderRadius: 4, border: '1px solid #2a2a3e',
    }}>
      <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>视图</span>
      {MODES.map((m) => {
        const active = mode === m.value;
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            title={m.title}
            style={{
              padding: '3px 8px', fontSize: 10, fontFamily: 'inherit',
              cursor: 'pointer', whiteSpace: 'nowrap',
              background: active ? '#3a3a5e' : 'transparent',
              color: active ? '#7c9bff' : '#888',
              border: active ? '1px solid #7c9bff' : '1px solid transparent',
              borderRadius: 3,
              opacity: isDirty && m.value === 'manual' && !active ? 0.5 : 1,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
