/* Selection — 框选/单选/多选 (包装 SelectionStore) */

const Selection = {
  _boxOverlay: null,
  _boxStart: null,
  _boxSelecting: false,

  init() {
    // Subscribe to SelectionStore
    SelectionStore.subscribe(() => this._updateUI());
  },

  _updateUI() {
    const sel = new Set(SelectionStore.getAll());
    document.querySelectorAll('.thumb').forEach(t => {
      const fn = t.dataset.filename;
      const isSel = sel.has(fn);
      t.style.outline = isSel ? '2.5px solid var(--accent)' : '';
      t.style.outlineOffset = isSel ? '2px' : '';
    });
    // Update selection bar
    const bar = document.getElementById('sel-bar');
    if (bar) {
      const n = SelectionStore.size;
      bar.innerHTML = n > 0
        ? `<span style="background:var(--accent);color:var(--on-accent);padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600">${n}</span>
           <span style="font-size:12px;color:var(--text);margin-left:8px">已选中</span>
           <span id="sel-moveto-wrap" style="position:relative"></span>
           <button id="sel-clear" style="margin-left:auto;padding:2px 8px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px">✕ 清空</button>`
        : '';
      if (n > 0) {
        document.getElementById('sel-clear').onclick = () => this.clear();
        // Inject move-to button (set by organize workspace)
        if (window.__organizeRenderMoveTo) window.__organizeRenderMoveTo();
      }
    }
  },

  // Click on thumb
  onThumbClick(thumb, e) {
    const fn = thumb.dataset.filename;
    if (!fn) return;
    if (e.ctrlKey || e.metaKey) {
      SelectionStore.toggle(fn);
    } else {
      // Single click: select this one, deselect others
      if (SelectionStore.size === 1 && SelectionStore.has(fn)) {
        SelectionStore.clear();
      } else {
        SelectionStore.select([fn]);
      }
    }
  },

  startBoxSelect(e) {
    if (e.button !== 0) return false;
    if (!e.ctrlKey && !e.metaKey) return false;
    // Don't start box if on thumb
    if (e.target.closest('.thumb')) return false;
    // Don't start box if on sidebar item
    if (e.target.closest('.sb-item')) return false;
    this._boxSelecting = true;
    this._boxStart = { x: e.clientX, y: e.clientY };
    // Create overlay
    const ov = document.createElement('div');
    ov.style.cssText = `position:fixed;z-index:9998;pointer-events:none;border:1.5px dashed var(--accent);background:rgba(70,241,197,0.08);display:none`;
    document.body.appendChild(ov);
    this._boxOverlay = ov;
    SelectionStore.clear();
    return true;
  },

  updateBoxSelect(e) {
    if (!this._boxSelecting || !this._boxOverlay) return;
    const x1 = Math.min(this._boxStart.x, e.clientX);
    const y1 = Math.min(this._boxStart.y, e.clientY);
    const x2 = Math.max(this._boxStart.x, e.clientX);
    const y2 = Math.max(this._boxStart.y, e.clientY);
    this._boxOverlay.style.display = 'block';
    this._boxOverlay.style.left = x1 + 'px';
    this._boxOverlay.style.top = y1 + 'px';
    this._boxOverlay.style.width = (x2 - x1) + 'px';
    this._boxOverlay.style.height = (y2 - y1) + 'px';
  },

  endBoxSelect(e) {
    if (!this._boxSelecting) return;
    this._boxSelecting = false;
    if (this._boxOverlay) { this._boxOverlay.remove(); this._boxOverlay = null; }
    if (!this._boxStart) return;
    const x1 = Math.min(this._boxStart.x, e.clientX);
    const y1 = Math.min(this._boxStart.y, e.clientY);
    const x2 = Math.max(this._boxStart.x, e.clientX);
    const y2 = Math.max(this._boxStart.y, e.clientY);
    if (Math.abs(x2 - x1) < 5 && Math.abs(y2 - y1) < 5) {
      // Treat as click, not drag
      SelectionStore.clear();
      return;
    }
    const ids = [];
    document.querySelectorAll('.thumb').forEach(t => {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
        if (t.dataset.filename) ids.push(t.dataset.filename);
      }
    });
    SelectionStore.select(ids);
    if (ids.length) Toast.info('已选中 ' + ids.length + ' 张', 1500);
  },

  clear() { SelectionStore.clear(); },

  // Sidebar drop detection
  findDropTarget(e) {
    // Check sidebar items first
    const sb = document.querySelector('.sb-item:hover');
    if (sb) return { type: 'sidebar', cid: sb.dataset.cid };
    // Check canvas cluster blocks
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      const block = el.closest('.cluster-block');
      if (block) return { type: 'canvas', cid: block.dataset.cid };
    }
    return null;
  }
};

window.Selection = Selection;
