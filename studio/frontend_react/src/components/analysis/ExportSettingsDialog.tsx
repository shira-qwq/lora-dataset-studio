/**
 * ExportSettingsDialog — 添加到导出队列时的设置弹窗
 *
 * 功能：
 * - 设置导出文件夹名
 * - 选择重命名模式
 * - 自定义模板预览
 * - 跳过重复图片开关
 * - 预览导出路径和文件名
 */
import { useState, useMemo } from 'react';
import type { ExportRenameMode } from '../../analysis/exportCart';
import { sanitizeFolderName } from '../../analysis/exportCart';

interface ExportSettingsDialogProps {
  /** 默认文件夹名 */
  defaultName: string;
  /** 示例图片原始文件名列表（用于预览） */
  sampleOriginalNames?: string[];
  /** 图片总数 */
  totalImages: number;
  /** output_root 路径（前端只知道 jobId，后端解析） */
  outputRootLabel?: string;
  onConfirm: (settings: ExportSettings) => void;
  onCancel: () => void;
}

export interface ExportSettings {
  folderName: string;
  renameMode: ExportRenameMode;
  renameTemplate: string;
  skipDuplicates: boolean;
}

const DEFAULT_TEMPLATE = '{folder}_{index:04d}';

export default function ExportSettingsDialog({
  defaultName,
  sampleOriginalNames = ['image_001.png', 'photo_002.jpg', 'render_003.png'],
  totalImages,
  outputRootLabel,
  onConfirm,
  onCancel,
}: ExportSettingsDialogProps) {
  const [folderName, setFolderName] = useState(sanitizeFolderName(defaultName));
  const [renameMode, setRenameMode] = useState<ExportRenameMode>('template');
  const [renameTemplate, setRenameTemplate] = useState(DEFAULT_TEMPLATE);
  const [skipDuplicates, setSkipDuplicates] = useState(false);

  // Preview filenames
  const previewNames = useMemo(() => {
    const names: string[] = [];
    const count = Math.min(3, totalImages);
    for (let i = 0; i < count; i++) {
      const src = sampleOriginalNames[i % sampleOriginalNames.length];
      const stem = src.replace(/\.[^.]+$/, '');
      const ext = src.includes('.') ? src.substring(src.lastIndexOf('.')) : '.png';
      if (renameMode === 'keep_original') {
        names.push(src);
      } else if (renameMode === 'sequence_original') {
        names.push(`${String(i + 1).padStart(4, '0')}_${src}`);
      } else {
        const rendered = renameTemplate
          .replace(/\{folder\}/g, folderName)
          .replace(/\{index\}/g, String(i + 1))
          .replace(/\{index:03d\}/g, String(i + 1).padStart(3, '0'))
          .replace(/\{index:04d\}/g, String(i + 1).padStart(4, '0'))
          .replace(/\{original_stem\}/g, stem)
          .replace(/\{original_name\}/g, src);
        names.push(`${rendered}${ext}`);
      }
    }
    return names;
  }, [folderName, renameMode, renameTemplate, totalImages, sampleOriginalNames]);

  const previewPath = `exports/${folderName}/`;

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>导出设置</div>

        {/* Folder name */}
        <label style={styles.field}>
          <span style={styles.label}>导出文件夹名称</span>
          <input
            value={folderName}
            onChange={(e) => setFolderName(sanitizeFolderName(e.target.value))}
            style={styles.input}
            placeholder={defaultName}
          />
        </label>

        {/* Export path preview */}
        <div style={styles.pathPreview}>
          导出位置：{outputRootLabel || '<output_root>'}/{previewPath}
        </div>

        {/* Rename mode */}
        <label style={styles.field}>
          <span style={styles.label}>文件命名</span>
          <select
            value={renameMode}
            onChange={(e) => setRenameMode(e.target.value as ExportRenameMode)}
            style={styles.input}
          >
            <option value="keep_original">保留原文件名</option>
            <option value="sequence_original">序号 + 原文件名</option>
            <option value="template">按模板重命名</option>
          </select>
        </label>

        {/* Template */}
        {renameMode === 'template' && (
          <label style={styles.field}>
            <span style={styles.label}>命名模板</span>
            <input
              value={renameTemplate}
              onChange={(e) => setRenameTemplate(e.target.value)}
              style={styles.input}
              placeholder={DEFAULT_TEMPLATE}
            />
            <div style={styles.hint}>
              可用变量：{'<code>{folder}</code>'} {'<code>{index:04d}</code>'} {'<code>{original_stem}</code>'} {'<code>{original_name}</code>'}
            </div>
          </label>
        )}

        {/* Preview */}
        <div style={styles.previewBox}>
          <div style={styles.previewTitle}>文件名预览（前 {previewNames.length} 张）</div>
          {previewNames.map((name, i) => (
            <div key={i} style={styles.previewFile}>{name}</div>
          ))}
          {totalImages > previewNames.length && (
            <div style={styles.previewMore}>... 共 {totalImages} 张</div>
          )}
        </div>

        {/* Skip duplicates */}
        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={skipDuplicates}
            onChange={(e) => setSkipDuplicates(e.target.checked)}
          />
          <span>
            跳过本次导出中的重复图片
            <span style={styles.checkHint}>同一张原图在本次统一导出中只导出第一次出现的位置</span>
          </span>
        </label>

        {/* Actions */}
        <div style={styles.actions}>
          <button onClick={onCancel} style={styles.cancelBtn}>取消</button>
          <button
            onClick={() => onConfirm({ folderName, renameMode, renameTemplate, skipDuplicates })}
            style={styles.confirmBtn}
            disabled={!folderName.trim()}
          >
            添加到队列
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.62)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    width: 480,
    maxWidth: '92vw',
    maxHeight: '90vh',
    overflowY: 'auto',
    padding: 20,
    borderRadius: 12,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--card-bg, #1e1e2e)',
    color: 'var(--text, #e0e0e8)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: 800,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted, #aaa)',
  },
  input: {
    padding: '8px 10px',
    fontSize: 13,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 6,
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  hint: {
    fontSize: 10,
    color: 'var(--text-faint, #666)',
    lineHeight: 1.5,
    marginTop: 2,
  },
  pathPreview: {
    padding: '6px 10px',
    fontSize: 11,
    color: 'var(--accent, #7c9bff)',
    background: 'rgba(124,155,255,0.08)',
    borderRadius: 6,
    fontFamily: 'monospace',
  },
  previewBox: {
    padding: 10,
    background: 'var(--bg, #12121a)',
    borderRadius: 6,
    border: '1px solid var(--border, #2a2a3e)',
  },
  previewTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-faint, #666)',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  previewFile: {
    fontSize: 12,
    color: 'var(--text-muted, #aaa)',
    fontFamily: 'monospace',
    padding: '2px 0',
  },
  previewMore: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    marginTop: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-muted, #ccc)',
    lineHeight: 1.5,
  },
  checkHint: {
    display: 'block',
    fontSize: 10,
    color: 'var(--text-faint, #666)',
    marginTop: 2,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  cancelBtn: {
    padding: '7px 14px',
    background: 'transparent',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 6,
    color: 'var(--text-muted, #888)',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  confirmBtn: {
    padding: '7px 16px',
    background: 'var(--accent, #7c9bff)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
};
