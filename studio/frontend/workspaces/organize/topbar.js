/* TopBar — 顶栏 (项目 + 保存/丢弃 + 重聚/预览/分析/刷新/导出 + 搜索/缩放/画板 + 主题)
 *
 * v4.5-ui: 移除了 histogram/quality-edge sort 下拉列表 (移至 Analysis Panel 侧栏),
 *          新增 🔬 预览 和 🔎 分析视图 按钮
 */

const TopBar = {
  render(opts = {}) {
    const { onRefresh, onExport, onRerun, onPreview, onAnalysis, onSearch, onThumbSize, onZoom, onFit, onReset, onCompact, onExpandAll, onSave, onDiscard } = opts;
    const bar = document.createElement('div');
    bar.style.cssText = 'height:48px;flex-shrink:0;padding:0 12px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px';

    const project = JobStore.activeId || '无项目';
    bar.innerHTML = `
      <button id="tb-back" data-test="btn-back" title="返回项目列表" style="padding:4px 8px;background:transparent;border:none;color:var(--text-soft);cursor:pointer;font-size:14px">←</button>
      <div style="font-size:13px;font-weight:600;color:var(--text);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(project)}">${escape(project)}</div>

      <div style="width:1px;height:20px;background:var(--border)"></div>

      <button data-test="btn-undo" title="撤销 (Ctrl+Z)" style="padding:4px 8px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px;opacity:0.5">↶ 撤销</button>
      <button data-test="btn-redo" title="重做 (Ctrl+Shift+Z)" style="padding:4px 8px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px;opacity:0.5">↷ 重做</button>
      <button data-test="btn-save" title="保存所有待保存的修改 (Ctrl+S)" style="padding:4px 10px;background:var(--bg-elev);color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px;font-weight:500">💾 保存</button>
      <button data-test="btn-discard" title="丢弃所有待保存的修改" style="padding:4px 8px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px">✗ 丢弃</button>

      <div style="width:1px;height:20px;background:var(--border)"></div>

      <button data-test="btn-rerun" title="重新聚类" style="padding:4px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">↻ 重聚</button>
      <button data-test="btn-preview" title="重聚类预览 (v4.5)" style="padding:4px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">🔬 预览</button>
      <button data-test="btn-analysis" title="分析面板 (排序/筛选/全局视图)" style="padding:4px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">🔎 分析</button>
      <button data-test="btn-refresh" title="刷新数据" style="padding:4px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">↻ 刷新</button>
      <button data-test="btn-export" title="导出到磁盘文件夹" style="padding:4px 10px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500">📦 导出</button>

      <div style="flex:1"></div>

      <input id="tb-search" type="text" placeholder="搜索簇..." data-test="cluster-search" style="width:100px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:3px;font-size:12px;outline:none">

      <div style="display:flex;align-items:center;gap:4px">
        <span style="font-size:10px;color:var(--text-muted)">缩略图</span>
        <input id="tb-thumbsize" type="range" min="60" max="240" value="80" data-test="thumb-size" style="width:60px">
        <span id="tb-thumbsize-val" style="font-size:10px;color:var(--text-muted);min-width:24px">80</span>
      </div>

      <div style="display:flex;align-items:center;gap:3px">
        <button data-test="btn-zoom-fit" title="适配 (F)" style="padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px">适配</button>
        <button data-test="btn-zoom-out" title="缩小" style="padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px">−</button>
        <span id="tb-zoom-pct" style="font-size:10px;color:var(--text-muted);min-width:34px;text-align:center">100%</span>
        <button data-test="btn-zoom-in" title="放大" style="padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px">+</button>
        <button data-test="btn-reset" title="重置 (R)" style="padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px">⟲</button>
        <button data-test="btn-expand-all" title="展开/折叠全部" style="padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px">⊞</button>
      </div>

      <div data-test="theme-picker-container"></div>
    `;

    bar.querySelector('#tb-back').onclick = () => {
      if (window.OrganizerWorkspace?.hasUnsavedChanges && OrganizerWorkspace.hasUnsavedChanges()) {
        if (!confirm('有未保存的修改，确定离开？')) return;
      }
      App.switchView('home');
    };
    bar.querySelector('[data-test="btn-undo"]').onclick = () => {
      if (window.OrganizerWorkspace) OrganizerWorkspace._undo();
    };
    bar.querySelector('[data-test="btn-redo"]').onclick = () => {
      if (window.OrganizerWorkspace) OrganizerWorkspace._redo();
    };
    bar.querySelector('[data-test="btn-save"]').onclick = onSave;
    bar.querySelector('[data-test="btn-discard"]').onclick = onDiscard;
    bar.querySelector('[data-test="btn-rerun"]').onclick = onRerun;
    bar.querySelector('[data-test="btn-preview"]').onclick = onPreview;
    bar.querySelector('[data-test="btn-analysis"]').onclick = onAnalysis;
    bar.querySelector('[data-test="btn-refresh"]').onclick = onRefresh;
    bar.querySelector('[data-test="btn-export"]').onclick = onExport;
    bar.querySelector('#tb-search').oninput = (e) => onSearch && onSearch(e.target.value);

    // 监听 undo 状态事件
    const undoBtn = bar.querySelector('[data-test="btn-undo"]');
    const redoBtn = bar.querySelector('[data-test="btn-redo"]');
    document.addEventListener('organize-undo-state', (e) => {
      undoBtn.style.opacity = e.detail.canUndo ? '1' : '0.4';
      undoBtn.style.cursor = e.detail.canUndo ? 'pointer' : 'not-allowed';
      undoBtn.disabled = !e.detail.canUndo;
      redoBtn.style.opacity = e.detail.canRedo ? '1' : '0.4';
      redoBtn.style.cursor = e.detail.canRedo ? 'pointer' : 'not-allowed';
      redoBtn.disabled = !e.detail.canRedo;
    });

    const thumbSizeEl = bar.querySelector('#tb-thumbsize');
    const thumbSizeVal = bar.querySelector('#tb-thumbsize-val');
    thumbSizeEl.oninput = (e) => {
      const v = parseInt(e.target.value);
      thumbSizeVal.textContent = v;
      onThumbSize && onThumbSize(v);
    };

    bar.querySelector('[data-test="btn-zoom-fit"]').onclick = () => onFit && onFit();
    bar.querySelector('[data-test="btn-zoom-out"]').onclick = () => onZoom && onZoom(-0.15);
    bar.querySelector('[data-test="btn-zoom-in"]').onclick = () => onZoom && onZoom(0.15);
    bar.querySelector('[data-test="btn-reset"]').onclick = () => onReset && onReset();
    const compactBtn = document.createElement('button');
    compactBtn.dataset.test = 'btn-compact';
    compactBtn.title = '贴近排列';
    compactBtn.textContent = '贴近';
    compactBtn.style.cssText = 'padding:3px 6px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:10px';
    bar.querySelector('[data-test="btn-reset"]').after(compactBtn);
    compactBtn.onclick = () => onCompact && onCompact();
    bar.querySelector('[data-test="btn-expand-all"]').onclick = () => onExpandAll && onExpandAll();

    ThemePicker.render(bar.querySelector('[data-test="theme-picker-container"]'));

    return { bar, zoomPctEl: bar.querySelector('#tb-zoom-pct'), thumbSizeEl, thumbSizeVal };
  }
};

window.TopBar = TopBar;
