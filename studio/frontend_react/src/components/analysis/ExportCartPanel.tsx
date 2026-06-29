/**
 * ExportCartPanel — 导出队列面板
 *
 * RELEASE-002R:
 * - 显示 exports/<文件夹名>/ 路径
 * - 每个 item 可编辑（文件夹名、重命名、去重）
 * - 统一导出按钮
 */
import { useState } from 'react';
import Button from '../ui/Button';
import type { ExportCartState } from '../../analysis/exportCart';
import { formatCartSource } from '../../analysis/exportCart';
import ExportSettingsDialog from './ExportSettingsDialog';
import type { ExportSettings } from './ExportSettingsDialog';

interface ExportCartPanelProps {
  cart: ExportCartState;
  exporting: boolean;
  result: string | null;
  onCartChange: (cart: ExportCartState) => void;
  onRemoveItem: (id: string) => void;
  onEditItem: (id: string, settings: ExportSettings) => void;
  onExport: () => void;
  onClear: () => void;
}

export default function ExportCartPanel({
  cart,
  exporting,
  result,
  onCartChange,
  onRemoveItem,
  onEditItem,
  onExport,
  onClear,
}: ExportCartPanelProps) {
  const totalImages = cart.items.reduce((sum, item) => sum + item.image_ids.length, 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingItem = editingId ? cart.items.find(i => i.id === editingId) : null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>导出队列</div>
          <div style={styles.subtitle}>{cart.items.length} 条规则，{totalImages} 张图</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={cart.items.length === 0 || exporting}>
          清空
        </Button>
      </div>

      {/* Global rename mode */}
      <div style={styles.optionsGrid}>
        <label style={styles.field}>
          <span style={styles.label}>默认命名</span>
          <select
            value={cart.rename_mode}
            onChange={(e) => onCartChange({
              ...cart,
              rename_mode: e.target.value as typeof cart.rename_mode,
            })}
            style={styles.input}
          >
            <option value="keep_original">保留原文件名</option>
            <option value="template">按模板重命名</option>
            <option value="sequence_original">序号 + 原文件名</option>
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.label}>默认模板</span>
          <input
            value={cart.rename_template}
            onChange={(e) => onCartChange({ ...cart, rename_template: e.target.value })}
            disabled={cart.rename_mode !== 'template'}
            placeholder="{folder}_{index:04d}"
            style={{ ...styles.input, opacity: cart.rename_mode === 'template' ? 1 : 0.55 }}
          />
        </label>
      </div>

      {/* Item list */}
      <div style={styles.list}>
        {cart.items.length === 0 ? (
          <div style={styles.empty}>还没有加入导出队列。先选择图片、当前切片或组合条件。</div>
        ) : (
          cart.items.map((item) => {
            const isGlobal = item.rename_mode === undefined;
            const mode = item.rename_mode || cart.rename_mode;
            const tmpl = item.rename_template || cart.rename_template;
            return (
              <div key={item.id} style={styles.item}>
                <div style={styles.itemMain}>
                  <div style={styles.itemName}>{item.name}</div>
                  <div style={styles.itemMeta}>
                    {formatCartSource(item.source)} · {item.image_ids.length} 张
                  </div>
                  <div style={styles.itemPath}>
                    exports/{item.folder_name}/
                    {isGlobal ? '' : ` · ${mode === 'template' ? tmpl : mode}`}
                    {item.skip_duplicates ? ' · 去重' : ''}
                  </div>
                </div>
                <div style={styles.itemActions}>
                  <button
                    onClick={() => setEditingId(item.id)}
                    style={styles.editBtn}
                    disabled={exporting}
                    title="编辑导出设置"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    style={styles.removeBtn}
                    disabled={exporting}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {result && (
        <pre style={{
          ...styles.result,
          color: result.startsWith('导出失败') ? 'var(--danger, #ff5a6e)' : 'var(--success, #46f1c5)',
        }}>
          {result}
        </pre>
      )}

      <div style={styles.footer}>
        <Button
          variant="primary"
          size="sm"
          onClick={onExport}
          disabled={exporting || cart.items.length === 0}
        >
          {exporting ? '正在导出...' : '统一导出'}
        </Button>
        <span style={styles.footerHint}>导出使用原图，不复制缩略图。记录保存到 _studio/export_records/。</span>
      </div>

      {/* Edit dialog */}
      {editingItem && (
        <ExportSettingsDialog
          defaultName={editingItem.folder_name}
          totalImages={editingItem.image_ids.length}
          onConfirm={(settings) => {
            onEditItem(editingItem.id, settings);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
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
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 14, fontWeight: 700, color: 'var(--text, #e0e0e8)' },
  subtitle: { marginTop: 2, fontSize: 11, color: 'var(--text-muted, #888)' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #888)' },
  input: {
    padding: '6px 8px', fontSize: 12, background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)', borderRadius: 4,
    color: 'var(--text, #e0e0e8)', fontFamily: 'inherit',
  },
  optionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(140px, 180px) 1fr',
    gap: 8,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  empty: {
    padding: 12, border: '1px dashed var(--border, #2a2a3e)',
    borderRadius: 4, color: 'var(--text-faint, #555)', fontSize: 12,
  },
  item: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
    padding: '8px 10px', background: 'var(--bg-soft, rgba(255,255,255,0.03))',
    border: '1px solid var(--border, #2a2a3e)', borderRadius: 6,
  },
  itemMain: { minWidth: 0, flex: 1 },
  itemName: { fontSize: 12, fontWeight: 700, color: 'var(--text, #e0e0e8)' },
  itemMeta: { marginTop: 1, fontSize: 11, color: 'var(--text-muted, #888)' },
  itemPath: {
    marginTop: 2, fontSize: 10, color: 'var(--accent, #7c9bff)',
    fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  itemActions: { display: 'flex', gap: 4, flexShrink: 0 },
  editBtn: {
    padding: '2px 6px', background: 'transparent',
    border: '1px solid var(--border, #2a2a3e)', borderRadius: 4,
    color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: 13, lineHeight: '16px',
  },
  removeBtn: {
    padding: '2px 6px', background: 'transparent',
    border: '1px solid var(--border, #2a2a3e)', borderRadius: 4,
    color: 'var(--danger, #ff5a6e)', cursor: 'pointer', fontSize: 13, lineHeight: '16px',
  },
  result: {
    margin: 0, padding: 10, whiteSpace: 'pre-wrap', fontSize: 11,
    borderRadius: 4, background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
  },
  footer: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  footerHint: { fontSize: 10, color: 'var(--text-faint, #555)' },
};
