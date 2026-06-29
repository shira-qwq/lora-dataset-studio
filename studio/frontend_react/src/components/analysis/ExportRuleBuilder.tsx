import { useEffect, useMemo, useState } from 'react';
import Button from '../ui/Button';
import {
  makeExportCartItem,
  resolveCombinedFilter,
  sanitizeFolderName,
} from '../../analysis/exportCart';

interface SliceOption {
  id: string;
  label: string;
}

interface ExportRuleBuilderProps {
  sliceOptions: SliceOption[];
  activeSlice: string;
  resolveSliceImageIds: (sliceId: string) => string[];
  onAddItem: (item: ReturnType<typeof makeExportCartItem>) => void;
  onSelectIds?: (imageIds: string[]) => void;
}

export default function ExportRuleBuilder({
  sliceOptions,
  activeSlice,
  resolveSliceImageIds,
  onAddItem,
  onSelectIds,
}: ExportRuleBuilderProps) {
  const [primarySlice, setPrimarySlice] = useState(activeSlice || 'all');
  const [extraSlices, setExtraSlices] = useState<string[]>([]);
  const [nextSlice, setNextSlice] = useState('');
  const [topN, setTopN] = useState(12);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setPrimarySlice(activeSlice || 'all');
  }, [activeSlice]);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    sliceOptions.forEach((item) => map.set(item.id, item.label));
    return map;
  }, [sliceOptions]);

  const matchedIds = useMemo(() => resolveCombinedFilter({
    primarySliceId: primarySlice,
    filterSliceIds: extraSlices,
    topN: topN > 0 ? topN : undefined,
    resolveSliceImageIds,
  }), [extraSlices, primarySlice, resolveSliceImageIds, topN]);

  const primaryLabel = labelById.get(primarySlice) || primarySlice;
  const filterLabels = extraSlices.map((id) => labelById.get(id) || id);
  const ruleName = [primaryLabel, ...filterLabels].filter(Boolean).join(' + ');
  const folderName = sanitizeFolderName(`${ruleName || 'combo_filter'}${topN > 0 ? `_top${topN}` : ''}`);
  const canUse = extraSlices.length >= 1 && matchedIds.length > 0;

  const addToCart = () => {
    onAddItem(makeExportCartItem({
      name: `${ruleName} · ${topN > 0 ? `前 ${topN} 张` : '全部匹配'}`,
      source: 'combined_and',
      image_ids: matchedIds,
      slice_ids: [primarySlice, ...extraSlices],
      matched_slices: [primarySlice, ...extraSlices],
      top_n: topN > 0 ? topN : undefined,
      folder_name: folderName,
    }));
  };

  return (
    <div style={styles.panel}>
      <div>
        <div style={styles.title}>组合筛选</div>
        <div style={styles.subtitle}>
          主条件决定排序，附加过滤只筛掉不符合的图片。不会做难理解的混合排序。
        </div>
      </div>

      <div style={styles.row}>
        <label style={styles.field}>
          <span style={styles.label}>主条件：决定排序</span>
          <select value={primarySlice} onChange={(event) => setPrimarySlice(event.target.value)} style={styles.select}>
            {sliceOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>附加过滤：只负责筛掉图片</span>
          <select value={nextSlice} onChange={(event) => setNextSlice(event.target.value)} style={styles.select}>
            <option value="">选择过滤条件</option>
            {sliceOptions
              .filter((item) => item.id !== primarySlice && !extraSlices.includes(item.id))
              .map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
          </select>
        </label>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!nextSlice) return;
            setExtraSlices((prev) => [...prev, nextSlice].slice(0, 3));
            setNextSlice('');
          }}
          disabled={!nextSlice || extraSlices.length >= 3}
        >
          加入过滤
        </Button>
      </div>

      {extraSlices.length > 0 && (
        <div style={styles.chips}>
          {extraSlices.map((id) => (
            <button
              key={id}
              type="button"
              style={styles.chip}
              onClick={() => setExtraSlices((prev) => prev.filter((item) => item !== id))}
              title="点击移除这个过滤条件"
            >
              过滤：{labelById.get(id) || id} ×
            </button>
          ))}
        </div>
      )}

      <div style={styles.row}>
        <label style={styles.field}>
          <span style={styles.label}>选择前 N</span>
          <input
            type="number"
            min={0}
            value={topN}
            onChange={(event) => setTopN(Number(event.target.value))}
            style={styles.numberInput}
          />
        </label>
        <span style={styles.helpText}>填 0 表示全部匹配。</span>
      </div>

      <div style={styles.preview}>
        <span>排序来自：{primaryLabel}</span>
        <span>附加过滤：{filterLabels.length ? filterLabels.join(' / ') : '尚未添加'}</span>
        <strong>匹配 {matchedIds.length} 张</strong>
      </div>

      {extraSlices.length >= 1 && matchedIds.length === 0 && (
        <div style={styles.emptyHint}>
          当前组合没有匹配图片。可以减少过滤条件，或换一个主条件。
        </div>
      )}

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUse}
          onClick={() => setMessage(`结果会先按「${primaryLabel}」排序，再保留同时命中附加过滤的图片。`)}
        >
          预览匹配说明
        </Button>
        {onSelectIds && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!canUse}
            onClick={() => onSelectIds(matchedIds)}
          >
            加入选择
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!canUse}
          onClick={addToCart}
        >
          加入导出队列
        </Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 14,
    marginBottom: 12,
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
  },
  title: {
    fontSize: 13,
    fontWeight: 800,
    color: 'var(--text, #e0e0e8)',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    lineHeight: 1.5,
  },
  row: {
    display: 'flex',
    alignItems: 'end',
    gap: 8,
    flexWrap: 'wrap',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted, #888)',
  },
  select: {
    minWidth: 190,
    padding: '6px 8px',
    fontSize: 12,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  numberInput: {
    width: 90,
    padding: '6px 8px',
    fontSize: 12,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  chips: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    padding: '3px 8px',
    fontSize: 11,
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 999,
    background: 'var(--accent-soft, rgba(124,155,255,0.14))',
    color: 'var(--accent, #7c9bff)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  helpText: {
    fontSize: 11,
    color: 'var(--text-faint, #666)',
    paddingBottom: 7,
  },
  preview: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    padding: '8px 10px',
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    border: '1px dashed var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
  },
  emptyHint: {
    padding: '6px 8px',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'var(--warning-bg, rgba(245,166,35,0.08))',
    color: 'var(--warning, #f5a623)',
    fontSize: 11,
  },
  message: {
    padding: '6px 8px',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'rgba(70,241,197,0.07)',
    color: 'var(--success, #46f1c5)',
    fontSize: 11,
  },
  actions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
};
