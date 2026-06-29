/* OrganizerWorkspace — 主类
 *
 * v3 关键改动:
 * - 拖动只更新浏览器 DOM，不调用 API（pendingMoves 累积在内存）
 * - 顶栏 "💾 保存" 按钮批量发送
 * - 导出时自动保存
 * - 切换页面时弹窗询问
 * - 移动后不重新加载任何数据
 */

const OrganizerWorkspace = {
  _state: {
    clusters: [],
    clusterImages: {},
    thumbSize: 80,
    jobId: null,
    imageObserver: null,
    folded: new Set(),
    expandedAll: false,
    pendingMoves: new Map(),
    pendingRenames: new Map()
  },
  _ctxMenu: null,

  async render(container, params = {}) {
    const jobId = params.jobId || JobStore.activeId;
    if (!jobId) {
      container.innerHTML = `<div style="padding:24px;color:var(--text-muted)">请先选择项目</div>`;
      return;
    }
    JobStore.setActive(jobId);
    this._state.jobId = jobId;
    this._state.clusters = [];
    this._state.clusterImages = {};
    this._state.pendingMoves = new Map();
    this._state.pendingRenames = new Map();
    this._state.folded = new Set(JSON.parse(localStorage.getItem('organize_folded_' + jobId) || '[]'));
    this._state.thumbSize = parseInt(localStorage.getItem('organize_thumb_' + jobId) || '80');

    container.style.cssText = 'display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden';
    container.innerHTML = `
      <div data-test="topbar-slot"></div>
      <div style="flex:1;display:flex;overflow:hidden">
        <div data-test="sidebar-slot" style="display:flex"></div>
        <div data-test="canvas-slot" style="flex:1;position:relative;overflow:hidden;background:var(--bg)">
          <div class="canvas-viewport" style="position:absolute;inset:0;overflow:hidden;cursor:grab;background-image:radial-gradient(circle, var(--border) 1px, transparent 1px);background-size:24px 24px">
            <div class="canvas-world" style="position:absolute;left:0;top:0;transform-origin:0 0;width:0;height:0"></div>
          </div>
          <div class="canvas-minimap" data-test="canvas-minimap" style="position:absolute;right:8px;bottom:8px;width:160px;height:120px;background:var(--bg-elev);border:1px solid var(--border);border-radius:4px;overflow:hidden;z-index:50;cursor:pointer"></div>
        </div>
      </div>
      <div id="sel-bar" style="height:40px;background:var(--bg-elev);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:8px;flex-shrink:0"></div>
      <div style="height:24px;background:var(--bg-elev);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 16px;font-size:11px;color:var(--text-muted);gap:12px;flex-shrink:0">
        <span data-test="status">系统就绪</span><span>|</span>
        <span data-test="footer-images">— 图</span><span>|</span>
        <span data-test="footer-clusters">— 簇</span><span>|</span>
        <span data-test="footer-zoom">100%</span>
        <span style="flex:1"></span>
        <span data-test="footer-tip">滚轮缩放 · 拖空白平移 · Ctrl+拖框选 · 双击标题改名 · 右键菜单</span>
      </div>
    `;

    this._state.histogramSummary = null;
    this._state.histogramSort = null;
    this._state.histogramLabel = null;
    this._state.qualityEdgeSummary = null;
    this._state.qualityEdgeSort = null;
    this._state.sortMode = 'organize'; // 'organize' | 'global-analysis'
    this._state.analysisSortField = null;
    this._state.analysisSortOrder = 'desc';
    this._state.analysisFilterLabel = null;

    const tb = TopBar.render({
      onRefresh: () => this._load(),
      onExport: () => this._export(),
      onRerun: () => this._rerun(),
      onPreview: () => { if (window.ReclusterPreview) ReclusterPreview.open(this._state.jobId); },
      onAnalysis: () => { this._openAnalysisPanel(); },
      onSearch: (q) => this._search(q),
      onThumbSize: (sz) => { this._state.thumbSize = sz; this._saveState(); this._renderGrid(); },
      onZoom: (delta) => this._zoom(delta),
      onFit: () => this._fit(),
      onReset: () => this._reset(),
      onCompact: () => this._reflowLayout(),
      onExpandAll: () => this._toggleExpandAll(),
      onSave: () => this._save(),
      onDiscard: () => this._discardChanges(),
    });
    container.querySelector('[data-test="topbar-slot"]').replaceWith(tb.bar);
    this._tbZoomPct = tb.zoomPctEl;
    this._updateZoomPct();

    const sb = Sidebar.render([], { onSelect: (cid) => this._scrollToCluster(cid) });
    container.querySelector('[data-test="sidebar-slot"]').replaceWith(sb);
    this._sidebar = sb;

    const viewport = container.querySelector('.canvas-viewport');
    const world = container.querySelector('.canvas-world');
    Canvas.init(viewport, world);
    Canvas.onZoom = (s) => { this._updateZoomPct(); this._updateMinimap(); this._saveState(); };
    this._world = world;
    this._viewport = viewport;
    this._minimapEl = container.querySelector('.canvas-minimap');

    viewport.addEventListener('mousedown', (e) => {
      if (Selection.startBoxSelect(e)) {
        e.preventDefault(); e.stopPropagation();
        const onMove = (ev) => Selection.updateBoxSelect(ev);
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
    });

    viewport.addEventListener('contextmenu', (e) => { e.preventDefault(); this._showContextMenu(e); });

    this._minimapEl.onclick = (e) => {
      const rect = this._minimapEl.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      const blocks = this._world.querySelectorAll('.cluster-block');
      if (!blocks.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      blocks.forEach(b => {
        const x = parseFloat(b.style.left) || 0;
        const y = parseFloat(b.style.top) || 0;
        const w = b.offsetWidth || 200, h = b.offsetHeight || 200;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      });
      const wW = maxX - minX, wH = maxY - minY;
      const targetX = minX + mx * wW;
      const targetY = minY + my * wH;
      const vw = this._viewport.clientWidth, vh = this._viewport.clientHeight;
      Canvas.state.pan.x = vw / 2 - targetX * Canvas.state.scale;
      Canvas.state.pan.y = vh / 2 - targetY * Canvas.state.scale;
      Canvas.applyTransform();
      this._updateMinimap();
      this._saveState();
    };

    Selection.init();
    window.__organizeRenderMoveTo = () => this._renderMoveToDropdown();

    this._reloadHandler = async () => {
      if (this.hasUnsavedChanges()) {
        const ok = await Confirm.ask('丢弃未保存修改？',
          '刷新将从后端重新读取数据，当前 ' +
          (this._state.pendingMoves.size + this._state.pendingRenames.size) +
          ' 项未保存修改将丢失。',
          { yesText: '丢弃并刷新', noText: '取消', danger: true }
        );
        if (!ok) return;
      }
      this._load();
    };
    window.addEventListener('organize-reload', this._reloadHandler);
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('click', () => this._hideContextMenu());

    await this._load();

    const saved = JSON.parse(localStorage.getItem('organize_canvas_' + jobId) || 'null');
    if (saved) {
      Canvas.state.scale = saved.scale;
      Canvas.state.pan = saved.pan;
      Canvas.applyTransform();
      this._updateZoomPct();
      this._updateMinimap();
    } else {
      setTimeout(() => this._fit(), 200);
    }
  },

  _onKey: function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') { Selection.clear(); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const ids = SelectionStore.getAll();
      if (ids.length) {
        const nc = OrganizerWorkspace._state.clusters.find(c => String(c.id) === '-1' || String(c.id) === 'noise');
        if (nc) OrganizerWorkspace._moveLocal(ids, nc.id);
        e.preventDefault();
      }
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); OrganizerWorkspace._selectAll(); }
    else if (e.key === 'f') OrganizerWorkspace._fit();
    else if (e.key === 'r' && !e.ctrlKey && !e.metaKey) OrganizerWorkspace._reset();
    else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); OrganizerWorkspace._save(); }
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); OrganizerWorkspace._undo(); }
    else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); OrganizerWorkspace._redo(); }
  },

  _saveState() {
    if (!this._state.jobId) return;
    localStorage.setItem('organize_canvas_' + this._state.jobId, JSON.stringify({
      scale: Canvas.state.scale, pan: { ...Canvas.state.pan }
    }));
    localStorage.setItem('organize_thumb_' + this._state.jobId, String(this._state.thumbSize));
    localStorage.setItem('organize_folded_' + this._state.jobId, JSON.stringify(Array.from(this._state.folded)));
  },

  async _load() {
    const jobId = this._state.jobId;
    try {
      const [clustersRaw, summaryRaw] = await Promise.all([
        fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters'),
        fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/summary')
      ]);
      if (!clustersRaw.ok) {
        let message = '加载项目失败';
        try {
          const err = await clustersRaw.json();
          message = err.detail || err.message || message;
        } catch (ignore) {}
        const error = new Error(message);
        error.status = clustersRaw.status;
        throw error;
      }
      const clustersResp = await clustersRaw.json();
      const summaryResp = summaryRaw.ok ? await summaryRaw.json().catch(() => ({})) : {};
      let clusters = (clustersResp.clusters || []).filter(c => String(c.id) !== '-1' && String(c.id) !== 'noise');
      this._state.clusters = clusters;
      const totalImages = summaryResp.total_images || clusters.reduce((a, c) => a + (c.count || 0), 0);
      this._setFooter(totalImages, clusters.length);
      this._renderSidebar();
      await this._loadClusterImages();
      await this._loadHistogramSummary();
      await this._loadQualityEdgeSummary();
      this._state.sortMode = 'organize';
      this._renderGrid();
      this._updateMinimap();
      this._updatePendingIndicator();
      this._initCommandStack();
      this._startAutoSave();
    } catch (e) {
      if (e.status === 404) {
        JobStore.setActive('');
      }
      this._renderEmptyState('无法打开这个项目', e.message || '请返回项目列表后重新选择');
      Toast.error('加载失败: ' + e.message);
    }
  },

  async _loadClusterImages() {
    const jobId = this._state.jobId;
    const promises = this._state.clusters.map(async (c) => {
      try {
        const limit = Math.max(c.count || 0, 200);
        const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/images?cluster_id=' + encodeURIComponent(c.id) + '&limit=' + encodeURIComponent(limit) + '&offset=0');
        const data = await resp.json();
        return [c.id, data.images || []];
      } catch (e) { return [c.id, []]; }
    });
    const results = await Promise.all(promises);
    this._state.clusterImages = {};
    results.forEach(([cid, imgs]) => { this._state.clusterImages[cid] = imgs; });
  },

  async _loadHistogramSummary() {
    const jobId = this._state.jobId;
    if (!jobId) return;
    try {
      const resp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/histogram-summary?limit=1');
      if (!resp.ok) {
        this._state.histogramSummary = null;
        return;
      }
      const data = await resp.json();
      if (data.ok && data.total > 0) {
        // Load full summary for sorting/filtering (limit all records)
        const fullResp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/histogram-summary?limit=' + data.total);
        const fullData = await fullResp.json();
        if (fullData.ok) {
          // Build lookup: image_path -> histogram record
          const lookup = {};
          (fullData.records || []).forEach(r => {
            const key = r.image_path || '';
            lookup[key] = r;
          });
          this._state.histogramSummary = lookup;
        }
      }
    } catch (e) {
      this._state.histogramSummary = null; // Silently fail — histogram is optional
    }
  },

  async _loadQualityEdgeSummary() {
    const jobId = this._state.jobId;
    if (!jobId) return;
    try {
      const resp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/quality-edge-summary?limit=1');
      if (!resp.ok) { this._state.qualityEdgeSummary = null; return; }
      const data = await resp.json();
      if (data.ok && data.total > 0) {
        const fullResp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/quality-edge-summary?limit=' + data.total);
        const fullData = await fullResp.json();
        if (fullData.ok) {
          const lookup = {};
          (fullData.records || []).forEach(r => {
            const key = r.image_path || '';
            lookup[key] = r;
          });
          this._state.qualityEdgeSummary = lookup;
        }
      }
    } catch (e) {
      this._state.qualityEdgeSummary = null;
    }
  },

  _renderSidebar() {
    const newSb = Sidebar.render(this._state.clusters, { onSelect: (cid) => this._scrollToCluster(cid) });
    this._sidebar.replaceWith(newSb);
    this._sidebar = newSb;
  },

  _renderGrid(opts = {}) {
    if (!this._world) return;
    const { clusters, thumbSize, clusterImages, folded, expandedAll } = this._state;
    const blockGapX = opts.blockGapX ?? 32;
    const blockGapY = opts.blockGapY ?? 28;
    const collisionGap = opts.collisionGap ?? 18;
    const collisionPadding = opts.collisionPadding ?? 24;
    if (!clusters.length) {
      this._renderEmptyState('No cluster result yet', 'Go back to the project list or rerun the analysis.');
      return;
    }
    // 加载用户自定义簇位置
    Grid.loadPositions(this._state.jobId);
    const imageCounts = {};
    const maxDisplayById = {};
    clusters.forEach(c => {
      imageCounts[c.id] = (clusterImages[c.id] || []).length;
      maxDisplayById[c.id] = (folded.has(c.id) && !expandedAll) ? 20 : imageCounts[c.id];
    });
    const layout = Grid.computeLayout(clusters, thumbSize, {
      viewportWidth: this._viewport ? this._viewport.clientWidth : window.innerWidth,
      imageCounts,
      maxDisplayById,
      blockGapX,
      blockGapY
    });
    // Apply pending moves to clusterImages (view-layer only)
    if (this._state.pendingMoves && this._state.pendingMoves.size > 0) {
      const pm = this._state.pendingMoves;
      // Collect images that need to be moved, rebuild clusterImages
      const movedFilenames = new Set(pm.keys());
      clusters.forEach(c => {
        const cid = String(c.id);
        let imgs = this._state.clusterImages[cid] || [];
        // Remove images that were moved away
        imgs = imgs.filter(img => !movedFilenames.has(img.filename));
        // Add images that were moved into this cluster
        pm.forEach((targetCid, fn) => {
          if (String(targetCid) === cid) {
            // Find the image object from its original cluster
            for (const [srcCid, srcImgs] of Object.entries(this._state.clusterImages)) {
              const found = srcImgs.find(img => img.filename === fn);
              if (found) { imgs.push(found); break; }
            }
          }
        });
        clusterImages[cid] = imgs;
      });
    }

    // Apply histogram sort/filter (view-layer only, does NOT change clusters)
    const histSummary = this._state.histogramSummary;
    const histSort = this._state.histogramSort;
    const histLabel = this._state.histogramLabel;
    const qeSummary = this._state.qualityEdgeSummary;
    const qeSort = this._state.qualityEdgeSort;

    // Apply quality-edge sort (view-layer only)
    if (qeSort && qeSort.field && qeSummary) {
      const field = qeSort.field;
      const order = qeSort.order || 'desc';
      clusterImages = {};
      clusters.forEach(c => {
        let imgs = this._state.clusterImages[c.id] || [];
        imgs = [...imgs].sort((a, b) => {
          const keyA = a.path || a.thumbnail || a.filename || '';
          const keyB = b.path || b.thumbnail || b.filename || '';
          const recA = qeSummary[keyA] || qeSummary[a.filename] || null;
          const recB = qeSummary[keyB] || qeSummary[b.filename] || null;
          const valA = recA ? (parseFloat(recA[field]) || 0) : 0;
          const valB = recB ? (parseFloat(recB[field]) || 0) : 0;
          return order === 'desc' ? valB - valA : valA - valB;
        });
        clusterImages[c.id] = imgs;
      });
    }
    const html = clusters.map((c, i) => {
      let imgs = clusterImages[c.id] || [];

      // Apply histogram label filter (view-layer only)
      if (histLabel && histSummary) {
        imgs = imgs.filter(img => {
          const key = img.path || img.thumbnail || img.filename || '';
          const rec = histSummary[key] || histSummary[img.filename] || histSummary[key.split('/').pop()];
          if (!rec) return true; // Show images without histogram data
          const labels = (rec.labels || '').split(';').map(l => l.trim());
          return labels.includes(histLabel);
        });
      }

      // Apply histogram sort (view-layer only)
      if (histSort && histSort.field && histSummary) {
        const field = histSort.field;
        const order = histSort.order || 'desc';
        imgs = [...imgs].sort((a, b) => {
          const keyA = a.path || a.thumbnail || a.filename || '';
          const keyB = b.path || b.thumbnail || b.filename || '';
          const recA = histSummary[keyA] || histSummary[a.filename] || histSummary[keyA.split('/').pop()];
          const recB = histSummary[keyB] || histSummary[b.filename] || histSummary[keyB.split('/').pop()];
          const valA = recA ? (parseFloat(recA[field]) || 0) : 0;
          const valB = recB ? (parseFloat(recB[field]) || 0) : 0;
          return order === 'desc' ? valB - valA : valA - valB;
        });
      }

      const isFolded = folded.has(c.id) && !expandedAll;
      const maxDisplay = isFolded ? 20 : imgs.length;
      return Grid.renderBlock(c, imgs, {
        thumbSize,
        blockWidth: layout.positions[i].width,
        blockHeight: layout.positions[i].height,
        x: layout.positions[i].x, y: layout.positions[i].y,
        maxDisplay,
        histogramLookup: this._state.histogramSummary,
      });
    }).join('');
    this._world.innerHTML = html;
    const blocks = Array.from(this._world.querySelectorAll('.cluster-block'));
    const resolved = Grid.resolveCollisions(blocks, {
      gap: collisionGap,
      padding: collisionPadding
    });
    this._world.style.width = Math.max(layout.worldWidth, resolved.bounds.width) + 'px';
    this._world.style.height = Math.max(layout.worldHeight, resolved.bounds.height) + 'px';

    this._world.querySelectorAll('.thumb').forEach(t => {
      let didMove = false, startX, startY;
      t.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        didMove = false; startX = e.clientX; startY = e.clientY;
        const onMove = (ev) => {
          if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
            didMove = true;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            Drag.onThumbMouseDown(t, e);
          }
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (!didMove) {
            if (e.ctrlKey || e.metaKey) Selection.onThumbClick(t, e);
            else {
              Selection.onThumbClick(t, e);
              this._showImageModal(t.dataset.path, t.dataset.filename);
            }
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    this._world.querySelectorAll('.cluster-title').forEach(el => {
      el.ondblclick = (e) => {
        e.stopPropagation();
        const cid = el.dataset.cid;
        const current = el.textContent;
        const input = document.createElement('input');
        input.value = current;
        input.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--accent);color:var(--text);border-radius:2px;padding:2px 4px;font-size:13px;font-weight:600;outline:none';
        el.replaceWith(input);
        input.focus(); input.select();
        const finish = (commit) => {
          const val = input.value.trim();
          const span = document.createElement('span');
          span.className = el.className;
          span.dataset.cid = cid;
          span.textContent = val || current;
          input.replaceWith(span);
          if (commit && val && val !== current) {
            const oldName = current;
            this._state.pendingRenames.set(String(cid), val);
            this._state.clusters.forEach(x => { if (String(x.id) === String(cid)) { x.suggested_name = val; x.name = val; } });
            this._updatePendingIndicator();
            this._renderSidebar();

            // 推 undo command
            this.pushCommand({
              name: `重命名簇 #${cid}: "${oldName}" → "${val}"`,
              undo: async () => {
                this._state.pendingRenames.set(String(cid), oldName);
                this._state.clusters.forEach(x => { if (String(x.id) === String(cid)) { x.suggested_name = oldName; x.name = oldName; } });
                this._updatePendingIndicator();
                this._renderSidebar();
                this._renderGrid();
                Toast.info('↶ 撤销重命名');
              },
              redo: async () => {
                this._state.pendingRenames.set(String(cid), val);
                this._state.clusters.forEach(x => { if (String(x.id) === String(cid)) { x.suggested_name = val; x.name = val; } });
                this._updatePendingIndicator();
                this._renderSidebar();
                this._renderGrid();
                Toast.info('↷ 重做重命名');
              }
            });

            Toast.info('名称已暂存');
          }
          span.ondblclick = arguments.callee;
        };
        input.onkeydown = (ev) => {
          if (ev.key === 'Enter') finish(true);
          if (ev.key === 'Escape') finish(false);
        };
        input.onblur = () => finish(true);
      };
    });

    this._world.querySelectorAll('.cluster-fold').forEach(btn => {
      const cid = btn.dataset.cid;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this._state.folded.has(cid)) this._state.folded.delete(cid);
        else this._state.folded.add(cid);
        this._saveState(); this._renderGrid();
      };
    });

    this._world.querySelectorAll('.load-more').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); e.preventDefault();
        const cid = btn.dataset.cid;
        const imgs = this._state.clusterImages[cid] || [];
        btn.textContent = '加载中...';
        try {
          const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(this._state.jobId) + '/images?cluster_id=' + encodeURIComponent(cid) + '&limit=60&offset=' + imgs.length);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          const newImgs = data.images || [];
          if (newImgs.length) {
            this._state.clusterImages[cid] = imgs.concat(newImgs);
            this._renderGrid();
            Toast.success(`已加载 ${newImgs.length} 张`);
          } else {
            btn.textContent = '没有更多了';
            btn.disabled = true;
          }
        } catch (e) { btn.textContent = '加载失败 - 重试'; Toast.error('加载失败: ' + e.message); }
      };
    });

    // === 簇头可拖动 (改变簇位置) ===
    this._world.querySelectorAll('.drag-handle').forEach(handle => {
      const cid = handle.dataset.cid;
      const block = handle.closest('.cluster-block');
      if (!block) return;
      let dragging = false;
      let startX, startY, origX, origY;
      const onDown = (e) => {
        // 只响应鼠标左键
        if (e.button !== 0) return;
        // 不响应 Ctrl 键 (那是框选)
        if (e.ctrlKey || e.metaKey) return;
        dragging = true;
        const r = block.getBoundingClientRect();
        // 计算鼠标相对世界坐标 (考虑 canvas 缩放/平移)
        const worldX = (e.clientX - Canvas.state.pan.x) / Canvas.state.scale - r.left + parseFloat(block.style.left);
        const worldY = (e.clientY - Canvas.state.pan.y) / Canvas.state.scale - r.top + parseFloat(block.style.top);
        startX = e.clientX;
        startY = e.clientY;
        origX = parseFloat(block.style.left) || 0;
        origY = parseFloat(block.style.top) || 0;
        e.preventDefault();
        e.stopPropagation();
        document.body.style.cursor = 'grabbing';
      };
      const onMove = (e) => {
        if (!dragging) return;
        const dx = (e.clientX - startX) / Canvas.state.scale;
        const dy = (e.clientY - startY) / Canvas.state.scale;
        block.style.left = (origX + dx) + 'px';
        block.style.top = (origY + dy) + 'px';
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        const blocks = Array.from(this._world.querySelectorAll('.cluster-block'));
        const resolved = Grid.resolveCollisions(blocks, {
          fixedIds: [cid],
          gap: 18,
          padding: 24
        });
        Grid.customPositions = resolved.positions;
        Grid.savePositions(this._state.jobId);
        this._world.style.width = resolved.bounds.width + 'px';
        this._world.style.height = resolved.bounds.height + 'px';
        this._updateMinimap();
      };
      handle.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    this._world.querySelectorAll('.cluster-resize').forEach(handle => {
      const cid = handle.dataset.cid;
      const block = handle.closest('.cluster-block');
      if (!block) return;
      let resizing = false;
      let startX = 0;
      let startY = 0;
      let startWidth = 0;
      let startHeight = 0;
      const minWidth = Math.max(thumbSize * 4 + 60, 380);
      const minHeight = 220;
      const onDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseFloat(block.style.width) || block.offsetWidth || minWidth;
        startHeight = parseFloat(block.style.minHeight) || block.offsetHeight || minHeight;
        document.body.style.cursor = 'nwse-resize';
      };
      const onMove = (e) => {
        if (!resizing) return;
        const dx = (e.clientX - startX) / Canvas.state.scale;
        const dy = (e.clientY - startY) / Canvas.state.scale;
        const nextWidth = Math.max(minWidth, Math.round(startWidth + dx));
        const nextHeight = Math.max(minHeight, Math.round(startHeight + dy));
        block.style.width = nextWidth + 'px';
        block.style.minHeight = nextHeight + 'px';
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        document.body.style.cursor = '';
        const nextWidth = Math.max(minWidth, parseFloat(block.style.width) || startWidth);
        const nextHeight = Math.max(minHeight, parseFloat(block.style.minHeight) || startHeight);
        Grid.customSizes[String(cid)] = { width: nextWidth, height: nextHeight };
        const blocks = Array.from(this._world.querySelectorAll('.cluster-block'));
        const resolved = Grid.resolveCollisions(blocks, {
          fixedIds: [cid],
          gap: 18,
          padding: 24
        });
        Grid.customPositions = resolved.positions;
        Grid.savePositions(this._state.jobId);
        this._world.style.width = resolved.bounds.width + 'px';
        this._world.style.height = resolved.bounds.height + 'px';
        this._updateMinimap();
      };
      handle.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    if (this._state.imageObserver) this._state.imageObserver.disconnect();
    this._state.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src && !img.src) {
            const path = decodeURIComponent(img.dataset.src);
            ImageStore.getCachedThumbnailUrl(this._state.jobId, path).then(url => { img.src = url; }).catch(() => {});
          }
          this._state.imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '500px' });
    this._world.querySelectorAll('.thumb-img[data-src]').forEach(img => this._state.imageObserver.observe(img));

    this._updateMinimap();
  },

  _renderMoveToDropdown() {
    const wrap = document.getElementById('sel-moveto-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<button id="sel-moveto" data-test="btn-moveto" style="margin-left:8px;padding:3px 10px;background:var(--accent);color:var(--on-accent);border:none;border-radius:3px;cursor:pointer;font-size:12px;position:relative">移动到 ▾</button>`;
    const btn = wrap.querySelector('#sel-moveto');
    let menu = null;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (menu) { menu.remove(); menu = null; return; }
      menu = document.createElement('div');
      menu.style.cssText = 'position:absolute;bottom:100%;left:0;margin-bottom:4px;background:var(--bg-elev);border:1px solid var(--border);border-radius:4px;min-width:200px;max-height:300px;overflow-y:auto;z-index:1000;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
      menu.innerHTML = this._state.clusters.map(c => {
        const name = c.suggested_name || c.name || ('簇 ' + c.id);
        const color = c.color || '#46f1c5';
        return `<div class="mto-item" data-cid="${c.id}" style="padding:6px 10px;display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text)"><span style="width:8px;height:8px;border-radius:50%;background:${color}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(name)}</span><span style="font-size:10px;color:var(--text-muted)">${c.count || 0}</span></div>`;
      }).join('');
      menu.querySelectorAll('.mto-item').forEach(el => {
        el.onmouseover = () => el.style.background = 'var(--bg-elev)';
        el.onmouseout = () => el.style.background = '';
        el.onclick = (ev) => { ev.stopPropagation(); menu.remove(); menu = null; this._moveLocal(SelectionStore.getAll(), el.dataset.cid); };
      });
      btn.appendChild(menu);
    };
    document.addEventListener('click', () => { if (menu) { menu.remove(); menu = null; } });
  },

  // === 关键：本地移动（无 API）===
  _moveLocal(ids, targetCid) {
    if (!ids || !ids.length) return;
    const targetCidStr = String(targetCid);

    // 记录原簇 (for undo)
    const originalCids = {};
    ids.forEach(id => {
      const orig = this._findOriginalClusterOfImage(id);
      originalCids[id] = orig;
      this._state.pendingMoves.set(id, targetCidStr);
    });

    // 推 undo command
    this.pushCommand({
      name: `移动 ${ids.length} 张图到簇 #${targetCidStr}`,
      undo: async () => {
        ids.forEach(id => {
          const orig = originalCids[id];
          if (orig) {
            this._state.pendingMoves.set(id, orig);
            // 视觉撤销
            const thumb = this._world.querySelector(`.thumb[data-filename="${id}"]`);
            if (thumb) {
              const origBlock = this._world.querySelector(`.cluster-block[data-cid="${orig}"] .cluster-grid`);
              if (origBlock) origBlock.appendChild(thumb);
            }
          } else {
            this._state.pendingMoves.delete(id);
          }
        });
        this._loadClusterImages();
        this._renderGrid();
        this._updatePendingIndicator();
        Toast.info('↶ 撤销移动');
      },
      redo: async () => {
        ids.forEach(id => this._state.pendingMoves.set(id, targetCidStr));
        this._applyLocalMoveVisual(ids, targetCidStr);
        this._loadClusterImages();
        this._renderGrid();
        this._updatePendingIndicator();
        Toast.info('↷ 重做移动');
      }
    });

    // 视觉：移动 DOM 元素
    this._applyLocalMoveVisual(ids, targetCidStr);

    // 更新计数
    const sourceCounts = {};
    ids.forEach(id => {
      const sourceCid = originalCids[id];
      if (sourceCid && sourceCid !== targetCidStr) {
        sourceCounts[sourceCid] = (sourceCounts[sourceCid] || 0) + 1;
      }
    });
    Object.entries(sourceCounts).forEach(([cid, n]) => {
      const c = this._state.clusters.find(x => String(x.id) === String(cid));
      if (c) c.count = Math.max(0, (c.count || 0) - n);
    });
    const tc = this._state.clusters.find(x => String(x.id) === targetCidStr);
    if (tc) tc.count = (tc.count || 0) + ids.length;
    this._renderSidebar();
    this._updateMinimap();

    Selection.clear();
    this._updatePendingIndicator();
    Toast.info(`已暂存 ${ids.length} 张 (待保存)`);
  },

  _findOriginalClusterOfImage(filename) {
    for (const [cid, imgs] of Object.entries(this._state.clusterImages)) {
      if (imgs.some(img => img.filename === filename)) return String(cid);
    }
    return null;
  },

  _applyLocalMoveVisual(ids, targetCidStr) {
    const targetBlock = this._world.querySelector(`.cluster-block[data-cid="${targetCidStr}"]`);
    if (!targetBlock) return;
    const targetGrid = targetBlock.querySelector('.cluster-grid');
    if (!targetGrid) return;
    ids.forEach(id => {
      const thumb = this._world.querySelector(`.thumb[data-filename="${id}"]`);
      if (thumb) targetGrid.appendChild(thumb);
    });
  },

  _updatePendingIndicator() {
    const count = this._state.pendingMoves.size + this._state.pendingRenames.size;
    const saveBtn = document.querySelector('[data-test="btn-save"]');
    if (saveBtn) {
      saveBtn.textContent = count > 0 ? `💾 保存 (${count})` : '💾 保存';
      saveBtn.style.background = count > 0 ? 'var(--accent)' : 'var(--bg-elev)';
      saveBtn.style.color = count > 0 ? 'var(--on-accent)' : 'var(--text-muted)';
    }
    const status = document.querySelector('[data-test="status"]');
    if (status) {
      status.textContent = count > 0 ? `● ${count} 个待保存` : '系统就绪';
      status.style.color = count > 0 ? 'var(--warning)' : 'var(--success)';
    }
  },

  // === 批量保存所有 pending ===
  async _save() {
    if (this._state.pendingMoves.size === 0 && this._state.pendingRenames.size === 0) {
      Toast.info('没有待保存的修改');
      return;
    }
    const moves = Array.from(this._state.pendingMoves.entries()).map(([fn, cid]) => ({ filename: fn, target_cluster_id: cid }));
    const renames = Array.from(this._state.pendingRenames.entries()).map(([cid, name]) => ({ cluster_id: cid, display_name: name }));
    Toast.info(`正在保存 ${moves.length} 移动 + ${renames.length} 重命名...`);
    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(this._state.jobId) + '/organize/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ moves, renames })
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        Toast.success(`已保存: ${data.moved} 移动, ${data.renamed} 重命名`);
        this._state.pendingMoves.clear();
        this._state.pendingRenames.clear();
        // 更新本地 _state.clusterImages 反映已保存的移动
        this._applyPendingMovesToClusterImages();
        this._updatePendingIndicator();
        // 不调用 _load() — 避免全量刷新
      } else {
        Toast.error('保存失败: ' + (data.detail || data.message || '未知'));
      }
    } catch (e) { Toast.error('保存失败: ' + e.message); }
  },

  // 将 pendingMoves 写入 _state.clusterImages (保存后固化)
  _applyPendingMovesToClusterImages() {
    const pm = this._state.pendingMoves;
    if (!pm || pm.size === 0) return;
    // First pass: collect all image objects by filename (before any removal)
    const allImgs = {};
    Object.values(this._state.clusterImages).forEach(imgs => {
      imgs.forEach(img => { if (img.filename) allImgs[img.filename] = img; });
    });
    // Remove moved images from all clusters
    pm.forEach((targetCid, fn) => {
      Object.keys(this._state.clusterImages).forEach(cid => {
        this._state.clusterImages[cid] = (this._state.clusterImages[cid] || [])
          .filter(img => img.filename !== fn);
      });
    });
    // Add images to target clusters
    pm.forEach((targetCid, fn) => {
      if (allImgs[fn]) {
        if (!this._state.clusterImages[targetCid]) {
          this._state.clusterImages[targetCid] = [];
        }
        this._state.clusterImages[targetCid].push(allImgs[fn]);
      }
    });
  },

  _discardChanges() {
    if (this._state.pendingMoves.size === 0 && this._state.pendingRenames.size === 0) {
      Toast.info('没有待丢弃的修改');
      return;
    }
    const n = this._state.pendingMoves.size + this._state.pendingRenames.size;
    this._state.pendingMoves.clear();
    this._state.pendingRenames.clear();
    this._load();
    Toast.info(`已丢弃 ${n} 个修改`);
  },

  hasUnsavedChanges() {
    return this._state.pendingMoves.size > 0 || this._state.pendingRenames.size > 0;
  },

  // ===== 自动保存 =====
  _autoSaveTimer: null,
  _autoSaveDelay: 30000,  // 30 秒

  _startAutoSave() {
    if (this._autoSaveTimer) clearInterval(this._autoSaveTimer);
    this._autoSaveTimer = setInterval(() => {
      if (this.hasUnsavedChanges()) {
        this._save().then(() => {
          Toast.success('✓ 已自动保存', 1500);
        }).catch(e => {
          Toast.error('自动保存失败: ' + e.message);
        });
      }
    }, this._autoSaveDelay);
  },

  // ===== 全能撤销 (Command 模式) =====
  _initCommandStack() {
    this._undoStack = [];
    this._redoStack = [];
  },

  pushCommand(cmd) {
    // cmd = { name, undo: function, redo: function }
    if (!this._undoStack) this._undoStack = [];
    this._undoStack.push(cmd);
    if (this._undoStack.length > 50) this._undoStack.shift();  // 限制 50 步
    this._redoStack = [];  // 新操作清空 redo
    this._updateUndoIndicator();
  },

  async _undo() {
    if (!this._undoStack || this._undoStack.length === 0) {
      Toast.info('没有可撤销的操作');
      return;
    }
    const cmd = this._undoStack.pop();
    try {
      await cmd.undo();
      this._redoStack.push(cmd);
      Toast.info(`↶ 撤销: ${cmd.name}`);
      this._updateUndoIndicator();
    } catch (e) {
      Toast.error('撤销失败: ' + e.message);
    }
  },

  async _redo() {
    if (!this._redoStack || this._redoStack.length === 0) {
      Toast.info('没有可重做的操作');
      return;
    }
    const cmd = this._redoStack.pop();
    try {
      await cmd.redo();
      this._undoStack.push(cmd);
      Toast.info(`↷ 重做: ${cmd.name}`);
      this._updateUndoIndicator();
    } catch (e) {
      Toast.error('重做失败: ' + e.message);
    }
  },

  _updateUndoIndicator() {
    const canUndo = this._undoStack && this._undoStack.length > 0;
    const canRedo = this._redoStack && this._redoStack.length > 0;
    document.dispatchEvent(new CustomEvent('organize-undo-state', {
      detail: { canUndo, canRedo }
    }));
  },

  async promptSaveBeforeSwitch() {
    if (!this.hasUnsavedChanges()) return true;
    return await Confirm.ask('未保存的修改',
      `有 ${this._state.pendingMoves.size} 个移动和 ${this._state.pendingRenames.size} 个重命名未保存。\n\n点击"确定"将保存并继续。\n点击"取消"留在当前页面。`,
      { yesText: '保存并继续', noText: '留在页面' }
    ) ? await this._save().then(() => true) : false;
  },

  _renderEmptyState(title, detail) {
    if (!this._world) return;
    this._world.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 48px));padding:24px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.18)">
        <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px">${this._escapeHtml(title)}</div>
        <div style="font-size:13px;line-height:1.6;color:var(--text-muted);margin-bottom:16px">${this._escapeHtml(detail || '')}</div>
        <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
          <button data-empty-act="home" style="padding:8px 14px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:13px">返回项目列表</button>
          <button data-empty-act="reload" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:13px">重新加载</button>
        </div>
      </div>
    `;
    this._world.querySelector('[data-empty-act="home"]')?.addEventListener('click', () => {
      App.switchView('home');
    });
    this._world.querySelector('[data-empty-act="reload"]')?.addEventListener('click', () => {
      this._load();
    });
  },

  _escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  },

  _setFooter(images, clusters) {
    const el = document.querySelector('[data-test="footer-images"]');
    const el2 = document.querySelector('[data-test="footer-clusters"]');
    if (el) el.textContent = images + ' 图';
    if (el2) el2.textContent = clusters + ' 簇';
  },

  _scrollToCluster(cid) {
    const block = this._world.querySelector(`.cluster-block[data-cid="${cid}"]`);
    if (block) {
      const x = parseFloat(block.style.left) * Canvas.state.scale + Canvas.state.pan.x;
      const y = parseFloat(block.style.top) * Canvas.state.scale + Canvas.state.pan.y;
      this._viewport.scrollTo({ left: x + (block.offsetWidth * Canvas.state.scale) / 2 - this._viewport.clientWidth / 2, top: y - 50, behavior: 'smooth' });
    }
  },

  _search(q) {
    this._world.querySelectorAll('.cluster-block').forEach(b => {
      const title = b.querySelector('.cluster-title');
      const name = title ? title.textContent.toLowerCase() : '';
      b.style.opacity = (q && !name.includes(q.toLowerCase())) ? '0.2' : '1';
    });
  },

  _zoom(delta) {
    const cx = this._viewport.clientWidth / 2;
    const cy = this._viewport.clientHeight / 2;
    Canvas.zoomAt(cx, cy, delta);
  },

  _fit() {
    const blocks = Array.from(this._world.querySelectorAll('.cluster-block'));
    Canvas.fitToView(blocks);
    this._saveState();
  },

  _reset() {
    Canvas.reset();
    this._updateZoomPct();
    this._updateMinimap();
    this._state.thumbSize = 80;
    this._state.folded = new Set();
    Selection.clear();
    const slider = document.getElementById('tb-thumbsize');
    if (slider) slider.value = '80';
    this._saveState();
    this._renderGrid();
    this._fit();
    Toast.info('已重置画板');
  },

  _reflowLayout() {
    if (!this._state.jobId) return;
    Grid.customPositions = {};
    Grid.savePositions(this._state.jobId);
    this._renderGrid({
      blockGapX: 18,
      blockGapY: 18,
      collisionGap: 10,
      collisionPadding: 20
    });
    this._fit();
    Toast.info('layout compacted');
  },

  _toggleExpandAll() {
    this._state.expandedAll = !this._state.expandedAll;
    this._renderGrid();
    Toast.info(this._state.expandedAll ? '已展开全部' : '已恢复折叠');
  },

  _updateZoomPct() {
    if (this._tbZoomPct) this._tbZoomPct.textContent = Math.round(Canvas.state.scale * 100) + '%';
    const el = document.querySelector('[data-test="footer-zoom"]');
    if (el) el.textContent = Math.round(Canvas.state.scale * 100) + '%';
  },

  _updateMinimap() {
    if (!this._minimapEl) return;
    const blocks = this._world.querySelectorAll('.cluster-block');
    if (!blocks.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    blocks.forEach(b => {
      const x = parseFloat(b.style.left) || 0;
      const y = parseFloat(b.style.top) || 0;
      const w = b.offsetWidth || 200, h = b.offsetHeight || 200;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    });
    const wW = Math.max(1, maxX - minX);
    const wH = Math.max(1, maxY - minY);
    const mW = this._minimapEl.clientWidth;
    const mH = this._minimapEl.clientHeight;
    const scaleX = mW / wW;
    const scaleY = mH / wH;
    const mScale = Math.min(scaleX, scaleY) * 0.9;
    let miniHtml = '';
    blocks.forEach(b => {
      const x = ((parseFloat(b.style.left) || 0) - minX) * mScale + (mW - wW * mScale) / 2;
      const y = ((parseFloat(b.style.top) || 0) - minY) * mScale + (mH - wH * mScale) / 2;
      const w = (b.offsetWidth || 200) * mScale;
      const h = (b.offsetHeight || 200) * mScale;
      const c = b.querySelector('.dot')?.style.background || '#46f1c5';
      miniHtml += `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${c};opacity:0.5;border-radius:1px"></div>`;
    });
    const vWorldX = -Canvas.state.pan.x / Canvas.state.scale;
    const vWorldY = -Canvas.state.pan.y / Canvas.state.scale;
    const vWorldW = this._viewport.clientWidth / Canvas.state.scale;
    const vWorldH = this._viewport.clientHeight / Canvas.state.scale;
    const vpX = (vWorldX - minX) * mScale + (mW - wW * mScale) / 2;
    const vpY = (vWorldY - minY) * mScale + (mH - wH * mScale) / 2;
    const vpW = vWorldW * mScale;
    const vpH = vWorldH * mScale;
    this._minimapEl.innerHTML = miniHtml + `<div style="position:absolute;left:${vpX}px;top:${vpY}px;width:${vpW}px;height:${vpH}px;border:1.5px solid var(--accent);background:rgba(70,241,197,0.1);pointer-events:none"></div>`;
  },

  _showImageModal(path, filename) {
    if (!path) return;
    const existing = document.getElementById('img-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'img-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    const fullUrl = apiBase() + '/results/' + encodeURIComponent(this._state.jobId) + '/thumbnail?path=' + encodeURIComponent(decodeURIComponent(path)) + '&size=1200';
    modal.innerHTML = `<div style="max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center"><img src="${fullUrl}" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:4px"><div style="color:var(--text-soft);margin-top:8px;font-size:13px">${escape(filename || '')}</div></div>`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
  },

  _showContextMenu(e) {
    this._hideContextMenu();
    const target = e.target.closest('.thumb');
    const clusterTarget = e.target.closest('.cluster-block');
    const isOnThumb = !!target;
    const isOnCluster = !!clusterTarget;
    const items = [];
    if (isOnThumb) {
      const fn = target.dataset.filename;
      if (!SelectionStore.has(fn)) SelectionStore.select([fn]);
      items.push({ label: '查看大图', action: () => this._showImageModal(target.dataset.path, fn) });
      items.push({ label: '复制文件名', action: () => { navigator.clipboard?.writeText(fn); Toast.info('已复制'); } });
      items.push({ separator: true });
      this._state.clusters.forEach(c => {
        if (String(c.id) === String(target.dataset.cid)) return;
        const name = c.suggested_name || c.name || ('簇 ' + c.id);
        items.push({ label: '→ 移到 "' + name.substring(0, 20) + '"', action: () => this._moveLocal([fn], c.id) });
      });
      items.push({ separator: true });
      items.push({ label: '→ 移到 noise', action: () => {
        const nc = this._state.clusters.find(x => String(x.id) === '-1' || String(x.id) === 'noise');
        if (nc) this._moveLocal([fn], nc.id);
        else Toast.warning('无 noise 簇');
      } });
    } else if (isOnCluster) {
      const cid = clusterTarget.dataset.cid;
      const c = this._state.clusters.find(x => String(x.id) === String(cid));
      const name = c ? (c.suggested_name || c.name) : ('簇 ' + cid);
      items.push({ label: '重命名 "' + name + '"', action: () => {
        const newName = prompt('新名称:', name);
        if (newName && newName !== name) {
          this._state.pendingRenames.set(String(cid), newName);
          this._state.clusters.forEach(x => { if (String(x.id) === String(cid)) { x.suggested_name = newName; x.name = newName; } });
          this._updatePendingIndicator();
          this._renderGrid(); this._renderSidebar();
          Toast.info('已暂存');
        }
      } });
      items.push({ label: this._state.folded.has(cid) ? '展开' : '折叠 (前20)', action: () => {
        if (this._state.folded.has(cid)) this._state.folded.delete(cid);
        else this._state.folded.add(cid);
        this._saveState(); this._renderGrid();
      } });
      items.push({ label: '滚动到此', action: () => this._scrollToCluster(cid) });
    } else {
      items.push({ label: '适配 (F)', action: () => this._fit() });
      items.push({ label: '重新整理布局', action: () => this._reflowLayout() });
      items.push({ label: '重置 (R)', action: () => this._reset() });
      items.push({ label: '清空选区 (Esc)', action: () => Selection.clear() });
      if (this.hasUnsavedChanges()) {
        items.push({ separator: true });
        items.push({ label: '💾 保存 (' + (this._state.pendingMoves.size + this._state.pendingRenames.size) + ')', action: () => this._save() });
        items.push({ label: '✗ 丢弃修改', action: () => this._discardChanges() });
      }
    }
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;background:var(--bg-elev);border:1px solid var(--border);border-radius:6px;padding:4px;min-width:200px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-size:12px';
    menu.innerHTML = items.map((it, i) => it.separator ? '<div style="height:1px;background:var(--border);margin:4px 0"></div>' : '<div class="ctx-item" data-i="' + i + '" style="padding:6px 10px;cursor:pointer;color:var(--text);border-radius:3px">' + escape(it.label) + '</div>').join('');
    menu.querySelectorAll('.ctx-item').forEach((el) => {
      const i = parseInt(el.dataset.i);
      el.onmouseover = () => el.style.background = 'var(--bg-elev)';
      el.onmouseout = () => el.style.background = '';
      el.onclick = (ev) => { ev.stopPropagation(); menu.remove(); this._ctxMenu = null; items[i].action(); };
    });
    document.body.appendChild(menu);
    this._ctxMenu = menu;
  },

  _hideContextMenu() {
    if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
  },

  _selectAll() {
    const all = [];
    this._state.clusters.forEach(c => {
      (this._state.clusterImages[c.id] || []).forEach(img => { if (img.filename) all.push(img.filename); });
    });
    SelectionStore.select(all);
    Toast.info('已选中 ' + all.length + ' 张');
  },

  async _export() {
    const hasDirty = this.hasUnsavedChanges();
    if (hasDirty) {
      const ok = await Confirm.ask('未保存的修改',
        '当前有未保存整理结果（' +
        (this._state.pendingMoves.size + this._state.pendingRenames.size) +
        ' 项），请先保存再导出。',
        { yesText: '保存并导出', noText: '取消' }
      );
      if (!ok) return;
      await this._save();
      // 保存后如果还有脏数据，说明保存失败
      if (this.hasUnsavedChanges()) {
        Toast.error('保存失败，无法导出');
        return;
      }
    }
    const jobId = this._state.jobId;
    Toast.info('正在导出到磁盘...');
    try {
      const resp = await fetch(apiBase() + '/exports/copy-by-cluster', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ job_id: jobId, include_user_moves: true })
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        const lines = ['✓ 导出完成', '', data.output_dir,
          ...Object.entries(data.cluster_counts).map(([k, v]) => '  ├─ ' + k + '/  (' + v + ' 张)')];
        Toast.show(lines.join('\n'), 'success', 6000);
        this._showExportModal(data);
      } else {
        Toast.error('导出失败: ' + (data.detail || data.message || '未知错误'));
      }
    } catch (e) { Toast.error('导出失败: ' + e.message); }
  },

  _showExportModal(data) {
    const existing = document.getElementById('export-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
    const tree = Object.entries(data.cluster_counts).map(([k, v]) =>
      '<div style="padding:2px 0;font-family:monospace;font-size:12px;color:var(--text)">├─ <span style="color:var(--accent)">' + escape(k) + '</span>/ <span style="color:var(--text-muted)">(' + v + ' 张)</span></div>'
    ).join('');
    modal.innerHTML = `<div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:480px;max-width:80vw" onclick="event.stopPropagation()">
      <h2 style="margin:0 0 12px;color:var(--text);font-size:16px">📦 导出完成</h2>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:12px">共 <span style="color:var(--accent);font-weight:600">${data.exported_count}</span> 张图片，用时 <span style="color:var(--accent)">${data.duration_sec}s</span></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:12px;font-family:monospace">
        <div style="color:var(--text-soft);font-size:12px;margin-bottom:6px">${escape(data.output_dir)}</div>${tree}
      </div>
      ${data.failed && data.failed.length ? '<div style="margin-top:12px;padding:8px;background:rgba(255,107,107,0.1);border-radius:4px;font-size:11px;color:var(--error)">⚠ ' + data.failed.length + ' 张失败</div>' : ''}
      <div style="text-align:right;margin-top:16px"><button style="padding:6px 16px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer" onclick="document.getElementById('export-modal').remove()">关闭</button></div>
    </div>`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
  },

  async _rerun() {
    if (this.hasUnsavedChanges()) {
      const ok = await Confirm.ask('未保存的修改', '有 ' + this._state.pendingMoves.size + ' 个移动未保存。是否先保存？', { yesText: '保存' });
      if (ok) await this._save();
    }
    const ok2 = await Confirm.ask('重新聚类', '将基于此项目的配置重新分析。是否继续？', { yesText: '开始' });
    if (!ok2) return;
    try {
      const resp = await fetch(apiBase() + '/jobs', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({re_run_of: this._state.jobId}) });
      const data = await resp.json();
      if (data.job_id) App.switchView('progress', { jobId: data.job_id });
      else Toast.error('启动失败: ' + (data.detail || data.message || '未知错误'));
    } catch (e) { Toast.error('请求失败: ' + e.message); }
  },

  // ================================================================
  // Analysis Panel + Global Analysis View (v4.5-ui)
  // ================================================================

  _openAnalysisPanel() {
    if (!this._state.jobId) return;
    if (typeof AnalysisPanel === 'undefined') {
      Toast.error('AnalysisPanel 未加载');
      return;
    }

    AnalysisPanel.open(this._state.jobId, {
      onInClusterSortChange: (sortState) => {
        // Update histogram / quality-edge sort state for in-cluster sorting
        this._state.histogramSort = sortState.field
          ? { field: sortState.field, order: sortState.order }
          : null;
        this._state.histogramLabel = sortState.label || null;
        this._state.qualityEdgeSort = null; // Only one sort at a time

        // Check if field is QE or histogram
        if (sortState.field) {
          const qeFields = ['sharpness_score', 'blur_laplacian_var', 'edge_density',
            'edge_strength_p95', 'local_contrast_p95', 'hue_coverage',
            'lineart_score_v2', 'high_contrast_score_v2', 'flat_color_score'];
          if (qeFields.indexOf(sortState.field) !== -1) {
            this._state.histogramSort = null;
            this._state.qualityEdgeSort = sortState.field
              ? { field: sortState.field, order: sortState.order }
              : null;
          }
        }

        this._renderGrid();
      },
      onClusterSortChange: (sortState) => {
        // Cluster sorting: reorder cluster blocks in the canvas
        if (!sortState.field) return;
        const field = sortState.field;
        const order = sortState.order || 'desc';

        const clusters = this._state.clusters;
        const sorted = [...clusters].sort((a, b) => {
          let va, vb;
          if (field === 'cluster_size') { va = a.count || 0; vb = b.count || 0; }
          else if (field === 'cluster_id') { va = Number(a.id); vb = Number(b.id); }
          else { va = 0; vb = 0; }
          return order === 'desc' ? vb - va : va - vb;
        });

        this._state.clusters = sorted;
        this._renderGrid();
      },
      onSortModeChange: (mode) => {
        if (mode === 'global') {
          this._state.sortMode = 'global-analysis';
          this._renderAnalysisView();
        } else {
          this._state.sortMode = 'organize';
          this._renderGrid();
          this._updateMinimap();
          // Update footer tip
          const tip = document.querySelector('[data-test="footer-tip"]');
          if (tip) tip.textContent = '滚轮缩放 · 拖空白平移 · Ctrl+拖框选 · 双击标题改名 · 右键菜单';
        }
      },
      onGlobalSortChange: (sortState) => {
        this._state.analysisSortField = sortState.field || null;
        this._state.analysisSortOrder = sortState.order || 'desc';
        this._state.analysisFilterLabel = sortState.label || null;
        if (this._state.sortMode === 'global-analysis') {
          this._renderAnalysisView();
        }
      },
    });
  },

  async _renderAnalysisView() {
    const jobId = this._state.jobId;
    if (!jobId || !this._world) return;

    const sortField = this._state.analysisSortField;
    const sortOrder = this._state.analysisSortOrder || 'desc';
    const filterLabel = this._state.analysisFilterLabel;

    // Update footer
    const tip = document.querySelector('[data-test="footer-tip"]');
    if (tip) tip.textContent = '全局分析视图 · 排序/筛选不改变簇归属 · 点击图片查看详情';

    // Load all images for global view
    let allImages = [];
    try {
      for (const c of this._state.clusters) {
        const imgs = this._state.clusterImages[c.id] || [];
        imgs.forEach(img => {
          allImages.push({
            ...img,
            clusterId: c.id,
            clusterName: c.suggested_name || c.name || ('簇 ' + c.id),
          });
        });
      }
    } catch (e) {
      this._world.innerHTML = `<div style="padding:24px;color:var(--error)">加载失败: ${escape(e.message)}</div>`;
      return;
    }

    // Apply histogram label filter
    if (filterLabel && this._state.histogramSummary) {
      allImages = allImages.filter(img => {
        const key = img.path || img.thumbnail || img.filename || '';
        const rec = this._state.histogramSummary[key] || this._state.histogramSummary[img.filename];
        if (!rec) return true;
        const labels = (rec.labels || '').split(';').map(l => l.trim());
        return labels.indexOf(filterLabel) !== -1;
      });
    }

    // Apply sort
    if (sortField) {
      const histSummary = this._state.histogramSummary;
      const qeSummary = this._state.qualityEdgeSummary;

      allImages.sort((a, b) => {
        const keyA = a.path || a.thumbnail || a.filename || '';
        const keyB = b.path || b.thumbnail || b.filename || '';
        const recA = histSummary
          ? (histSummary[keyA] || histSummary[a.filename] || null)
          : null;
        const recB = histSummary
          ? (histSummary[keyB] || histSummary[b.filename] || null)
          : null;
        const recQA = qeSummary
          ? (qeSummary[keyA] || qeSummary[a.filename] || null)
          : null;
        const recQB = qeSummary
          ? (qeSummary[keyB] || qeSummary[b.filename] || null)
          : null;

        const valA = recA ? (parseFloat(recA[sortField]) || 0)
          : recQA ? (parseFloat(recQA[sortField]) || 0)
          : 0;
        const valB = recB ? (parseFloat(recB[sortField]) || 0)
          : recQB ? (parseFloat(recQB[sortField]) || 0)
          : 0;

        return sortOrder === 'desc' ? valB - valA : valA - valB;
      });
    }

    // Render as grid
    const thumbSize = this._state.thumbSize || 80;
    const cols = Math.max(2, Math.floor((this._viewport ? this._viewport.clientWidth : 1200) / (thumbSize + 12)));
    const gap = 8;

    let html = `<div style="padding:16px;display:grid;grid-template-columns:repeat(${cols}, ${thumbSize + 40}px);gap:${gap}px;justify-content:center">`;

    allImages.forEach(img => {
      const fn = img.filename || '';
      const score = sortField && this._state.histogramSummary
        ? (parseFloat((this._state.histogramSummary[fn] || {})[sortField]) || 0).toFixed(2)
        : '';
      const labels = this._state.histogramSummary
        ? (this._state.histogramSummary[fn] || {}).labels || ''
        : '';

      html += `<div class="global-thumb" data-filename="${escape(fn)}" data-path="${escape(img.path || '')}" data-cid="${escape(img.clusterId)}" style="
        cursor:pointer;border:1px solid var(--border);border-radius:4px;overflow:hidden;
        background:var(--bg);transition:border-color 0.15s;
      ">
        <div style="width:${thumbSize + 40}px;height:${thumbSize}px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg-elev)">
          <img data-src="${escape(img.path || '')}" style="max-width:100%;max-height:100%;object-fit:contain">
        </div>
        <div style="padding:2px 4px;font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escape(img.clusterName || '')}
        </div>
        ${score ? `<div style="padding:0 4px;font-size:9px;color:var(--text-soft)">${escape(score)}</div>` : ''}
        ${labels ? `<div style="padding:0 4px 2px;font-size:8px;color:var(--text-muted)">${escape(labels)}</div>` : ''}
      </div>`;
    });

    html += '</div>';
    this._world.innerHTML = html;

    // Lazy load images
    this._world.querySelectorAll('.global-thumb img[data-src]').forEach(img => {
      const path = img.dataset.src;
      if (path) {
        ImageStore.getCachedThumbnailUrl(jobId, decodeURIComponent(path))
          .then(url => { img.src = url; })
          .catch(() => {});
      }
    });

    // Click handler
    this._world.querySelectorAll('.global-thumb').forEach(el => {
      el.onclick = () => {
        const path = el.dataset.path;
        const fn = el.dataset.filename;
        if (path) this._showImageModal(path, fn);
      };
      el.onmouseover = () => { el.style.borderColor = 'var(--accent)'; };
      el.onmouseout = () => { el.style.borderColor = 'var(--border)'; };
    });

    // Count
    const imagesEl = document.querySelector('[data-test="footer-images"]');
    if (imagesEl) imagesEl.textContent = allImages.length + ' 图 (全局)';
    const clustersEl = document.querySelector('[data-test="footer-clusters"]');
    if (clustersEl) clustersEl.textContent = this._state.clusters.length + ' 簇';
  }
};

window.OrganizerWorkspace = OrganizerWorkspace;
